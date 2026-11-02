import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { avatarSourceFor, sourceKey, type AvatarSource } from '#lib/domain/avatar-sources.js';
import type { OwnerContext } from '../auth.js';
import { database } from '../db/connection.js';
import { maintenanceJobs, people, personAvatars, personIdentities } from '../db/schema.js';
import { getObject, putObject, storageConfigured } from '../media/storage.js';
import { fetchPhoto } from '../media/unavatar.js';

// A person's photo comes from the first of their profile links unavatar.io can read one from
// (X, then GitHub, YouTube, Codeforces, Bilibili). It is fetched once per source and stored in
// object storage; every later view is served from storage without calling unavatar again. When
// unavatar has no photo for them, that is remembered too and asked again only after a week.
// While unavatar's daily limit is used up, people show their monogram and are fetched once it
// resets. Changing the link that's used means one new fetch.
const RETRY_MISSING_AFTER = 7 * 24 * 60 * 60 * 1000;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export type AvatarImage = { bytes: Uint8Array; mime: string; sha256: string };
/** Why there is no photo to show (yet), in plain words for the response header. */
export type AvatarMiss = {
	miss: 'no-profile' | 'no-storage' | 'no-photo' | 'unavatar-limit' | 'storage-paused';
	retryAt?: number;
};

// The limit belongs to this server, not to a person, so one moment covers every lookup.
let limitedUntil = 0;
// If storage refuses a photo, fetching more would only spend unavatar's daily allowance on
// photos that can't be kept; pause lookups until storage has had time to be fixed.
const STORAGE_PAUSE = 10 * 60 * 1000;
let storageFailedUntil = 0;
// A few lookups at once, so a first visit to the people page doesn't fire a burst at unavatar;
// the same person is only ever looked up once at a time.
let active = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<AvatarImage | AvatarMiss>>();
async function queued<T>(task: () => Promise<T>): Promise<T> {
	if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
	active++;
	try {
		return await task();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

/** The person's photo source, from their confirmed profile links and their website. */
async function sourceOf(vaultId: string, personId: string): Promise<AvatarSource | null> {
	const db = database();
	const [links, [person]] = await Promise.all([
		db
			.select({
				platform: personIdentities.platform,
				profileUrl: personIdentities.profileUrl,
				handle: personIdentities.handle
			})
			.from(personIdentities)
			.where(
				and(
					eq(personIdentities.vaultId, vaultId),
					eq(personIdentities.personId, personId),
					isNull(personIdentities.deletedAt)
				)
			)
			.orderBy(asc(personIdentities.createdAt)),
		db
			.select({ website: people.website })
			.from(people)
			.where(and(eq(people.vaultId, vaultId), eq(people.id, personId)))
			.limit(1)
	]);
	return avatarSourceFor(links, person?.website);
}

async function lookUp(
	vaultId: string,
	personId: string,
	source: AvatarSource,
	previousKey: string | null
): Promise<AvatarImage | AvatarMiss> {
	// `handle` stores the source key, provider:id.
	const handle = sourceKey(source);
	// Queued lookups recheck: the limit may have been hit, or storage failed, while they waited.
	const paused = pauseReason();
	if (paused) return paused;
	const result = await fetchPhoto(source);
	if (result.kind === 'limited') {
		limitedUntil = result.retryAt;
		return { miss: 'unavatar-limit', retryAt: limitedUntil };
	}
	const db = database();
	if (result.kind === 'missing') {
		await db
			.insert(personAvatars)
			.values({ vaultId, personId, handle, state: 'missing' })
			.onConflictDoUpdate({
				target: [personAvatars.vaultId, personAvatars.personId],
				set: {
					handle,
					state: 'missing',
					objectKey: null,
					mime: null,
					bytes: null,
					sha256: null,
					fetchedAt: new Date()
				}
			});
		return { miss: 'no-photo' };
	}
	const { bytes, mime } = result;
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const objectKey = `avatars/${vaultId}/${personId}/${sha256}.${EXTENSIONS[mime]}`;
	try {
		await putObject(objectKey, bytes, mime);
	} catch (error) {
		storageFailedUntil = Date.now() + STORAGE_PAUSE;
		throw error;
	}
	const stored = { handle, state: 'stored', objectKey, mime, bytes: bytes.byteLength, sha256 };
	await db
		.insert(personAvatars)
		.values({ vaultId, personId, ...stored })
		.onConflictDoUpdate({
			target: [personAvatars.vaultId, personAvatars.personId],
			set: { ...stored, fetchedAt: new Date() }
		});
	// A replaced photo (the source changed) leaves its old object for the media worker.
	if (previousKey && previousKey !== objectKey)
		await db
			.insert(maintenanceJobs)
			.values({
				vaultId,
				kind: 'media.delete',
				deduplicationKey: `avatar:${previousKey}`,
				payload: { objectKey: previousKey }
			})
			.onConflictDoNothing();
	return { bytes, mime, sha256 };
}

function pauseReason(): AvatarMiss | null {
	const now = Date.now();
	if (now < limitedUntil) return { miss: 'unavatar-limit', retryAt: limitedUntil };
	if (now < storageFailedUntil) return { miss: 'storage-paused', retryAt: storageFailedUntil };
	return null;
}

/** The person's photo, or why there is none to show (yet). */
export async function personAvatar(
	owner: OwnerContext,
	personId: string
): Promise<AvatarImage | AvatarMiss> {
	const { vaultId } = owner;
	const source = await sourceOf(vaultId, personId);
	if (!source) return { miss: 'no-profile' };
	const handle = sourceKey(source);
	const [saved] = await database()
		.select()
		.from(personAvatars)
		.where(and(eq(personAvatars.vaultId, vaultId), eq(personAvatars.personId, personId)));
	if (saved?.handle === handle) {
		if (saved.state === 'stored' && saved.objectKey && saved.mime && saved.sha256) {
			if (!storageConfigured()) return { miss: 'no-storage' };
			const bytes = await getObject(saved.objectKey);
			if (bytes) return { bytes, mime: saved.mime, sha256: saved.sha256 };
			// The object went missing from the bucket; fetch it again below.
		} else if (
			saved.state === 'missing' &&
			Date.now() - saved.fetchedAt.getTime() < RETRY_MISSING_AFTER
		)
			return { miss: 'no-photo', retryAt: saved.fetchedAt.getTime() + RETRY_MISSING_AFTER };
	}
	// Without storage it couldn't be kept, and would cost a lookup on every view.
	if (!storageConfigured()) return { miss: 'no-storage' };
	const paused = pauseReason();
	if (paused) return paused;
	const key = `${vaultId}:${personId}`;
	let pending = inflight.get(key);
	if (!pending) {
		const previousKey = saved?.state === 'stored' ? saved.objectKey : null;
		pending = queued(() => lookUp(vaultId, personId, source, previousKey)).finally(() =>
			inflight.delete(key)
		);
		inflight.set(key, pending);
	}
	return pending;
}
