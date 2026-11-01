// Where a person's X photo is served from, when they have an X handle. The handle rides in
// the query string so a changed handle is a fresh URL the browser hasn't cached.
export function personPhoto(id: string, handle: string | null | undefined): string | null {
	const plain = handle?.trim().replace(/^@/, '').toLowerCase();
	if (!plain || !/^[a-z0-9_]{1,15}$/.test(plain)) return null;
	return `/api/v1/people/${encodeURIComponent(id)}/avatar?h=${plain}`;
}
