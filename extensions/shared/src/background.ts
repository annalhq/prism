import { browser, type Browser } from 'wxt/browser';
import { browserId } from './platform';
import type { Catalog, ExtensionMessage, SaveInput } from './protocol';
import { getPairingOrigin } from './protocol';

type Connection = { origin: string; token: string; connectionId: string };
type PendingSave = { connectionId: string; input: SaveInput; createdAt: number; tabId?: number };
type CachedCatalog = {
	connectionId: string;
	origin: string;
	fetchedAt: number;
	catalog: Catalog;
};
const connectionKey = 'prismConnection';
const catalogKey = 'prismCatalog';
const outboxKey = 'prismSaveOutbox';
const outboxAlarm = 'prism-save-outbox';
let catalogRefresh: { connectionId: string; promise: Promise<Catalog> } | undefined;
let flushingOutbox = false;
let outboxUpdate: Promise<unknown> = Promise.resolve();

class ApiRequestError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function getConnection(): Promise<Connection | null> {
	const stored = await browser.storage.local.get(connectionKey);
	return (stored[connectionKey] as Connection | undefined) ?? null;
}

async function api<T>(connection: Connection, path: string, init?: RequestInit): Promise<T> {
	const allowed = await browser.permissions.contains({ origins: [`${connection.origin}/*`] });
	if (!allowed) throw new Error('Grant Prism site access again from the extension popup.');
	const response = await fetch(`${connection.origin}${path}`, {
		cache: 'no-store',
		credentials: 'omit',
		...init,
		headers: {
			Authorization: `Bearer ${connection.token}`,
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...init?.headers
		}
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok)
		throw new ApiRequestError(
			body.message ?? body.error?.message ?? `Prism request failed (${response.status}).`,
			response.status
		);
	return body as T;
}

async function refreshCatalog(connection: Connection): Promise<Catalog> {
	if (catalogRefresh?.connectionId === connection.connectionId) return catalogRefresh.promise;
	const promise = api<Catalog>(connection, '/api/v1/extension/catalog').then(async (catalog) => {
		const cache: CachedCatalog = {
			connectionId: connection.connectionId,
			origin: connection.origin,
			fetchedAt: Date.now(),
			catalog
		};
		await browser.storage.local.set({ [catalogKey]: cache });
		return catalog;
	});
	catalogRefresh = { connectionId: connection.connectionId, promise };
	try {
		return await promise;
	} finally {
		if (catalogRefresh?.promise === promise) catalogRefresh = undefined;
	}
}

/**
 * The stored catalog answers at once so the form never waits; the form then asks again with
 * `fresh` every time it opens, so tags and people made in Prism show up right away instead of
 * after a cache lifetime.
 */
async function getCatalog(
	connection: Connection,
	fresh = false
): Promise<Catalog & { cached: boolean }> {
	if (!fresh) {
		const stored = await browser.storage.local.get(catalogKey);
		const cache = stored[catalogKey] as CachedCatalog | undefined;
		if (cache?.connectionId === connection.connectionId && cache.origin === connection.origin)
			return { ...cache.catalog, cached: true };
	}
	return { ...(await refreshCatalog(connection)), cached: false };
}

async function readOutbox(): Promise<PendingSave[]> {
	const stored = await browser.storage.local.get(outboxKey);
	return (stored[outboxKey] as PendingSave[] | undefined) ?? [];
}

async function writeOutbox(items: PendingSave[]) {
	if (items.length) await browser.storage.local.set({ [outboxKey]: items });
	else await browser.storage.local.remove(outboxKey);
}

function updateOutbox(update: (items: PendingSave[]) => PendingSave[]) {
	const operation = outboxUpdate.then(async () => {
		const items = await readOutbox();
		const updated = update(items);
		await writeOutbox(updated);
		return updated;
	});
	outboxUpdate = operation.catch(() => undefined);
	return operation;
}

function reportSave(
	tabId: number | undefined,
	operationId: string,
	result: { status?: 'accepted' | 'already_exists'; error?: string }
) {
	if (tabId === undefined) return;
	void browser.tabs.sendMessage(tabId, {
		type: 'save-result',
		operationId,
		status: result.status,
		error: result.error
	} satisfies ExtensionMessage).catch(() => {});
}

async function flushOutbox() {
	if (flushingOutbox) return;
	flushingOutbox = true;
	try {
		const connection = await getConnection();
		if (!connection) return;
		const items = await readOutbox();
		for (const item of items) {
			if (item.connectionId !== connection.connectionId) {
				await updateOutbox((current) =>
					current.filter((candidate) => candidate.input.operationId !== item.input.operationId)
				);
				reportSave(item.tabId, item.input.operationId, {
					error: 'The Prism connection changed before this bookmark could be sent. Save it again.'
				});
				continue;
			}
			try {
				const result = await api<{ status?: string }>(connection, '/api/v1/extension/bookmarks', {
					method: 'POST',
					body: JSON.stringify(item.input)
				});
				await updateOutbox((current) =>
					current.filter((candidate) => candidate.input.operationId !== item.input.operationId)
				);
				reportSave(item.tabId, item.input.operationId, {
					status: result.status === 'already_exists' ? 'already_exists' : 'accepted'
				});
				// Tags made by this save belong in the catalog for the next one.
				if (item.input.command.newTags?.length) void refreshCatalog(connection).catch(() => {});
			} catch (error) {
				const status = error instanceof ApiRequestError ? error.status : undefined;
				const deniedPermission = (error as Error).message.includes('Grant Prism site access again');
				if ((status && status >= 400 && status < 500) || deniedPermission) {
					await updateOutbox((current) =>
						current.filter((candidate) => candidate.input.operationId !== item.input.operationId)
					);
					reportSave(item.tabId, item.input.operationId, { error: (error as Error).message });
					continue;
				}
				await browser.alarms.create(outboxAlarm, { when: Date.now() + 30_000 });
				return;
			}
		}
		if ((await readOutbox()).length)
			await browser.alarms.create(outboxAlarm, { when: Date.now() + 30_000 });
		else await browser.alarms.clear(outboxAlarm);
	} finally {
		flushingOutbox = false;
	}
}

async function handleMessage(
	message: ExtensionMessage,
	sender: Browser.runtime.MessageSender
): Promise<unknown> {
	try {
		if (message.type === 'connection') {
			const current = await getConnection();
			return current ? { connected: true, origin: current.origin } : { connected: false };
		}
		if (message.type === 'pair') {
			const origin = getPairingOrigin(message.code);
			const allowed = await browser.permissions.contains({ origins: [`${origin}/*`] });
			if (!allowed) throw new Error('Allow access to this Prism site before connecting.');
			const response = await fetch(`${origin}/api/v1/extension/pair`, {
				method: 'POST',
				cache: 'no-store',
				credentials: 'omit',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: message.code.trim(), browser: browserId })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok)
				throw new Error(body.message ?? 'Pairing failed. Generate a fresh code on Prism.');
			await browser.storage.local.set({
				[connectionKey]: { origin, token: body.token, connectionId: body.connectionId }
			});
			await browser.storage.local.remove(catalogKey);
			void flushOutbox();
			return { connected: true, origin };
		}
		if (message.type === 'disconnect') {
			await browser.storage.local.remove([connectionKey, catalogKey]);
			return { disconnected: true };
		}
		const connection = await getConnection();
		if (!connection) throw new Error('Connect the extension from Prism’s Account panel first.');
		if (message.type === 'catalog') return await getCatalog(connection, message.fresh);
		if (message.type === 'save') {
			await updateOutbox((pending) =>
				pending.some((item) => item.input.operationId === message.input.operationId)
					? pending
					: [
							...pending,
							{
								connectionId: connection.connectionId,
								input: message.input,
								createdAt: Date.now(),
								tabId: sender.tab?.id
							}
						]
			);
			await browser.alarms.create(outboxAlarm, { when: Date.now() + 30_000 });
			void flushOutbox();
			return { queued: true, operationId: message.input.operationId };
		}
		throw new Error('Unknown extension request.');
	} catch (error) {
		return { error: (error as Error).message };
	}
}

/**
 * Registers the background listeners. Responses go through `sendResponse` (with `return true` to
 * keep the channel open) rather than a returned Promise: Firefox accepts either, but Chrome only
 * reliably delivers async replies this way.
 */
export function startBackground() {
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === outboxAlarm) void flushOutbox();
	});
	browser.runtime.onStartup.addListener(() => void flushOutbox());
	browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
		void handleMessage(message, sender).then(sendResponse);
		return true;
	});
	void flushOutbox();
}
