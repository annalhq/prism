import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds synced themes: tables `themes` and `vault_appearance`. Additive; vaults without a row
// keep Zen dark. Rollback: DROP TABLE "themes"; DROP TABLE "vault_appearance";
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0014') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0014 to apply the reviewed themes migration.'
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
	'CREATE TABLE "themes"',
	'CREATE TABLE "vault_appearance"',
	'CREATE UNIQUE INDEX "theme_name_unique"'
];
const reviewed = migrations[14]?.sql.join('') ?? '';
// Foreign keys say `ON DELETE no action ON UPDATE no action`; only real data changes are refused.
if (
	migrations.length !== 15 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|TRUNCATE)\b|\bDELETE FROM\b|\bUPDATE\s+"/.test(reviewed)
) {
	throw new Error('Local migration 0014 does not match the reviewed themes migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
const themeSchema = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM information_schema.tables
			 WHERE table_schema = 'public' AND table_name IN ('themes', 'vault_appearance')`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 15)) {
		if ((await themeSchema()) !== 2)
			throw new Error('Migration 0014 is recorded but the theme tables are missing.');
		console.log('Migration 0014 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 14) || (await themeSchema()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await themeSchema()) !== 2 || !expectedHistory(finalHistory.rows, 15))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0014 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0014 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
