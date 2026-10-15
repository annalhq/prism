import { expect, test } from '@playwright/test';

for (const path of ['/auth/sign-in', '/auth/reset-password']) {
	test(`${path} permits native same-origin forms without an opaque Origin`, async ({
		page,
		baseURL
	}) => {
		await page.goto(path);
		const responsePromise = page.waitForResponse(
			(response) => response.request().method() === 'POST'
		);
		await page.evaluate(
			(target) => {
				const form = document.createElement('form');
				form.method = 'POST';
				form.action = target;
				document.body.append(form);
				form.submit();
			},
			path === '/auth/sign-in' ? `${path}?/signIn` : path
		);
		const response = await responsePromise;
		const headers = await response.request().allHeaders();
		expect(headers.origin).toBe(new URL(baseURL!).origin);
		// The production test server deliberately has no credentials: reaching the
		// action's configuration error proves CSRF did not reject our own form.
		expect(response.status()).toBe(503);
		expect(await response.text()).not.toContain('This write must originate from the application.');
	});
}
