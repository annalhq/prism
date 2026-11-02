import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds the 'text' bookmark kind: written notes saved on their own, with no link (the Markdown body
// lives in the item's note). The URL rule now exempts text items as it does images. The change is
// additive. Rollback, if ever needed (enum values can't be dropped; text items must go first):
//   DELETE text items, then restore the 0004 bookmark_url_required constraint.
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0010') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0010 to apply the reviewed text items migration.'
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
	`ALTER TYPE "public"."bookmark_kind" ADD VALUE 'text'`,
	'ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmark_url_required"',
	`"bookmarks"."kind"::text IN ('image', 'text')`
];
const reviewed = migrations[10]?.sql.join('') ?? '';
if (
	migrations.length !== 11 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE|UPDATE)\b/.test(reviewed)
) {
	throw new Error('Local migration 0010 does not match the reviewed text items migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
// Whether bookmark_kind has the 'text' value yet.
const textKind = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
			 WHERE t.typname = 'bookmark_kind' AND e.enumlabel = 'text'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 11)) {
		if ((await textKind()) !== 1)
			throw new Error("Migration 0010 is recorded but bookmark_kind has no 'text' value.");
		console.log('Migration 0010 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 10) || (await textKind()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await textKind()) !== 1 || !expectedHistory(finalHistory.rows, 11))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0010 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0010 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
