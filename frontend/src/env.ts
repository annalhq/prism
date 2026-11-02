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
	// Neon Object Storage. Vercel reserves the AWS_* names, so production sets NEON_STORAGE_*;
	// locally, `neon deploy` / `neon env pull` write the AWS_* names, which are read as a fallback.
	NEON_STORAGE_BUCKET: { ...optionalPrivate, description: "Neon bucket name (default 'uploads')" },
	NEON_STORAGE_ENDPOINT: { ...optionalPrivate, description: 'Neon branch S3 endpoint URL' },
	NEON_STORAGE_REGION: { ...optionalPrivate, description: 'Neon storage region' },
	NEON_STORAGE_ACCESS_KEY_ID: { ...optionalPrivate, description: 'Neon branch storage key ID' },
	NEON_STORAGE_SECRET_ACCESS_KEY: {
		...optionalPrivate,
		description: 'Neon branch storage secret key'
	},
	AWS_ENDPOINT_URL_S3: { ...optionalPrivate, description: 'Neon endpoint, from neon env pull' },
	AWS_REGION: { ...optionalPrivate, description: 'Neon region, from neon env pull' },
	AWS_ACCESS_KEY_ID: { ...optionalPrivate, description: 'Neon key ID, from neon env pull' },
	AWS_SECRET_ACCESS_KEY: { ...optionalPrivate, description: 'Neon secret, from neon env pull' }
});
