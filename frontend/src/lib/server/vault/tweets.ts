import { and, eq, isNull } from 'drizzle-orm';
import type { Change } from '#lib/domain/contracts.js';
import { normalizeOrganizationName } from '#lib/domain/organization.js';
import { TWEETS_TAG, tweetStatusId } from '#lib/domain/tweets.js';
import type { Transaction } from '../db/connection.js';
import { entityTags, tags } from '../db/schema.js';
import { changeTagMembership, changeTaxonomy } from './organization.js';

/**
 * Files a newly saved post from X under the `tweets` tag, creating the tag the first time.
 * Runs inside the create command, so every client (web, extension, import) gets the same
 * result and the tag arrives with the bookmark in one change frame.
 */
export async function tagTweet(
	tx: Transaction,
	vaultId: string,
	bookmarkId: string,
	url: string | null | undefined,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	if (!tweetStatusId(url)) return [];
	const changes: Change[] = [];
	const { normalizedName } = normalizeOrganizationName(TWEETS_TAG);
	const [existing] = await tx
		.select({ id: tags.id })
		.from(tags)
		.where(
			and(
				eq(tags.vaultId, vaultId),
				eq(tags.normalizedName, normalizedName),
				isNull(tags.deletedAt)
			)
		)
		.limit(1);
	let tagId = existing?.id;
	if (!tagId) {
		tagId = crypto.randomUUID();
		changes.push(
			...(await changeTaxonomy(
				tx,
				vaultId,
				{ type: 'tag.create', id: tagId, name: TWEETS_TAG },
				seq,
				now
			))
		);
	} else {
		// The capture may already have chosen the tag; adding it again would only bump revisions.
		const [member] = await tx
			.select({ tagId: entityTags.tagId })
			.from(entityTags)
			.where(
				and(
					eq(entityTags.vaultId, vaultId),
					eq(entityTags.entityId, bookmarkId),
					eq(entityTags.tagId, tagId)
				)
			)
			.limit(1);
		if (member) return [];
	}
	changes.push(
		...(await changeTagMembership(
			tx,
			vaultId,
			{ type: 'tag.add', id: bookmarkId, tagId },
			seq,
			now,
			true
		))
	);
	return changes;
}
