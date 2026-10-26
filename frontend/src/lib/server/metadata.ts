import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { ApiError } from './http.js';

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
// One deadline covers DNS checks, every redirect hop and the body read.
const TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_TITLES = 500;
const MAX_TITLE_LENGTH = 500;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const namedEntities: Record<string, string> = {
	amp: '&',
	apos: "'",
	bull: '•',
	cent: '¢',
	copy: '©',
	deg: '°',
	divide: '÷',
	euro: '€',
	frac12: '½',
	frac14: '¼',
	frac34: '¾',
	gt: '>',
	hellip: '…',
	laquo: '«',
	ldquo: '“',
	lsquo: '‘',
	lt: '<',
	mdash: '—',
	middot: '·',
	nbsp: ' ',
	ndash: '–',
	para: '¶',
	plusmn: '±',
	pound: '£',
	quot: '"',
	raquo: '»',
	rdquo: '”',
	reg: '®',
	rsquo: '’',
	sect: '§',
	times: '×',
	trade: '™',
	yen: '¥'
};

export function decodeHtmlEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
		if (entity.startsWith('#')) {
			const hexadecimal = entity[1]?.toLowerCase() === 'x';
			const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
			if (
				Number.isInteger(code) &&
				code > 0 &&
				code <= 0x10ffff &&
				!(code >= 0xd800 && code <= 0xdfff)
			) {
				return String.fromCodePoint(code);
			}
			return match;
		}
		return namedEntities[entity.toLowerCase()] ?? match;
	});
}

function cleanTitle(value: string): string {
	const text = decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
		.replace(/\p{Cc}/gu, (character) => (/\s/.test(character) ? ' ' : ''))
		.replace(/\s+/g, ' ')
		.trim();
	return Array.from(text).slice(0, MAX_TITLE_LENGTH).join('');
}

