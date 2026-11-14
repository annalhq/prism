import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds tag folders: a tag_folders table and a nullable tags.folder_id. Folders only group tags
// in the sidebar. The change is additive: every existing tag stays loose (folder_id null), so
// nothing visible changes until the owner makes a folder. Rollback, if ever needed:
//   ALTER TABLE "tags" DROP COLUMN "folder_id"; DROP TABLE "tag_folders";
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0013') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0013 to apply the reviewed tag folders migration.'
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
	'CREATE TABLE "tag_folders"',
	'ALTER TABLE "tags" ADD COLUMN "folder_id" uuid',
	'CREATE UNIQUE INDEX "tag_folder_name_unique"',
	'CREATE INDEX "tag_folder_members"'
];
const reviewed = migrations[13]?.sql.join('') ?? '';
// Foreign keys say `ON DELETE no action ON UPDATE no action`; only real data changes are refused.
if (
	migrations.length !== 14 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|TRUNCATE)\b|\bDELETE FROM\b|\bUPDATE\s+"/.test(reviewed)
) {
	throw new Error('Local migration 0013 does not match the reviewed tag folders migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
// 2 once both tags.folder_id and the tag_folders table exist, 0 before the migration.
const folderSchema = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT ((SELECT count(*) FROM information_schema.columns
			   WHERE table_schema = 'public' AND table_name = 'tags' AND column_name = 'folder_id')
			 + (SELECT count(*) FROM information_schema.tables
			   WHERE table_schema = 'public' AND table_name = 'tag_folders'))::int AS n`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 14)) {
		if ((await folderSchema()) !== 2)
			throw new Error('Migration 0013 is recorded but the tag folder schema is missing.');
		console.log('Migration 0013 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 13) || (await folderSchema()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await folderSchema()) !== 2 || !expectedHistory(finalHistory.rows, 14))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0013 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0013 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
