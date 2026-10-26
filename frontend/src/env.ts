import { defineEnvVars } from '@sveltejs/kit/env';

// Optional at startup so the public foundation can render before services are configured.
// These are runtime/server-only values; never inline secrets into a client build.
const optionalPrivate = {
	public: false,
	static: false,
	schema: (value: string | undefined) => value
};

export const variables = defineEnvVars({
	DATABASE_URL: { ...optionalPrivate, description: 'Pooled PostgreSQL application connection' },
	APP_ORIGIN: { ...optionalPrivate, description: 'Canonical application origin' },
	NEON_AUTH_BASE_URL: { ...optionalPrivate, description: 'Neon Auth service URL' },
	NEON_AUTH_COOKIE_SECRET: {
		...optionalPrivate,
		description: 'Server session-cookie signing secret'
	},
	OWNER_SUBJECT: { ...optionalPrivate, description: 'Explicit private-vault owner identity' },
	LIBRARY_PUBLIC_VIEW: {
		...optionalPrivate,
		description: "Set to 'enabled' to publish a read-only view of the owner library at /public"
	},
	B2_BUCKET: { ...optionalPrivate, description: 'Private Backblaze B2 bucket name' },
	B2_ENDPOINT: { ...optionalPrivate, description: 'Backblaze B2 regional endpoint' },
	B2_REGION: { ...optionalPrivate, description: 'Backblaze B2 bucket region' },
	B2_KEY_ID: { ...optionalPrivate, description: 'Bucket-scoped Backblaze key ID' },
	B2_APP_KEY: { ...optionalPrivate, description: 'Bucket-scoped Backblaze application key' }
});
