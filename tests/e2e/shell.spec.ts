import { expect, test } from '@playwright/test';

test('renders the foundation without credentials or external requests', async ({ page }) => {
	const errors: string[] = [];
	const remote: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') remote.push(request.url());
	});
	await page.goto('/');
	await expect(page).toHaveTitle(/Prism/);
	await expect(page.getByRole('navigation', { name: 'Library navigation' })).toBeVisible();
	await expect(page.getByRole('main')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your library starts here' })).toBeVisible();
	await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'About this foundation' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	await expect(page.getByRole('button', { name: 'About this foundation' })).toBeFocused();
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
