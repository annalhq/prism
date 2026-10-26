import type { RequestHandler } from './$types';
import { ApiError } from '#lib/server/http.js';
import { fetchPageTitle } from '#lib/server/metadata.js';

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) throw new ApiError(400, 'url_required', 'A link is required.');
	const title = await fetchPageTitle(target);
	return Response.json({ title }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
};
