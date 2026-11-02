import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds person_avatars: each person's X photo, fetched from unavatar.io once per handle and kept
// in object storage. The change is additive; nothing existing reads or changes. Rollback, if ever needed (stored
// objects stay in the bucket under avatars/ and can be removed separately):
//   DROP TABLE "person_avatars";
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0008') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0008 to apply the reviewed person avatars migration.'
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
const expectedSql = ['CREATE TABLE "person_avatars"', 'CONSTRAINT "person_avatar_valid"'];
if (
	migrations.length !== 9 ||
	!expectedSql.every((fragment) => migrations[8].sql.join('').includes(fragment)) ||
	/\b(DROP|ALTER)\b/.test(migrations[8].sql.join(''))
) {
	throw new Error('Local migration 0008 does not match the reviewed person avatars migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
const avatarTable = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM information_schema.tables
			 WHERE table_schema = 'public' AND table_name = 'person_avatars'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 9)) {
		if ((await avatarTable()) !== 1)
			throw new Error('Migration 0008 is recorded but person_avatars is missing.');
		console.log('Migration 0008 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 8) || (await avatarTable()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await avatarTable()) !== 1 || !expectedHistory(finalHistory.rows, 9))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0008 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0008 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
