import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	const owner = await requireOwner(event);
	return Response.json({
		subject: owner.subject,
		vaultId: owner.vaultId,
		protocolVersion: 1,
		capabilities: { session: true, commands: true, sync: true, media: false },
		commandTypes: [
			'bookmark.create',
			'bookmark.update',
			'bookmark.trash',
			'bookmark.restore',
			'bookmark.purge',
			'bookmark.bulk',
			'bookmark.organize',
			'note.replace',
			'tag.create',
			'tag.rename',
			'tag.delete',
			'tag.add',
			'tag.remove',
			'collection.create',
			'collection.rename',
			'collection.delete',
			'saved-search.create',
			'saved-search.update',
			'saved-search.delete',
			'activity.open',
			'related-link.add',
			'related-link.remove',
			'person.create',
			'person.update',
			'person.trash',
			'person.restore',
			'person.purge',
			'person-identity.add',
			'person-identity.remove',
			'content-person.add',
			'content-person.remove',
			'persona.create',
			'persona.update',
			'persona.trash',
			'persona.restore',
			'persona.purge',
			'persona-member.add',
			'persona-member.remove'
		]
	});
};
