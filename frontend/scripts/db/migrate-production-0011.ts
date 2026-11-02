import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

// Adds the 'stash' bookmark kind: rabbit holes, a trail of links kept as a nested list in the
// item's note, with no link of their own. The URL rule now exempts stashes as it does images and
// text items. The change is additive. Rollback, if ever needed (enum values can't be dropped):
//   DELETE stash items, then restore the 0010 bookmark_url_required constraint.
if (process.env.CONFIRM_PRISM_PRODUCTION_MIGRATION !== '0011') {
	throw new Error(
		'Set CONFIRM_PRISM_PRODUCTION_MIGRATION=0011 to apply the reviewed rabbit holes migration.'
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
	`ALTER TYPE "public"."bookmark_kind" ADD VALUE 'stash'`,
	'ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmark_url_required"',
	`"bookmarks"."kind"::text IN ('image', 'text', 'stash')`
];
const reviewed = migrations[11]?.sql.join('') ?? '';
if (
	migrations.length !== 12 ||
	!expectedSql.every((fragment) => reviewed.includes(fragment)) ||
	/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE|UPDATE)\b/.test(reviewed)
) {
	throw new Error('Local migration 0011 does not match the reviewed rabbit holes migration.');
}

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
const lockId = 'prism:migrations';
// Whether bookmark_kind has the 'stash' value yet.
const stashKind = async () =>
	(
		await pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
			 WHERE t.typname = 'bookmark_kind' AND e.enumlabel = 'stash'`
		)
	).rows[0].n;
try {
	await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockId]);
	const applied = await pool.query<{ hash: string }>(
		'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
	);
	const expectedHistory = (rows: { hash: string }[], count: number) =>
		rows.length === count && rows.every((row, index) => row.hash === migrations[index]?.hash);
	if (expectedHistory(applied.rows, 12)) {
		if ((await stashKind()) !== 1)
			throw new Error("Migration 0011 is recorded but bookmark_kind has no 'stash' value.");
		console.log('Migration 0011 is already applied; schema and history agree.');
	} else {
		if (!expectedHistory(applied.rows, 11) || (await stashKind()) !== 0)
			throw new Error(
				'Production migration history or schema differs from the reviewed pre-migration state.'
			);
		await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
		const finalHistory = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
		);
		if ((await stashKind()) !== 1 || !expectedHistory(finalHistory.rows, 12))
			throw new Error('Post-migration verification failed.');
		console.log('Migration 0011 applied and verified.');
	}
} catch (error) {
	const cause = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
	console.error(
		'Production migration 0011 failed.',
		error instanceof Error ? error.message : '',
		typeof cause === 'string' && /^[A-Z0-9_]{3,32}$/.test(cause) ? `Database code: ${cause}` : ''
	);
	process.exitCode = 1;
} finally {
	await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]).catch(() => undefined);
	await pool.end();
}
