import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Lets person_avatars hold photos from GitHub, YouTube, Codeforces and Bilibili as well as X: the
// handle column now stores the source as provider:id. Existing rows (bare X handles) become
// x:<handle>, so stored photos stay valid and aren't fetched again. Rollback, if ever needed:
//   ALTER TABLE "person_avatars" DROP CONSTRAINT "person_avatar_valid";
//   DELETE FROM "person_avatars" WHERE "handle" NOT LIKE 'x:%';
//   UPDATE "person_avatars" SET "handle" = substr("handle", 3);
//   then re-add the 0008 constraint.
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0009') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0009 to apply the reviewed avatar sources migration.'
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
	'ALTER TABLE "person_avatars" DROP CONSTRAINT "person_avatar_valid"',
	`UPDATE "person_avatars" SET "handle" = 'x:' || "handle"`,
	'ADD CONSTRAINT "person_avatar_valid"',
	'(x|github|youtube|codeforces|bilibili):'
];
const reviewed = migrations[9]?.sql.join('') ?? '';
if (
	migrations.length !== 10 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE)\b/.test(reviewed)
) {
	throw new Error('Local migration 0009 does not match the reviewed avatar sources migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
// Rows still keyed by a bare handle; 0 once the migration has run.
const unkeyedRows = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM person_avatars WHERE handle NOT LIKE '%:%'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 10)) {
		if ((await unkeyedRows()) !== 0)
			throw new Error('Migration 0009 is recorded but some photos are still keyed by bare handle.');
		console.log('Migration 0009 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 9))
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await unkeyedRows()) !== 0 || !expectedHistory(finalHistory.rows, 10))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0009 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0009 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
