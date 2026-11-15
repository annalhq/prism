import { browser, type Browser } from 'wxt/browser';
import { browserId } from './platform';
import type { Catalog, ExtensionMessage, Highlight, SaveInput } from './protocol';
import { getPairingOrigin, highlightOrigins, showHighlightsKey } from './protocol';
import { catalogKey } from './theme';

type Connection = { origin: string; token: string; connectionId: string; name?: string };
type PendingSave = {
	connectionId: string;
	input: SaveInput;
	createdAt: number;
	/** The tab that asked, for its save result. */
	tabId?: number;
	/** The tab showing the page, to repaint its highlights. */
	pageTabId?: number;
};
type CachedCatalog = {
	connectionId: string;
	origin: string;
	fetchedAt: number;
	catalog: Catalog;
};
const connectionKey = 'prismConnection';
const outboxKey = 'prismSaveOutbox';
const outboxAlarm = 'prism-save-outbox';
const highlightsScriptId = 'prism-highlights';
const selectionMenuId = 'prism-add-selection';
// A stored catalog older than this is refreshed in the background when a page asks about it.
const catalogMaxAge = 30 * 60_000;
let catalogRefresh: { connectionId: string; promise: Promise<Catalog> } | undefined;
/** Highlights per page (URL hash), kept while the background is awake. */
const highlightCache = new Map<string, { at: number; highlights: Highlight[] }>();
/** A selection picked with the context menu, waiting for the popup it opened. */
let pendingSelection:
	| {
			tabId: number;
			at: number;
			result: Promise<{ description: string; highlight?: Highlight } | null>;
	  }
	| undefined;
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
	void browser.tabs
		.sendMessage(tabId, {
			type: 'save-result',
			operationId,
			status: result.status,
			error: result.error
		} satisfies ExtensionMessage)
		.catch(() => {});
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
				// Tags made by this save, and the page's highlights, belong in the catalog.
				if (item.input.command.newTags?.length || item.input.command.highlight)
					void refreshCatalog(connection).catch(() => {});
				if (item.input.command.highlight) {
					highlightCache.clear();
					const pageTabId = item.pageTabId ?? item.tabId;
					if (pageTabId !== undefined)
						void browser.tabs
							.sendMessage(pageTabId, { type: 'highlights-changed' } satisfies ExtensionMessage)
							.catch(() => {});
				}
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

/**
 * Highlights saved on the page with one of these URL hashes. Pages not in the catalog's list
 * are answered here without asking Prism, so browsing elsewhere stays on this device.
 */
async function pageHighlights(connection: Connection, urlHashes: string[]): Promise<Highlight[]> {
	const stored = await browser.storage.local.get(catalogKey);
	const cache = stored[catalogKey] as CachedCatalog | undefined;
	const current = cache?.connectionId === connection.connectionId ? cache : undefined;
	if (!current || Date.now() - current.fetchedAt > catalogMaxAge)
		void refreshCatalog(connection).catch(() => {});
	const listed = new Set(current?.catalog.highlightedUrls ?? []);
	const hash = urlHashes.find((candidate) => listed.has(candidate));
	if (!hash) return [];
	const cached = highlightCache.get(hash);
	if (cached && Date.now() - cached.at < 5 * 60_000) return cached.highlights;
	const { highlights } = await api<{ highlights: Highlight[] }>(
		connection,
		`/api/v1/extension/highlights?urlHash=${hash}`
	);
	highlightCache.set(hash, { at: Date.now(), highlights });
	return highlights;
}

/** Registers the page script that paints highlights when the setting is on and access allows. */
async function syncHighlightsScript() {
	const stored = await browser.storage.local.get(showHighlightsKey);
	const wanted =
		stored[showHighlightsKey] === true &&
		(await browser.permissions.contains({ origins: highlightOrigins }));
	const registered = await browser.scripting.getRegisteredContentScripts({
		ids: [highlightsScriptId]
	});
	if (wanted && !registered.length)
		await browser.scripting.registerContentScripts([
			{
				id: highlightsScriptId,
				matches: highlightOrigins,
				js: ['/highlights.js'],
				runAt: 'document_idle',
				persistAcrossSessions: true
			}
		]);
	else if (!wanted && registered.length)
		await browser.scripting.unregisterContentScripts({ ids: [highlightsScriptId] });
}

