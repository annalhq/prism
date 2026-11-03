import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: 'list',
	outputDir: 'test-results',
	use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }
	],
	webServer: {
		// The production build targets Vercel, so tests serve it with Vite's preview server, which
		// runs the built SvelteKit server output. Preview also reads .env: the empty values below
		// override it, so tests never touch a real database, sign-in service or object storage.
		command: 'bun run build && bun run preview --host 127.0.0.1 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			NODE_ENV: 'production',
			APP_ORIGIN: 'http://127.0.0.1:4173',
			DATABASE_URL: '',
			DATABASE_URL_DIRECT: '',
			OWNER_SUBJECT: '',
			NEON_AUTH_BASE_URL: '',
			NEON_AUTH_COOKIE_SECRET: '',
			// Tests never touch real object storage, whichever names a local .env uses.
			NEON_STORAGE_ENDPOINT: '',
			NEON_STORAGE_ACCESS_KEY_ID: '',
			NEON_STORAGE_SECRET_ACCESS_KEY: '',
			AWS_ENDPOINT_URL_S3: '',
			AWS_ACCESS_KEY_ID: '',
			AWS_SECRET_ACCESS_KEY: ''
		}
	}
});
