export function validateDatabaseUrl(value: string | undefined, direct = false): string {
	if (!value)
		throw new Error(`${direct ? 'DATABASE_URL_DIRECT' : 'DATABASE_URL'} is not configured.`);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Database connection URL is invalid.');
	}
	if (!['postgres:', 'postgresql:'].includes(url.protocol))
		throw new Error('Database URL must use PostgreSQL.');
	if (direct && url.hostname.includes('-pooler.'))
		throw new Error('Migrations require a direct, non-pooled connection.');
	if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) {
		url.searchParams.set('sslmode', 'verify-full');
	}
	return url.href;
}
