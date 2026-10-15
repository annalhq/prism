import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	const owner = await requireOwner(event);
	return Response.json({
		subject: owner.subject,
		vaultId: owner.vaultId,
		protocolVersion: 1,
		capabilities: { session: true, commands: true, sync: false, media: false },
		commandTypes: [
			'bookmark.create',
			'bookmark.update',
			'bookmark.trash',
			'bookmark.restore',
			'bookmark.purge',
			'bookmark.bulk'
		]
	});
};
