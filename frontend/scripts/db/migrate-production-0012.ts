import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds tags.is_private: a private tag, and everything carrying it, is left out of the public
// view. The change is additive: existing tags default to public, so nothing published changes
// until the owner marks a tag private. Rollback, if ever needed:
//   ALTER TABLE "tags" DROP COLUMN "is_private";
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0012') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0012 to apply the reviewed private tags migration.'
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
const expectedSql = ['ALTER TABLE "tags" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL'];
const reviewed = migrations[12]?.sql.join('') ?? '';
if (
	migrations.length !== 13 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE|UPDATE)\b/.test(reviewed)
) {
	throw new Error('Local migration 0012 does not match the reviewed private tags migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
// Whether tags.is_private exists yet.
const privateColumn = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'tags' AND column_name = 'is_private'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 13)) {
		if ((await privateColumn()) !== 1)
			throw new Error('Migration 0012 is recorded but tags.is_private is missing.');
		console.log('Migration 0012 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 12) || (await privateColumn()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await privateColumn()) !== 1 || !expectedHistory(finalHistory.rows, 13))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0012 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0012 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