function attributeValue(tag: string, name: string): string | undefined {
	const match = new RegExp(
		`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
		'i'
	).exec(tag);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function extractPageTitle(html: string): string {
	const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
	for (const key of ['og:title', 'twitter:title']) {
		for (const tag of metas) {
			const keys = [attributeValue(tag, 'property'), attributeValue(tag, 'name')]
				.filter((value): value is string => !!value)
				.map((value) => value.toLowerCase());
			if (!keys.includes(key)) continue;
			const content = attributeValue(tag, 'content');
			const title = content ? cleanTitle(content) : '';
			if (title) return title;
		}
	}
	const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	const title = titleTag ? cleanTitle(titleTag) : '';
	if (title) return title;
	const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
	return heading ? cleanTitle(heading) : '';
}

function ipv4Blocked(address: string): boolean {
	const octets = address.split('.').map(Number);
	if (
		octets.length !== 4 ||
		octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
	)
		return true;
	const [a, b, c] = octets;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a === 198 && b === 51 && c === 100) return true;
	if (a === 203 && b === 0 && c === 113) return true;
	if (a >= 224) return true;
	return false;
}

function parseIpv6(address: string): number[] | null {
	const [withoutZone] = address.split('%');
	let normalized = withoutZone;
	const lastColon = normalized.lastIndexOf(':');
	const tail = normalized.slice(lastColon + 1);
	if (tail.includes('.')) {
		const octets = tail.split('.').map(Number);
		if (
			octets.length !== 4 ||
			octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
		)
			return null;
		const high = ((octets[0] << 8) | octets[1]).toString(16);
		const low = ((octets[2] << 8) | octets[3]).toString(16);
		normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
	}
	const halves = normalized.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tailGroups = halves[1] ? halves[1].split(':') : [];
	const missing = 8 - head.length - tailGroups.length;
	if (missing < 0) return null;
	const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tailGroups].map(
		(group) => Number.parseInt(group, 16)
	);
	if (
		groups.length !== 8 ||
		groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
	)
		return null;
	return groups;
}

function ipv6Blocked(address: string): boolean {
	const groups = parseIpv6(address);
	if (!groups) return true;
	// ::/96 covers unspecified, loopback and deprecated IPv4-compatible addresses.
	if (groups.slice(0, 6).every((group) => group === 0)) return true;
	if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
		const embedded = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
		return ipv4Blocked(embedded);
	}
	if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
	if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
	if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8
	if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
	if (groups[0] === 0x2001 && groups[1] === 0x0000) return true; // Teredo
	if (groups[0] === 0x2002) return true; // 6to4
	if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0) return true; // NAT64
	return false;
}

export function isBlockedAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return ipv4Blocked(address);
	if (version === 6) return ipv6Blocked(address);
	return true;
}

function blockedHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, '');
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	);
}

async function assertPublicUrl(url: URL): Promise<void> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new ApiError(400, 'metadata_url_invalid', 'Use an HTTP or HTTPS link.');
	if (url.username || url.password)
		throw new ApiError(400, 'metadata_url_invalid', 'Links with credentials are not supported.');
	if (url.port && url.port !== '80' && url.port !== '443')
		throw new ApiError(400, 'metadata_url_invalid', 'Only standard web ports are supported.');
	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	if (blockedHostname(hostname))
		throw new ApiError(400, 'metadata_url_invalid', 'This host cannot be fetched.');
	if (isIP(hostname)) {
		if (isBlockedAddress(hostname))
			throw new ApiError(400, 'metadata_url_invalid', 'This address cannot be fetched.');
		return;
	}
	let addresses: LookupAddress[];
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new ApiError(502, 'metadata_unavailable', 'Could not resolve this link.');
	}
	if (!Array.isArray(addresses) || addresses.length === 0)
		throw new ApiError(502, 'metadata_unavailable', 'Could not resolve this link.');
	if (addresses.some((entry) => isBlockedAddress(entry.address)))
		throw new ApiError(400, 'metadata_url_invalid', 'This address cannot be fetched.');
}

function responseDecoder(response: Response): TextDecoder {
	const charset = /charset=([^;]+)/i
		.exec(response.headers.get('content-type') ?? '')?.[1]
		?.trim()
		.replace(/^["']|["']$/g, '');
	try {
		return new TextDecoder(charset || 'utf-8', { fatal: false });
	} catch {
		return new TextDecoder('utf-8', { fatal: false });
	}
}

/** Reads only as much of the page as the title needs: usually just the <head>. */
async function readTitle(response: Response): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = responseDecoder(response);
	let html = '';
	let total = 0;
	let headClosed = false;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			const room = MAX_BYTES - total;
			total += part.value.byteLength;
			html += decoder.decode(part.value.subarray(0, room), { stream: true });
			if (total >= MAX_BYTES) break;
			// Head metadata and <title> win over an <h1>, so once the head has closed with a
			// title there is no reason to download the rest of the page.
			if (!headClosed) {
				headClosed = /<\/head\s*>|<body[\s>]/i.test(html.slice(-(part.value.byteLength + 16)));
				if (headClosed && extractPageTitle(html)) break;
			} else if (/<\/h1\s*>/i.test(html.slice(-(part.value.byteLength + 8)))) break;
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	return extractPageTitle(html + decoder.decode());
}

const titles = new Map<string, { title: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

/** Cached and de-duplicated: typing, Enter and a retry for the same link share one fetch. */
export function fetchPageTitle(input: string): Promise<string> {
	const now = Date.now();
	const cached = titles.get(input);
	if (cached && cached.expires > now) {
		// Refresh recency so the map evicts the least recently used title first.
		titles.delete(input);
		titles.set(input, cached);
		return Promise.resolve(cached.title);
	}
	if (cached) titles.delete(input);
	const running = pending.get(input);
	if (running) return running;
	const request = loadPageTitle(input)
		.then((title) => {
			if (titles.size >= MAX_CACHED_TITLES) titles.delete(titles.keys().next().value!);
			titles.set(input, { title, expires: Date.now() + CACHE_TTL_MS });
			return title;
		})
		.finally(() => pending.delete(input));
	pending.set(input, request);
	return request;
}

export function clearPageTitleCache(): void {
	titles.clear();
	pending.clear();
}

async function loadPageTitle(input: string): Promise<string> {
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	let current: URL;
	try {
		current = new URL(input);
	} catch {
		throw new ApiError(400, 'metadata_url_invalid', 'Enter a valid link.');
	}
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		await assertPublicUrl(current);
		let response: Response;
		try {
			response = await fetch(current, {
				redirect: 'manual',
				signal,
				headers: {
					accept: 'text/html,application/xhtml+xml',
					// Compressed pages arrive faster; the reader still bounds decoded bytes.
					'accept-encoding': 'gzip, deflate, br',
					'accept-language': 'en;q=0.9, *;q=0.5',
					'user-agent': 'Prism/0.1 (bookmark title lookup)'
				}
			});
		} catch {
			throw new ApiError(502, 'metadata_unavailable', 'Could not fetch this link.');
		}
		if (REDIRECT_STATUS.has(response.status)) {
			const location = response.headers.get('location');
			if (!location || redirects === MAX_REDIRECTS)
				throw new ApiError(502, 'metadata_unavailable', 'This link redirects too many times.');
			try {
				current = new URL(location, current);
			} catch {
				throw new ApiError(
					502,
					'metadata_unavailable',
					'This link redirected to an invalid address.'
				);
			}
			continue;
		}
		if (!response.ok)
			throw new ApiError(502, 'metadata_unavailable', 'This link could not be loaded.');
		const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
		if (
			contentType &&
			!contentType.includes('text/html') &&
			!contentType.includes('application/xhtml+xml')
		)
			throw new ApiError(422, 'metadata_title_missing', 'This link is not a web page.');
		let title: string;
		try {
			title = await readTitle(response);
		} catch {
			throw new ApiError(502, 'metadata_unavailable', 'Could not fetch this link.');
		}
		if (!title) throw new ApiError(422, 'metadata_title_missing', 'No page title was found.');
		return title;
	}
	throw new ApiError(502, 'metadata_unavailable', 'This link redirects too many times.');
}
