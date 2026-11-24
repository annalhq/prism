import { asset } from '$app/paths';

export type IconSize = { naturalWidth: number; naturalHeight: number };

export type FaviconSource = {
	src: string;
	/** False when the loaded image is the provider's "no icon" placeholder. */
	accepts: (image: IconSize) => boolean;
};

const always = () => true;

// Google answers a miss with HTTP 404 and a 16×16 globe, which an <img> still loads.
const GOOGLE_PLACEHOLDER_SIZE = 16;

const google = (host: string): FaviconSource => ({
	// `domain_url` with https: `domain=` looks up the http origin, which misses https-only sites.
	src: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${host}`)}&sz=64`,
	accepts: (image) => image.naturalWidth > GOOGLE_PLACEHOLDER_SIZE
});

const duckDuckGo = (host: string): FaviconSource => ({
	src: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
	accepts: always
});

const bundled = (path: Parameters<typeof asset>[0]): FaviconSource => ({
	src: asset(path),
	accepts: always
});

const matches = (host: string, domains: string[]) =>
	domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

// Single-label names, IPv4/IPv6 literals and reserved local suffixes.
const PRIVATE_HOST =
	/^(?:[^.]+|\d+\.\d+\.\d+\.\d+|.*:.*|.*\.(?:localhost|local|internal|lan|home|test))$/i;

/** The lowercase hostname of a public http(s) URL without credentials, else null. */
export function faviconHost(input: string | null): string | null {
	let url: URL;
	try {
		url = new URL(input ?? '');
	} catch {
		return null;
	}
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
	return url.hostname.toLowerCase().replace(/\.$/, '');
}

/** Sources to try in order. Providers only ever receive the hostname. */
export function sourcesFor(host: string): FaviconSource[] {
	if (matches(host, ['x.com', 'twitter.com'])) return [bundled('site-icons/twitter.svg')];
	if (matches(host, ['youtube.com', 'youtu.be'])) return [bundled('site-icons/youtube.svg')];
	if (PRIVATE_HOST.test(host)) return [];
	return [google(host), duckDuckGo(host)];
}
