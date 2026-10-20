import { DATABASE_URL } from '$app/env/private';
import { validateDatabaseUrl } from './url.js';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

let instance: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
	const pool = new Pool({
		connectionString: validateDatabaseUrl(DATABASE_URL),
		max: 5,
		connectionTimeoutMillis: 10_000,
		idleTimeoutMillis: 30_000,
		statement_timeout: 15_000,
		application_name: 'prism'
	});
	// pg otherwise emits an unhandled error when an idle connection is lost.
	pool.on('error', () => console.error('prism.database.idle_connection_error'));
	return { pool, db: drizzle(pool, { schema }) };
}

export function database() {
	return (instance ??= createDatabase()).db;
}

export async function closeDatabase() {
	if (!instance) return;
	await instance.pool.end();
	instance = undefined;
}

export type Database = ReturnType<typeof database>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function inTransaction<T>(
	operation: (transaction: Transaction) => Promise<T>,
	config?: Parameters<Database['transaction']>[1]
): Promise<T> {
	return database().transaction(operation, config);
}
