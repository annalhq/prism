import { expect, test } from '@playwright/test';

test('contains sync conflicts and preserves drafts when keeping the saved version', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { get: () => false });
	});
	await page.goto('/');
	const databaseName = await page.evaluate(async () => {
		const identity = { subject: 'layout-owner', vaultId: 'layout-vault' };
		localStorage.setItem(`prism-v0:last-owner:${location.origin}`, JSON.stringify(identity));
		const name = `prism-v0:${encodeURIComponent(`${location.origin}:${identity.vaultId}:${identity.subject}`)}`;
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name, 10);
			request.onupgradeneeded = () => {
				dbSchema(request.result);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		function dbSchema(db: IDBDatabase) {
			db.createObjectStore('records', { keyPath: 'storageKey' }).createIndex('table', 'table');
			db.createObjectStore('outbox', { keyPath: 'operationId' }).createIndex(
				'createdAt',
				'createdAt'
			);
			db.createObjectStore('drafts', { keyPath: 'id' });
			db.createObjectStore('meta', { keyPath: 'key' });
		}
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(['outbox', 'drafts'], 'readwrite');
			const failures = [
				[
					'person-identity.add',
					'This confirmed profile is already reserved; no people were merged.'
				],
				['bookmark.update', 'Expected nonempty text of at most 500 characters.']
			];
			failures.forEach(([type, message], index) => {
				const operationId = `conflict-${index}`;
				tx.objectStore('outbox').put({
					operationId,
					createdAt: '2026-10-18T00:00:00.000Z',
					status: 'conflict',
					error: { code: 'validation', message },
					envelope: { protocolVersion: 1, operationId, command: { type, id: 'bookmark' } }
				});
			});
			tx.objectStore('drafts').put({ id: 'bookmark', body: 'Keep this note.', baseRevision: '1' });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
		return name;
	});
	await page.getByRole('button', { name: 'Open cached library on this trusted device' }).click();
	await page.getByRole('button', { name: 'Account and library settings' }).click();
	const review = page.getByRole('button', { name: '2 changes need review' });
	// The same geometry assertion also catches the original, always-expanded layout.
	if (await review.count()) await review.click();
	await expect(page.locator('.conflict-entry')).toHaveCount(2);
	const contained = await page.locator('.conflict-entry').evaluateAll((entries) =>
		entries.every((entry) => {
			const bounds = entry.getBoundingClientRect();
			return (
				entry.scrollWidth <= entry.clientWidth + 1 &&
				[...entry.querySelectorAll('strong, p, button')].every((child) => {
					const rect = child.getBoundingClientRect();
					return (
						rect.left >= bounds.left + 8 &&
						rect.right <= bounds.right - 8 &&
						child.scrollWidth <= child.clientWidth + 1
					);
				})
			);
		})
	);
	expect(contained, 'Conflict text and actions need breathing room within their containers').toBe(
		true
	);
	await expect(page.getByRole('tab', { name: 'Shortcuts' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Keep saved version', exact: true }).first().click();
	await expect(page.locator('.conflict-entry')).toHaveCount(1);
	const draft = await page.evaluate(async (name) => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
		});
		const value = await new Promise<{ body: string }>((resolve) => {
			const request = db.transaction('drafts').objectStore('drafts').get('bookmark');
			request.onsuccess = () => resolve(request.result);
		});
		db.close();
		return value;
	}, databaseName);
	expect(draft.body).toBe('Keep this note.');
});
