import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { connectionFingerprint, directConnection } from './config';

const url = directConnection();
const client = new Client({
	connectionString: url,
	connectionTimeoutMillis: 10_000,
	application_name: 'prism-inventory'
});
try {
	await client.connect();
	await client.query('BEGIN READ ONLY');
	await client.query("SET LOCAL statement_timeout = '15s'");
	const tables = await client.query<{ schema: string; name: string }>(`
		SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
		WHERE table_schema IN ('public', 'drizzle', 'neon_auth') AND table_type = 'BASE TABLE'
		ORDER BY table_schema, table_name`);
	const columns = await client.query(`SELECT table_schema, table_name, column_name, data_type
		FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
	const counts: Record<string, string> = {};
	for (const table of tables.rows.filter((table) => table.schema === 'public')) {
		const identifier = table.name.replaceAll('"', '""');
		const count = await client.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM public."${identifier}"`
		);
		counts[table.name] = count.rows[0].count;
	}
	await client.query('COMMIT');
	const report = {
		inspectedAt: new Date().toISOString(),
		fingerprint: connectionFingerprint(url),
		tables: tables.rows,
		columns: columns.rows,
		rowCounts: counts
	};
	await mkdir('artifacts', { recursive: true });
	await writeFile('artifacts/database-inventory.json', JSON.stringify(report, null, 2) + '\n', {
		mode: 0o600
	});
	console.log('Read-only inventory saved to artifacts/database-inventory.json.');
	console.log(
		`Public tables: ${Object.keys(counts).length}. Existing tables require review before migration.`
	);
} catch {
	console.error(
		'Database inventory failed. Check the direct connection and database permissions; no content was modified.'
	);
	process.exitCode = 1;
} finally {
	await client.end();
}
