import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Drops people.avatar_config, the saved choice for the retired generated avatars. People now
// show their X photo or a monogram, so nothing reads the column. The drop is destructive;
// take a branch or snapshot first if the old choices might ever matter. Rollback restores the
// shape only, not the data:
//   ALTER TABLE "people" ADD COLUMN "avatar_config" jsonb;
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0007') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0007 to apply the reviewed avatar column migration.'
	);
}

const pooledUrl = validateDatabaseUrl(process.env.DATABASE_URL);
const directUrl = validateDatabaseUrl(process.env.DATABASE_URL_DIRECT, true);
const pooled = new URL(pooledUrl);
const direct = new URL(directUrl);
const normalizedHost = (host: string) => host.replace('-pooler.', '.');
if (
	pooled.protocol !== direct.protocol ||
	normalizedHost(pooled.hostname) !== normalizedHost(direct.hostname) ||
	pooled.pathname !== direct.pathname
) {
	throw new Error('Production pooled and direct database URLs do not identify the same database.');
}

const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
if (
	migrations.length !== 8 ||
	migrations[7].sql.join('').trim() !== 'ALTER TABLE "people" DROP COLUMN "avatar_config";'
) {
	throw new Error('Local migration 0007 does not match the reviewed avatar column migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
const avatarColumn = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'avatar_config'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 8)) {
		if ((await avatarColumn()) !== 0)
			throw new Error('Migration 0007 is recorded but people.avatar_config still exists.');
		console.log('Migration 0007 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 7) || (await avatarColumn()) !== 1)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await avatarColumn()) !== 0 || !expectedHistory(finalHistory.rows, 8))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0007 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0007 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
