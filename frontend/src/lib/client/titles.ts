// A page's title, looked up by the server. Shared across components and mounts, so a title
// fetched while typing a link is ready by the time it's saved.
const titleRequests = new Map<string, Promise<string>>();

export function requestTitle(target: string): Promise<string> {
	const existing = titleRequests.get(target);
	if (existing) return existing;
	const request = fetch(`/api/v1/metadata?url=${encodeURIComponent(target)}`, {
		headers: { accept: 'application/json' }
	})
		.then(async (response) => {
			if (!response.ok) throw new Error('Title lookup failed.');
			const payload: unknown = await response.json();
			return payload &&
				typeof payload === 'object' &&
				typeof (payload as { title?: unknown }).title === 'string'
				? (payload as { title: string }).title.trim()
				: '';
		})
		.catch((error) => {
			titleRequests.delete(target);
			throw error;
		});
	if (titleRequests.size >= 50) titleRequests.delete(titleRequests.keys().next().value!);
	titleRequests.set(target, request);
	return request;
}

/** The title, or '' if it takes longer than `ms` or the lookup fails. */
export function titleWithin(target: string, ms: number): Promise<string> {
	return Promise.race([
		requestTitle(target).catch(() => ''),
		new Promise<string>((resolve) => setTimeout(() => resolve(''), ms))
	]);
}
