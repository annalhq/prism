import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: { conditions: ['node'] },
	test: {
		projects: [
			{
				extends: true,
				test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] }
			},
			{
				extends: true,
				test: {
					name: 'integration',
					environment: 'node',
					include: ['tests/integration/**/*.test.ts']
				}
			}
		]
	}
});
