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
		command: 'bun run build && node build',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			NODE_ENV: 'production',
			HOST: '127.0.0.1',
			PORT: '4173',
			ORIGIN: 'http://127.0.0.1:4173',
			DATABASE_URL: '',
			DATABASE_URL_DIRECT: '',
			OWNER_SUBJECT: '',
			NEON_AUTH_BASE_URL: '',
			B2_BUCKET: '',
			B2_ENDPOINT: '',
			B2_REGION: '',
			B2_KEY_ID: '',
			B2_APP_KEY: ''
		}
	}
});
