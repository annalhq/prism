import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import AppShell from '../../src/lib/components/AppShell.svelte';

describe('public foundation shell', () => {
	it('renders useful landmarks without a session, database or browser globals', () => {
		const { body } = render(AppShell);
		expect(body).toContain('aria-label="Library navigation"');
		expect(body).toContain('<main');
		expect(body).toContain('Your library starts here');
		expect(body).toContain('Not connected');
	});
});
