import { defineConfig } from 'drizzle-kit';

// Generation is offline. Live migrations use scripts/db/migrate.ts and a direct URL.
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	strict: true,
	verbose: false
});
