// Applies pending migrations from ./drizzle, for a new database or an upgrade.
// Requires a fresh `db:inventory` of the same database. An existing library must already carry
// a prefix of these migrations and needs PRISM_CONFIRM_UPGRADE=1.
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { connectionFingerprint, directConnection } from './config';

/** A refusal with a message that is safe to print. */
class Refusal extends Error {}

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
const local = readMigrationFiles({ migrationsFolder: 'drizzle' });
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
	await pool.query("SELECT pg_advisory_lock(hashtext('prism:migrations'))");
	const tables = await pool.query(
		"SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' LIMIT 1"
	);
	let applied = 0;
	if (tables.rowCount) {
		const journal = await pool.query(
			"SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name"
		);
		if (!journal.rows[0].table_name)
			throw new Refusal('Existing public tables have no Prism migration history.');
		const history = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if (
			!history.rows.length ||
			history.rows.length > local.length ||
			history.rows.some((row, index) => row.hash !== local[index]?.hash)
		)
			throw new Refusal('Migration history does not match these migration files.');
		applied = history.rows.length;
		if (applied < local.length && process.env.PRISM_CONFIRM_UPGRADE !== '1')
			throw new Refusal(
				`${local.length - applied} migration(s) pending on an existing library. Back it up (or branch it), then rerun with PRISM_CONFIRM_UPGRADE=1.`
			);
	}
	if (applied === local.length) console.log('Database is up to date.');
	else {
		console.log(`Applying migrations ${applied + 1}–${local.length} of ${local.length}.`);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		console.log('Migrations applied.');
	}
} catch (error) {
	console.error(
		error instanceof Refusal
			? `Migration refused: ${error.message}`
			: 'Migration failed. Review database inventory and migration history before retrying; connection details are suppressed.'
	);
	process.exitCode = 1;
} finally {
	// Closing the sole direct connection also releases the advisory migration lock.
	await pool.end();
}
