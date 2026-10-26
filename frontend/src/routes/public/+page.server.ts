import { error } from '@sveltejs/kit';
import { publicSnapshot } from '#lib/server/vault/public-view.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	const snapshot = await publicSnapshot();
	if (!snapshot) error(404, 'Not found');
	// Short shared caching: edits show up within a minute without hammering the database.
	setHeaders({ 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
	return { snapshot };
};
