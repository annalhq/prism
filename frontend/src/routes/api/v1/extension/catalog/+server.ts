import type { RequestHandler } from './$types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireExtensionOwner } from '#lib/server/extension-auth.js';
import { database } from '#lib/server/db/connection.js';
import { entities, people, tags } from '#lib/server/db/schema.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireExtensionOwner(event.request);
		const [tagRows, personRows] = await Promise.all([
			database()
				.select({ id: tags.id, name: tags.name })
				.from(tags)
				.where(and(eq(tags.vaultId, owner.vaultId), isNull(tags.deletedAt)))
				.orderBy(asc(tags.name))
				.limit(1000),
			database()
				.select({ id: people.id, displayName: people.displayName })
				.from(people)
				.innerJoin(entities, and(eq(entities.vaultId, people.vaultId), eq(entities.id, people.id)))
				.where(
					and(
						eq(people.vaultId, owner.vaultId),
						eq(entities.kind, 'person'),
						isNull(entities.deletedAt),
						isNull(entities.purgedAt)
					)
				)
				.orderBy(asc(people.displayName))
				.limit(1000)
		]);
		return Response.json(
			{ tags: tagRows, people: personRows },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
