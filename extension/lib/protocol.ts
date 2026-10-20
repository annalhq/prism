export type PersonRole = 'author' | 'about' | 'related';
export type Capture = { title: string; url: string; kind: 'page' | 'social' };
export type Catalog = {
	tags: { id: string; name: string }[];
	people: { id: string; displayName: string }[];
};
export type SaveInput = {
	operationId: string;
	command: {
		type: 'extension.bookmark.create';
		id: string;
		kind: 'page' | 'social';
		title: string;
		url: string;
		tagIds: string[];
		person?: { id: string; role: PersonRole };
	};
};

export type ExtensionMessage =
	| { type: 'connection'; code?: string }
	| { type: 'pair'; code: string }
	| { type: 'catalog' }
	| { type: 'save'; input: SaveInput }
	| { type: 'disconnect' };

export function getPairingOrigin(code: string): string {
	const [version, encodedOrigin, secret, extra] = code.trim().split('.');
	if (version !== 'prism1' || !encodedOrigin || !secret || extra !== undefined)
		throw new Error('That pairing code does not look valid.');
	let origin: string;
	try {
		origin = new TextDecoder().decode(
			Uint8Array.from(atob(encodedOrigin.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
				char.charCodeAt(0)
			)
		);
	} catch {
		throw new Error('That pairing code has an unreadable site address.');
	}
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw new Error('That pairing code has an invalid site address.');
	}
	if (
		parsed.origin !== origin ||
		(parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
	)
		throw new Error('Prism pairing requires a secure HTTPS site address.');
	return parsed.origin;
}
