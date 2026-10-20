import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { connectionFingerprint, directConnection } from './config';

const url = directConnection();
const inventory = JSON.parse(await readFile('artifacts/database-inventory.json', 'utf8'));
const inspectedAt = Date.parse(inventory.inspectedAt);
if (
	inventory.fingerprint !== connectionFingerprint(url) ||
	!Number.isFinite(inspectedAt) ||
	Date.now() - inspectedAt > 86_400_000
) {
	throw new Error('Run db:inventory against this exact database within 24 hours before migrating.');
}
if (process.env.DB_MIGRATION_TARGET !== 'isolated') {
	throw new Error(
		'Set DB_MIGRATION_TARGET=isolated only after confirming this is a disposable test branch. Production cutover is a separate reviewed step.'
	);
}
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
	await pool.query("SELECT pg_advisory_lock(hashtext('prism:migrations'))");
	const tables = await pool.query<{ name: string }>(
		"SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
	);
	if (tables.rowCount) {
		const journal = await pool.query(
			"SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name"
		);
		if (!journal.rows[0].table_name)
			throw new Error('Existing public tables have no Prism migration history.');
		const applied = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		const local = readMigrationFiles({ migrationsFolder: 'drizzle' });
		if (
			!applied.rows.length ||
			applied.rows.some((row, index) => row.hash !== local[index]?.hash)
		) {
			throw new Error('Existing migration history does not match these reviewed files.');
		}
	}
	await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
	console.log('Reviewed migrations applied to the isolated database.');
} catch {
	console.error(
		'Migration refused or failed. Review database inventory and migration history before retrying; connection details are suppressed.'
	);
	process.exitCode = 1;
} finally {
	// Closing the sole direct connection also releases the advisory migration lock.
	await pool.end();
}
