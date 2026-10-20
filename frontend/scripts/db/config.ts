import { createHash } from 'node:crypto';
import { validateDatabaseUrl } from '../../src/lib/server/db/url.js';

export function directConnection() {
	return validateDatabaseUrl(process.env.DATABASE_URL_DIRECT, true);
}

export function connectionFingerprint(value: string) {
	const url = new URL(value);
	return createHash('sha256')
		.update(`${url.hostname}:${url.port || '5432'}${url.pathname}`)
		.digest('hex');
}
