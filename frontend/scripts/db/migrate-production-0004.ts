import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0004') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0004 to apply this reviewed production migration.'
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
const expectedSql = 'ALTER TABLE "people" ADD COLUMN "avatar_config" jsonb;';
if (migrations.length !== 5 || migrations[4].sql.join('').trim() !== expectedSql) {
	throw new Error('Local migration 0004 does not match the reviewed avatar configuration change.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const schema = await pool.query<{ name: string }>(
		"SELECT to_regclass('public.people') AS name UNION ALL SELECT to_regclass('drizzle.__drizzle_migrations') AS name"
	);
	if (schema.rows.some((row) => !row.name))
		throw new Error('Expected people table or Drizzle migration history is missing.');

	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const matches = (count: number) =>
		applied.rows.length === count &&
		applied.rows.every((row, index) => row.hash === migrations[index]?.hash);
	const column = await pool.query(
		"SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'avatar_config'"
	);
	if (matches(migrations.length)) {
		if (!column.rowCount)
			throw new Error('Migration 0004 is recorded but people.avatar_config is absent.');
		console.log('Migration 0004 is already applied; database schema and migration history agree.');
	} else {
		if (!matches(4) || column.rowCount)
			throw new Error(
				'Production migration history or people.avatar_config differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const verified = await pool.query(
			"SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'avatar_config'"
		);
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if (
			!verified.rowCount ||
			finalHistory.rows.length !== migrations.length ||
			finalHistory.rows.some((row, index) => row.hash !== migrations[index]?.hash)
		)
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0004 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0004 failed.',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
