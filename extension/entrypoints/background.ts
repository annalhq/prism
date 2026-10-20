import { browser } from 'wxt/browser';
import type { ExtensionMessage } from '../lib/protocol';
import { getPairingOrigin } from '../lib/protocol';

type Connection = { origin: string; token: string; connectionId: string };
const connectionKey = 'prismConnection';

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
		throw new Error(
			body.message ?? body.error?.message ?? `Prism request failed (${response.status}).`
		);
	return body as T;
}

export default defineBackground(() => {
	browser.runtime.onMessage.addListener(async (message: ExtensionMessage) => {
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
					body: JSON.stringify({ code: message.code.trim() })
				});
				const body = await response.json().catch(() => ({}));
				if (!response.ok)
					throw new Error(body.message ?? 'Pairing failed. Generate a fresh code on Prism.');
				await browser.storage.local.set({
					[connectionKey]: { origin, token: body.token, connectionId: body.connectionId }
				});
				return { connected: true, origin };
			}
			if (message.type === 'disconnect') {
				await browser.storage.local.remove(connectionKey);
				return { disconnected: true };
			}
			const connection = await getConnection();
			if (!connection) throw new Error('Connect the extension from Prism’s Account panel first.');
			if (message.type === 'catalog') return await api(connection, '/api/v1/extension/catalog');
			if (message.type === 'save')
				return await api(connection, '/api/v1/extension/bookmarks', {
					method: 'POST',
					body: JSON.stringify(message.input)
				});
			throw new Error('Unknown extension request.');
		} catch (error) {
			return { error: (error as Error).message };
		}
	});
});
