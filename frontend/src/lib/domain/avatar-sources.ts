// Where a person's profile photo can come from: the profile links unavatar.io can read a photo
// from. Shared by the server (which fetches and stores the photo) and the client (which only
// asks for a photo when there is a source, and puts the source in the URL so a changed link is
// a fresh URL).

export const AVATAR_PROVIDERS = ['x', 'github', 'youtube', 'codeforces', 'bilibili'] as const;
export type AvatarProvider = (typeof AVATAR_PROVIDERS)[number];
export type AvatarSource = { provider: AvatarProvider; id: string };

/** `provider:id`, as stored in person_avatars.handle and sent in the photo URL. */
export const AVATAR_SOURCE_KEY = /^(x|github|youtube|codeforces|bilibili):[A-Za-z0-9._-]{1,64}$/;
export const sourceKey = (source: AvatarSource) => `${source.provider}:${source.id}`;

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']);
const X_RESERVED = new Set(
	'home explore search i intent share settings messages notifications hashtag login signup tos privacy'.split(
		' '
	)
);
const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// github.com paths that are pages, not users or organizations.
const GITHUB_RESERVED = new Set(
	'about orgs sponsors settings features topics marketplace explore login join pricing enterprise collections trending notifications pulls issues search apps site security customer-stories readme events codespaces new organizations dashboard'.split(
		' '
	)
);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com']);
const YOUTUBE_HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const YOUTUBE_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const CODEFORCES_HANDLE = /^[A-Za-z0-9_.-]{1,24}$/;
const BILIBILI_ID = /^\d{1,19}$/;

/** The photo source a single profile URL points at, or null when it isn't one. */
export function avatarSourceFromUrl(value: string): AvatarSource | null {
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const parts = url.pathname
		.split('/')
		.filter(Boolean)
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return part;
			}
		});
	const [first = '', second = ''] = parts;
	if (X_HOSTS.has(host))
		return X_HANDLE.test(first) && !X_RESERVED.has(first.toLowerCase())
			? { provider: 'x', id: first.toLowerCase() }
			: null;
	if (host === 'github.com')
		return GITHUB_USER.test(first) && !GITHUB_RESERVED.has(first.toLowerCase())
			? { provider: 'github', id: first.toLowerCase() }
			: null;
	if (YOUTUBE_HOSTS.has(host)) {
		// youtube.com/@handle, /channel/UC…, and the legacy /c/name and /user/name.
		if (first.startsWith('@') && YOUTUBE_HANDLE.test(first.slice(1)))
			return { provider: 'youtube', id: first.slice(1) };
		if (first === 'channel' && YOUTUBE_CHANNEL.test(second))
			return { provider: 'youtube', id: second };
		if ((first === 'c' || first === 'user') && YOUTUBE_HANDLE.test(second))
			return { provider: 'youtube', id: second };
		return null;
	}
	if (host === 'codeforces.com' || host.endsWith('.codeforces.com'))
		return first === 'profile' && CODEFORCES_HANDLE.test(second)
			? { provider: 'codeforces', id: second.toLowerCase() }
			: null;
	// space.bilibili.com/<member id>, or m.bilibili.com/space/<member id>.
	if (host === 'space.bilibili.com')
		return BILIBILI_ID.test(first) ? { provider: 'bilibili', id: first } : null;
	if (host.endsWith('bilibili.com') && first === 'space' && BILIBILI_ID.test(second))
		return { provider: 'bilibili', id: second };
	return null;
}

/**
 * The one source to use for a person: the first provider, in AVATAR_PROVIDERS order, that any
 * of their profile links (or their website) points at. X comes first, as it always has.
 */
export function avatarSourceFor(
	links: readonly { platform?: unknown; profileUrl?: unknown; handle?: unknown }[],
	website?: unknown
): AvatarSource | null {
	const found = new Map<AvatarProvider, AvatarSource>();
	for (const link of links) {
		// A confirmed X identity carries its handle; trust it over parsing the URL.
		if (link.platform === 'x' && typeof link.handle === 'string') {
			const handle = link.handle.replace(/^@/, '');
			if (X_HANDLE.test(handle) && !found.has('x'))
				found.set('x', { provider: 'x', id: handle.toLowerCase() });
			continue;
		}
		const source =
			typeof link.profileUrl === 'string' ? avatarSourceFromUrl(link.profileUrl) : null;
		if (source && !found.has(source.provider)) found.set(source.provider, source);
	}
	if (typeof website === 'string') {
		const source = avatarSourceFromUrl(website);
		if (source && !found.has(source.provider)) found.set(source.provider, source);
	}
	for (const provider of AVATAR_PROVIDERS) {
		const source = found.get(provider);
		if (source) return source;
	}
	return null;
}
