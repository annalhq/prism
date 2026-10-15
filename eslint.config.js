import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	{
		ignores: [
			'.svelte-kit/**',
			'build/**',
			'node_modules/**',
			'.agents/**',
			'artifacts/**',
			'test-results/**',
			'playwright-report/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	{ languageOptions: { globals: { ...globals.node, ...globals.browser } } },
	{ files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: ts.parser } } }
);