/**
 * "Add to Prism" on a selection: read it in the page and open the popup, which picks it up.
 * Both start in the click handler itself, with nothing awaited first, because opening the popup
 * needs the user's gesture and Firefox forgets it after the first await.
 */
function addSelection(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) {
	if (info.menuItemId !== selectionMenuId || tab?.id === undefined) return;
	const tabId = tab.id;
	const fallback = info.selectionText ? { description: info.selectionText.trim() } : null;
	const result = browser.scripting
		.executeScript({
			target: { tabId, frameIds: [info.frameId ?? 0] },
			files: ['/selection.js']
		})
		.then(
			(results) =>
				(results[0]?.result as { description: string; highlight?: Highlight } | null) ?? fallback
		)
		.catch(() => fallback);
	pendingSelection = { tabId, at: Date.now(), result };
	browser.action.openPopup().catch(() => {
		// No popup without a focused window; the badge says the selection is waiting.
		void browser.action.setBadgeText({ tabId, text: '1' }).catch(() => {});
	});
}

async function handleMessage(
	message: ExtensionMessage,
	sender: Browser.runtime.MessageSender
): Promise<unknown> {
	try {
		if (message.type === 'connection') {
			const current = await getConnection();
			return current
				? { connected: true, origin: current.origin, name: current.name }
				: { connected: false };
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
				body: JSON.stringify({ code: message.code.trim(), browser: browserId, name: message.name })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok)
				throw new Error(body.message ?? 'Pairing failed. Generate a fresh code on Prism.');
			await browser.storage.local.set({
				[connectionKey]: {
					origin,
					token: body.token,
					connectionId: body.connectionId,
					name: message.name
				} satisfies Connection
			});
			await browser.storage.local.remove(catalogKey);
			highlightCache.clear();
			void flushOutbox();
			return { connected: true, origin, name: message.name };
		}
		if (message.type === 'disconnect') {
			await browser.storage.local.remove([connectionKey, catalogKey]);
			highlightCache.clear();
			return { disconnected: true };
		}
		if (message.type === 'take-highlight') {
			const pending = pendingSelection;
			if (!pending || pending.tabId !== message.tabId || Date.now() - pending.at > 120_000)
				return { selection: null };
			pendingSelection = undefined;
			void browser.action.setBadgeText({ tabId: pending.tabId, text: '' }).catch(() => {});
			return { selection: await pending.result };
		}
		if (message.type === 'set-show-highlights') {
			await browser.storage.local.set({ [showHighlightsKey]: message.enabled });
			await syncHighlightsScript();
			return { enabled: message.enabled };
		}
		const connection = await getConnection();
		if (!connection) throw new Error('Connect the extension from Prism’s Account panel first.');
		if (message.type === 'catalog') return await getCatalog(connection, message.fresh);
		if (message.type === 'highlights')
			return { highlights: await pageHighlights(connection, message.urlHashes) };
		if (message.type === 'rename') {
			const { name } = await api<{ name: string }>(connection, '/api/v1/extension/connection', {
				method: 'PATCH',
				body: JSON.stringify({ name: message.name })
			});
			await browser.storage.local.set({ [connectionKey]: { ...connection, name } });
			return { name };
		}
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
								tabId: sender.tab?.id,
								pageTabId: sender.tab?.id ?? message.pageTabId
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
	// Menus are recreated on every start; Firefox doesn't keep them for event pages.
	void browser.contextMenus
		.removeAll()
		.then(() =>
			browser.contextMenus.create({
				id: selectionMenuId,
				title: 'Add to Prism',
				contexts: ['selection']
			})
		)
		.catch(() => {});
	browser.contextMenus.onClicked.addListener(addSelection);
	// Access to sites can be withdrawn in the browser's settings; the script follows.
	browser.permissions.onRemoved.addListener(() => void syncHighlightsScript().catch(() => {}));
	void syncHighlightsScript().catch(() => {});
	browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
		void handleMessage(message, sender).then(sendResponse);
		return true;
	});
	void flushOutbox();
}
