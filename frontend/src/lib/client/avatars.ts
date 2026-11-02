import { AVATAR_SOURCE_KEY, avatarSourceFor, sourceKey } from '#lib/domain/avatar-sources.js';

// Where a person's profile photo is served from, when one of their profile links (X, GitHub,
// YouTube, Codeforces or Bilibili) can give one. The source rides in the query string, so a
// changed link is a fresh URL the browser hasn't cached; the server works it out on its own.
export function personPhoto(
	id: string,
	links: readonly { platform?: unknown; profileUrl?: unknown; handle?: unknown }[] | undefined,
	website?: unknown
): string | null {
	const source = avatarSourceFor(links ?? [], website);
	if (!source) return null;
	const key = sourceKey(source);
	if (!AVATAR_SOURCE_KEY.test(key)) return null;
	return `/api/v1/people/${encodeURIComponent(id)}/avatar?s=${encodeURIComponent(key)}`;
}
