import { normalizeUrl } from './urls.js';

/** One profile a person is known by, stored as a confirmed person identity. */
export type PersonLink = { platform: string; profileUrl: string; handle: string | null };

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']);
// Paths on x.com that are pages, not accounts.
const X_RESERVED = new Set([
	'home',
	'explore',
	'search',
	'i',
	'intent',
	'share',
	'settings',
	'messages',
	'notifications',
	'hashtag',
	'login',
	'signup',
	'tos',
	'privacy'
]);
const PLATFORMS: [RegExp, string][] = [
	[/(^|\.)github\.com$/, 'github'],
	[/(^|\.)linkedin\.com$/, 'linkedin'],
	[/(^|\.)bsky\.app$/, 'bluesky'],
	[/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
	[/(^|\.)instagram\.com$/, 'instagram'],
	[/(^|\.)threads\.net$/, 'threads'],
	[/(^|\.)substack\.com$/, 'substack'],
	[/(^|\.)medium\.com$/, 'medium']
];

export function xLink(handle: string): PersonLink {
	const name = handle.replace(/^@/, '');
	if (!X_HANDLE.test(name))
		throw new Error(`“@${name}” is not a valid X username (letters, digits and _, up to 15).`);
	return {
		platform: 'x',
		handle: name,
		profileUrl: normalizeUrl(`https://x.com/${name}`).canonicalUrl
	};
}

function linkFromUrl(input: string): PersonLink {
	let parsed: ReturnType<typeof normalizeUrl>;
	try {
		parsed = normalizeUrl(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
	} catch {
		throw new Error(`“${input}” is not a valid link or @username.`);
	}
	const url = new URL(parsed.canonicalUrl);
	const host = url.hostname.replace(/^www\./, '');
	const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
	if (X_HOSTS.has(host) && X_HANDLE.test(first) && !X_RESERVED.has(first.toLowerCase()))
		return xLink(first);
	const platform = PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] ?? 'web';
	const handle =
		platform !== 'web' && first && !first.includes('.')
			? decodeURIComponent(first).replace(/^@/, '')
			: null;
	return { platform, handle, profileUrl: parsed.canonicalUrl };
}

/**
 * Reads the person form's links field: `@username, https://site.com, github.com/name`.
 * The first plain web link becomes the person's website; every other entry, including the
 * X username, becomes a confirmed identity.
 */
export function parsePersonLinks(input: string): { website: string | null; links: PersonLink[] } {
	const seen = new Set<string>();
	const all: PersonLink[] = [];
	for (const token of input.split(/[,\n]/)) {
		const value = token.trim();
		if (!value) continue;
		const link = value.startsWith('@') ? xLink(value) : linkFromUrl(value);
		if (seen.has(link.profileUrl)) continue;
		seen.add(link.profileUrl);
		all.push(link);
	}
	const site = all.find((link) => link.platform === 'web');
	return {
		website: site?.profileUrl ?? null,
		links: all.filter((link) => link !== site)
	};
}

/** The inverse of parsePersonLinks, for prefilling the edit form. */
export function formatPersonLinks(
	website: string | null | undefined,
	links: { platform: string; profileUrl: string; handle?: string | null }[]
): string {
	return [
		...links
			.filter((link) => link.platform === 'x' && link.handle)
			.map((link) => `@${link.handle}`),
		...(website ? [website] : []),
		...links.filter((link) => !(link.platform === 'x' && link.handle)).map((l) => l.profileUrl)
	].join(', ');
}

/** A short label for a profile link chip. */
export function linkLabel(link: { platform: string; profileUrl: string; handle?: string | null }) {
	if (link.platform === 'x' && link.handle) return `@${link.handle}`;
	try {
		const url = new URL(link.profileUrl);
		const path = url.pathname.replace(/\/$/, '');
		return `${url.hostname.replace(/^www\./, '')}${path.length > 1 && path.length < 24 ? path : ''}`;
	} catch {
		return link.profileUrl;
	}
}
