import type { Appearance } from './theme';

/** Text selected on a page, with a little of the text around it so it can be found again. */
export type Highlight = { text: string; prefix: string; suffix: string };
export type Capture = {
	title: string;
	url: string;
	kind: 'page' | 'social';
	/** Prefills the description, e.g. with a highlight. */
	description?: string;
	highlight?: Highlight;
};
export type Catalog = {
	tags: { id: string; name: string }[];
	people: { id: string; displayName: string }[];
	/** SHA-256 of the canonical URLs of saved pages that have highlights. */
	highlightedUrls?: string[];
	appearance?: Appearance;
};
export type ConnectionInfo =
	{ connected: false } | { connected: true; origin: string; name?: string };
export type SaveInput = {
	protocolVersion: 1;
	operationId: string;
	command: {
		type: 'extension.bookmark.create';
		id: string;
		kind: 'page' | 'social';
		title: string;
		url: string;
		tagIds: string[];
		// Tags typed here that Prism doesn't have yet; Prism creates them (or reuses one of the
		// same name) when it saves the bookmark.
		newTags?: { id: string; name: string }[];
		person?: { id: string };
		description?: string;
		highlight?: Highlight;
	};
};

/** The pages the highlights script runs on; the user grants these when turning it on. */
export const highlightOrigins = ['https://*/*'];
export const showHighlightsKey = 'prismShowHighlights';

export type ExtensionMessage =
	| { type: 'connection'; code?: string }
	| { type: 'pair'; code: string; name: string }
	| { type: 'rename'; name: string }
	// The popup asks for a highlight picked with the context menu on this tab, once.
	| { type: 'take-highlight'; tabId: number }
	// The page script asks for highlights saved on the page with one of these URL hashes.
	| { type: 'highlights'; urlHashes: string[] }
	// The background tells a tab a highlight was just saved on it.
	| { type: 'highlights-changed' }
	| { type: 'set-show-highlights'; enabled: boolean }
	// `fresh` skips the stored copy and asks Prism. The answer says whether it came from storage.
	| { type: 'catalog'; fresh?: boolean }
	// `pageTabId`: the tab the bookmark is for, when saving from the popup.
	| { type: 'save'; input: SaveInput; pageTabId?: number }
	| {
			type: 'save-result';
			operationId: string;
			status?: 'accepted' | 'already_exists';
			error?: string;
	  }
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
