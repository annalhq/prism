import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds the nullable tags.position sort key used by drag-to-reorder. The change is additive:
// existing rows keep position NULL and sort as before. Rollback, if ever needed:
//   ALTER TABLE "tags" DROP CONSTRAINT "tag_position_valid";
//   ALTER TABLE "tags" DROP COLUMN "position";
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0006') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0006 to apply the reviewed tag position migration.'
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
	'ALTER TABLE "tags" ADD COLUMN "position" text;',
	'ADD CONSTRAINT "tag_position_valid"'
];
if (
	migrations.length !== 7 ||
	!expectedSql.every((fragment) => migrations[6].sql.join('').includes(fragment))
) {
	throw new Error('Local migration 0006 does not match the reviewed tag position migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
const positionColumn = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'tags' AND column_name = 'position'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 7)) {
		if ((await positionColumn()) !== 1)
			throw new Error('Migration 0006 is recorded but tags.position is missing.');
		console.log('Migration 0006 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 6) || (await positionColumn()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await positionColumn()) !== 1 || !expectedHistory(finalHistory.rows, 7))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0006 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0006 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
