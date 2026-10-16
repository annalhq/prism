import { expect, test } from '@playwright/test';

test('shows sign-in first without credentials or external requests', async ({ page }) => {
	const errors: string[] = [];
	const remote: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') remote.push(request.url());
	});
	await page.goto('/');
	await expect(page).toHaveTitle(/Prism/);
	await expect(page.getByRole('navigation', { name: 'Library navigation' })).not.toBeVisible();
	await expect(page.getByRole('main')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'A clearer mind starts here.' })).toBeVisible();
	await expect(page.getByText('Sign-in is not configured yet.', { exact: false })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	expect(errors).toEqual([]);
	expect(remote).toEqual([]);
});

test('provides keyboard access directly to main content', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('main')).toBeFocused();
});
