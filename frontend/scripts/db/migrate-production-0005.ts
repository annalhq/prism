import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0005') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0005 to apply the reviewed extension migration.'
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
const expectedSql = [
	'CREATE TABLE "extension_pairings"',
	'ALTER TABLE "device_tokens" ALTER COLUMN "expires_at" DROP NOT NULL;',
	'ALTER TABLE "device_tokens" ADD COLUMN "name" text DEFAULT \'Device\' NOT NULL;'
];
if (
	migrations.length !== 6 ||
	!expectedSql.every((fragment) => migrations[5].sql.join('').includes(fragment))
) {
	throw new Error('Local migration 0005 does not match the reviewed Firefox extension migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (count: number) =>
		applied.rows.length === count &&
		applied.rows.every((row, index) => row.hash === migrations[index]?.hash);
	const state = await pool.query<{
		pairings: string | null;
		nameColumn: number;
		expiresNullable: string | null;
	}>(`
		SELECT
			to_regclass('public.extension_pairings')::text AS pairings,
			(SELECT count(*)::int FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'name') AS "nameColumn",
			(SELECT is_nullable FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'expires_at') AS "expiresNullable"
	`);
	const current = state.rows[0];
	if (expectedHistory(6)) {
		if (!current.pairings || current.nameColumn !== 1 || current.expiresNullable !== 'YES')
			throw new Error('Migration 0005 is recorded but the extension schema is incomplete.');
		console.log('Migration 0005 is already applied; extension schema and history agree.');
	} else {
		if (
			!expectedHistory(5) ||
			current.pairings ||
			current.nameColumn !== 0 ||
			current.expiresNullable !== 'NO'
		)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const verified = await pool.query(
			`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'extension_pairings'
			 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'name')
			 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'expires_at' AND is_nullable = 'YES')`
		);
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if (
			!verified.rowCount ||
			finalHistory.rows.length !== 6 ||
			finalHistory.rows.some((row, index) => row.hash !== migrations[index]?.hash)
		)
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0005 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0005 failed.',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
