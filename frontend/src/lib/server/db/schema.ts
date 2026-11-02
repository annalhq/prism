import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';

export const entityKind = pgEnum('entity_kind', ['bookmark', 'person', 'persona']);
export const bookmarkKind = pgEnum('bookmark_kind', ['page', 'social', 'image', 'text', 'stash']);
export const readingStatus = pgEnum('reading_status', ['unread', 'reading', 'read']);
export const linkKind = pgEnum('link_kind', ['note_reference', 'related']);
export const personRole = pgEnum('person_role', ['author', 'about', 'related']);
export const relationProvenance = pgEnum('relation_provenance', ['manual', 'capture_confirmed']);
export const attachmentState = pgEnum('attachment_state', ['ready', 'deleted', 'purged']);
export const uploadState = pgEnum('upload_state', [
	'pending',
	'verifying',
	'ready',
	'failed',
	'expired'
]);
export const jobState = pgEnum('job_state', ['pending', 'running', 'done', 'failed']);
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const revisions = () => ({
	revision: bigint('revision', { mode: 'bigint' })
		.notNull()
		.default(sql`1`),
	lastSeq: bigint('last_seq', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	createdAt: utc('created_at').notNull().defaultNow(),
	updatedAt: utc('updated_at').notNull().defaultNow()
});
const lifecycle = () => ({ deletedAt: utc('deleted_at'), purgedAt: utc('purged_at') });
const revisionChecks = (t: { revision: AnyPgColumn; lastSeq: AnyPgColumn }) => [
	check('revision_sequence_valid', sql`${t.revision} > 0 AND ${t.lastSeq} >= 0`)
];
const lifecycleChecks = (t: { deletedAt: AnyPgColumn; purgedAt: AnyPgColumn }) => [
	check('purge_requires_trash', sql`${t.purgedAt} IS NULL OR ${t.deletedAt} IS NOT NULL`)
];

export const vaults = pgTable(
	'vaults',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ownerSubject: text('owner_subject').notNull().unique(),
		changeSeq: bigint('change_seq', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		retentionFloor: bigint('retention_floor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		syncEpoch: uuid('sync_epoch').notNull().defaultRandom(),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		check(
			'vault_sequences_valid',
			sql`${t.changeSeq} >= ${t.retentionFloor} AND ${t.retentionFloor} >= 0`
		)
	]
);

export const entities = pgTable(
	'knowledge_entities',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		id: uuid('id').notNull(),
		kind: entityKind('kind').notNull(),
		// Deduplication belongs with authoritative lifecycle so trash/restore uniqueness is atomic.
		urlHash: text('url_hash'),
		personaName: text('persona_name'),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		unique('entity_identity_kind').on(t.vaultId, t.id, t.kind),
		uniqueIndex('active_bookmark_url_unique')
			.on(t.vaultId, t.urlHash)
			.where(sql`${t.deletedAt} IS NULL AND ${t.urlHash} IS NOT NULL`),
		uniqueIndex('active_persona_name_unique')
			.on(t.vaultId, t.personaName)
			.where(sql`${t.deletedAt} IS NULL AND ${t.kind} = 'persona'`),
		check(
			'entity_persona_name_valid',
			sql`(${t.kind} = 'persona' AND ((${t.purgedAt} IS NOT NULL AND ${t.personaName} IS NULL) OR (char_length(${t.personaName}) BETWEEN 1 AND 256 AND ${t.personaName} IS NOT NULL))) OR (${t.kind} <> 'persona' AND ${t.personaName} IS NULL)`
		),
		check(
			'entity_hash_valid',
			sql`${t.urlHash} IS NULL OR (${t.kind} = 'bookmark' AND ${t.urlHash} ~ '^[a-f0-9]{64}$')`
		),
		check('entity_revision_valid', sql`${t.revision} > 0 AND ${t.lastSeq} >= 0`),
		check('entity_purge_requires_trash', sql`${t.purgedAt} IS NULL OR ${t.deletedAt} IS NOT NULL`)
	]
);

export const collections = pgTable(
	'collections',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		id: uuid('id').notNull(),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.id] }),
		uniqueIndex('collection_name_unique')
			.on(t.vaultId, t.normalizedName)
			.where(sql`${t.deletedAt} IS NULL`),
		check(
			'collection_name_length',
			sql`char_length(${t.name}) BETWEEN 1 AND 64 AND char_length(${t.normalizedName}) BETWEEN 1 AND 256`
		)
	]
);

export const tags = pgTable(
	'tags',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		id: uuid('id').notNull(),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		// Fractional sort key from a drag reorder; null tags follow the ordered ones.
		position: text('position'),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.id] }),
		check(
			'tag_position_valid',
			sql`${t.position} IS NULL OR ${t.position} ~ '^[0-9a-z]{0,127}[1-9a-z]$'`
		),
		uniqueIndex('tag_name_unique')
			.on(t.vaultId, t.normalizedName)
			.where(sql`${t.deletedAt} IS NULL`),
		check(
			'tag_name_length',
			sql`char_length(${t.name}) BETWEEN 1 AND 64 AND char_length(${t.normalizedName}) BETWEEN 1 AND 256`
		)
	]
);

export const bookmarks = pgTable(
	'bookmarks',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		entityKind: entityKind('entity_kind').notNull().default('bookmark'),
		kind: bookmarkKind('kind').notNull().default('page'),
		url: text('url'),
		canonicalUrl: text('canonical_url'),
		domain: text('domain'),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		collectionId: uuid('collection_id'),
		readingStatus: readingStatus('reading_status').notNull().default('unread'),
		isPinned: boolean('is_pinned').notNull().default(false),
		archivedAt: utc('archived_at'),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({
			columns: [t.vaultId, t.id, t.entityKind],
			foreignColumns: [entities.vaultId, entities.id, entities.kind]
		}),
		foreignKey({
			columns: [t.vaultId, t.collectionId],
			foreignColumns: [collections.vaultId, collections.id]
		}),
		check('bookmark_entity_kind', sql`${t.entityKind} = 'bookmark'`),
		check('bookmark_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 500`),
		check('bookmark_description_length', sql`char_length(${t.description}) <= 10000`),
		check(
			'bookmark_url_required',
			// Compared as text: Postgres won't let a migration use an enum value it adds in the
			// same transaction, and this rule ships with the new 'text' kind.
			sql`${t.kind}::text IN ('image', 'text', 'stash') OR (${t.url} IS NOT NULL AND ${t.canonicalUrl} IS NOT NULL)`
		),
		check(
			'bookmark_url_safe',
			sql`(${t.url} IS NULL OR (char_length(${t.url}) <= 8192 AND ${t.url} ~* '^https?://[^/?#@[:space:]]+([/?#]|$)')) AND (${t.canonicalUrl} IS NULL OR (char_length(${t.canonicalUrl}) <= 8192 AND ${t.canonicalUrl} ~* '^https?://[^/?#@[:space:]]+([/?#]|$)'))`
		),
		index('bookmark_recent').on(t.vaultId, t.createdAt.desc(), t.id),
		index('bookmark_collection').on(t.vaultId, t.collectionId, t.createdAt.desc(), t.id)
	]
);

export const people = pgTable(
	'people',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		entityKind: entityKind('entity_kind').notNull().default('person'),
		displayName: text('display_name').notNull(),
		bio: text('bio').notNull().default(''),
		website: text('website')
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({
			columns: [t.vaultId, t.id, t.entityKind],
			foreignColumns: [entities.vaultId, entities.id, entities.kind]
		}),
		check('person_entity_kind', sql`${t.entityKind} = 'person'`),
		check(
			'person_text_limits',
			sql`char_length(${t.displayName}) BETWEEN 1 AND 200 AND char_length(${t.bio}) <= 10000`
		)
	]
);

export const personas = pgTable(
	'personas',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		entityKind: entityKind('entity_kind').notNull().default('persona'),
		name: text('name').notNull(),
		description: text('description').notNull().default('')
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({
			columns: [t.vaultId, t.id, t.entityKind],
			foreignColumns: [entities.vaultId, entities.id, entities.kind]
		}),
		check('persona_entity_kind', sql`${t.entityKind} = 'persona'`),
		check(
			'persona_text_limits',
			sql`char_length(${t.name}) BETWEEN 1 AND 64 AND char_length(${t.description}) <= 10000`
		)
	]
);

export const notes = pgTable(
	'entity_notes',
	{
		vaultId: uuid('vault_id').notNull(),
		entityId: uuid('entity_id').notNull(),
		bodyMarkdown: text('body_markdown').notNull().default(''),
		...revisions()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.entityId] }),
		foreignKey({
			columns: [t.vaultId, t.entityId],
			foreignColumns: [entities.vaultId, entities.id]
		}),
		check('note_body_limit', sql`octet_length(${t.bodyMarkdown}) <= 102400`),
		check('note_revision_valid', sql`${t.revision} > 0 AND ${t.lastSeq} >= 0`)
	]
);

export const noteRevisions = pgTable(
	'note_revisions',
	{
		vaultId: uuid('vault_id').notNull(),
		entityId: uuid('entity_id').notNull(),
		revision: bigint('revision', { mode: 'bigint' }).notNull(),
		bodyMarkdown: text('body_markdown').notNull(),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.entityId, t.revision] }),
		foreignKey({
			columns: [t.vaultId, t.entityId],
			foreignColumns: [notes.vaultId, notes.entityId]
		}),
		check(
			'note_history_body_limit',
			sql`octet_length(${t.bodyMarkdown}) <= 102400 AND ${t.revision} > 0`
		)
	]
);

export const entityTags = pgTable(
	'entity_tags',
	{
		vaultId: uuid('vault_id').notNull(),
		entityId: uuid('entity_id').notNull(),
		tagId: uuid('tag_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.entityId, t.tagId] }),
		foreignKey({
			columns: [t.vaultId, t.entityId],
			foreignColumns: [entities.vaultId, entities.id]
		}),
		foreignKey({ columns: [t.vaultId, t.tagId], foreignColumns: [tags.vaultId, tags.id] }),
		index('tag_members').on(t.vaultId, t.tagId, t.entityId)
	]
);

export const entityLinks = pgTable(
	'entity_links',
	{
		vaultId: uuid('vault_id').notNull(),
		sourceId: uuid('source_id').notNull(),
		targetId: uuid('target_id').notNull(),
		kind: linkKind('kind').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.sourceId, t.targetId, t.kind] }),
		foreignKey({
			columns: [t.vaultId, t.sourceId],
			foreignColumns: [entities.vaultId, entities.id]
		}),
		foreignKey({
			columns: [t.vaultId, t.targetId],
			foreignColumns: [entities.vaultId, entities.id]
		}),
		index('backlinks').on(t.vaultId, t.targetId, t.kind, t.sourceId)
	]
);

export const personIdentities = pgTable(
	'person_identities',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		personId: uuid('person_id').notNull(),
		platform: text('platform').notNull(),
		nativeAccountId: text('native_account_id'),
		profileUrl: text('profile_url').notNull(),
		profileUrlHash: text('profile_url_hash').notNull(),
		handle: text('handle'),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({ columns: [t.vaultId, t.personId], foreignColumns: [people.vaultId, people.id] }),
		uniqueIndex('external_profile_unique')
			.on(t.vaultId, t.profileUrlHash)
			.where(sql`${t.deletedAt} IS NULL`),
		uniqueIndex('external_native_identity_unique')
			.on(t.vaultId, t.platform, t.nativeAccountId)
			.where(sql`${t.deletedAt} IS NULL AND ${t.nativeAccountId} IS NOT NULL`),
		check(
			'profile_identity_limits',
			sql`char_length(${t.platform}) BETWEEN 1 AND 64 AND (${t.nativeAccountId} IS NULL OR char_length(${t.nativeAccountId}) BETWEEN 1 AND 256) AND ${t.profileUrlHash} ~ '^[a-f0-9]{64}$' AND char_length(${t.profileUrl}) <= 8192`
		)
	]
);

// A person's profile photo, fetched from unavatar.io once per source and kept in object storage.
// `handle` holds the source as `provider:id` (x:jack, github:torvalds, youtube:UC…, codeforces:…,
// bilibili:…), so a changed profile link means one new fetch. Server-only: never synced to
// clients, who load it through /api/v1/people/:id/avatar. `missing` records that there was no
// photo to give, so lookups aren't repeated on every view.
// No foreign key to people: person cleanup removes the row and queues the object's deletion.
export const personAvatars = pgTable(
	'person_avatars',
	{
		vaultId: uuid('vault_id').notNull(),
		personId: uuid('person_id').notNull(),
		handle: text('handle').notNull(),
		state: text('state').notNull(),
		objectKey: text('object_key'),
		mime: text('mime'),
		bytes: integer('bytes'),
		sha256: text('sha256'),
		fetchedAt: utc('fetched_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.personId] }),
		check(
			'person_avatar_valid',
			sql`char_length(${t.handle}) BETWEEN 3 AND 80 AND ${t.handle} ~ '^(x|github|youtube|codeforces|bilibili):[A-Za-z0-9._-]{1,64}$' AND (
				(${t.state} = 'missing' AND ${t.objectKey} IS NULL) OR
				(${t.state} = 'stored' AND ${t.objectKey} IS NOT NULL AND ${t.mime} IN ('image/jpeg','image/png','image/webp')
					AND ${t.bytes} > 0 AND ${t.bytes} <= 2097152 AND ${t.sha256} ~ '^[a-f0-9]{64}$')
			)`
		)
	]
);

export const contentPeople = pgTable(
	'content_people',
	{
		vaultId: uuid('vault_id').notNull(),
		bookmarkId: uuid('bookmark_id').notNull(),
		personId: uuid('person_id').notNull(),
		role: personRole('role').notNull(),
		provenance: relationProvenance('provenance').notNull(),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.bookmarkId, t.personId, t.role] }),
		foreignKey({
			columns: [t.vaultId, t.bookmarkId],
			foreignColumns: [bookmarks.vaultId, bookmarks.id]
		}),
		foreignKey({ columns: [t.vaultId, t.personId], foreignColumns: [people.vaultId, people.id] }),
		index('person_content_feed').on(t.vaultId, t.personId, t.role, t.bookmarkId)
	]
);

export const personaMembers = pgTable(
	'persona_members',
	{
		vaultId: uuid('vault_id').notNull(),
		personaId: uuid('persona_id').notNull(),
		memberId: uuid('member_id').notNull(),
		memberKind: entityKind('member_kind').notNull(),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.personaId, t.memberId] }),
		foreignKey({
			columns: [t.vaultId, t.personaId],
			foreignColumns: [personas.vaultId, personas.id]
		}),
		foreignKey({
			columns: [t.vaultId, t.memberId, t.memberKind],
			foreignColumns: [entities.vaultId, entities.id, entities.kind]
		}),
		check('persona_member_not_nested', sql`${t.memberKind} IN ('bookmark', 'person')`),
		index('member_personas').on(t.vaultId, t.memberId, t.personaId)
	]
);

export const attachments = pgTable(
	'attachments',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		bookmarkId: uuid('bookmark_id').notNull(),
		objectKey: text('object_key'),
		objectVersion: text('object_version'),
		thumbnailKey: text('thumbnail_key'),
		thumbnailVersion: text('thumbnail_version'),
		mime: text('mime'),
		bytes: bigint('bytes', { mode: 'bigint' }),
		width: integer('width'),
		height: integer('height'),
		sha256: text('sha256'),
		state: attachmentState('state').notNull().default('ready'),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({
			columns: [t.vaultId, t.bookmarkId],
			foreignColumns: [bookmarks.vaultId, bookmarks.id]
		}),
		check(
			'ready_attachment_verified',
			sql`${t.state} <> 'ready' OR (${t.objectKey} IS NOT NULL AND ${t.objectVersion} IS NOT NULL AND ${t.mime} IS NOT NULL AND ${t.bytes} IS NOT NULL AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL AND ${t.sha256} IS NOT NULL AND ${t.mime} IN ('image/jpeg','image/png','image/webp') AND ${t.bytes} > 0 AND ${t.bytes} <= 20971520 AND ${t.width} > 0 AND ${t.height} > 0 AND ${t.width}::bigint * ${t.height}::bigint <= 40000000 AND ${t.sha256} ~ '^[a-f0-9]{64}$')`
		),
		check(
			'attachment_thumbnail_pair',
			sql`(${t.thumbnailKey} IS NULL) = (${t.thumbnailVersion} IS NULL)`
		),
		index('bookmark_attachments').on(t.vaultId, t.bookmarkId, t.id)
	]
);

export const uploadIntents = pgTable(
	'upload_intents',
	{
		vaultId: uuid('vault_id').notNull(),
		id: uuid('id').notNull(),
		bookmarkId: uuid('bookmark_id').notNull(),
		attachmentId: uuid('attachment_id').notNull(),
		objectKey: text('object_key').notNull().unique(),
		declaredMime: text('declared_mime').notNull(),
		declaredBytes: bigint('declared_bytes', { mode: 'bigint' }).notNull(),
		expiresAt: utc('expires_at').notNull(),
		state: uploadState('state').notNull().default('pending'),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		foreignKey({
			columns: [t.vaultId, t.bookmarkId],
			foreignColumns: [bookmarks.vaultId, bookmarks.id]
		}),
		check(
			'upload_limits',
			sql`${t.declaredBytes} > 0 AND ${t.declaredBytes} <= 20971520 AND ${t.declaredMime} IN ('image/jpeg','image/png','image/webp')`
		),
		index('upload_expiry').on(t.state, t.expiresAt)
	]
);

export const savedSearches = pgTable(
	'saved_searches',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		id: uuid('id').notNull(),
		name: text('name').notNull(),
		filter: jsonb('filter').notNull(),
		astVersion: integer('ast_version').notNull().default(1),
		sort: text('sort').notNull().default('newest'),
		...lifecycle(),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		...lifecycleChecks(t),
		primaryKey({ columns: [t.vaultId, t.id] }),
		check(
			'saved_search_limits',
			sql`char_length(${t.name}) BETWEEN 1 AND 64 AND ${t.astVersion} > 0 AND ${t.sort} IN ('newest','title','recently_opened') AND octet_length(${t.filter}::text) <= 16384`
		)
	]
);

export const bookmarkActivity = pgTable(
	'bookmark_activity',
	{
		vaultId: uuid('vault_id').notNull(),
		bookmarkId: uuid('bookmark_id').notNull(),
		lastOpenedAt: utc('last_opened_at').notNull(),
		openCount: bigint('open_count', { mode: 'bigint' })
			.notNull()
			.default(sql`1`),
		...revisions()
	},
	(t) => [
		...revisionChecks(t),
		primaryKey({ columns: [t.vaultId, t.bookmarkId] }),
		foreignKey({
			columns: [t.vaultId, t.bookmarkId],
			foreignColumns: [bookmarks.vaultId, bookmarks.id]
		}),
		check('activity_count_valid', sql`${t.openCount} > 0`),
		index('recent_activity').on(t.vaultId, t.lastOpenedAt.desc(), t.bookmarkId)
	]
);

export const mutationReceipts = pgTable(
	'mutation_receipts',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		operationId: uuid('operation_id').notNull(),
		requestHash: text('request_hash').notNull(),
		result: jsonb('result').notNull(),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.operationId] }),
		check('receipt_hash_valid', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`)
	]
);

export const changeLog = pgTable(
	'change_log',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		seq: bigint('seq', { mode: 'bigint' }).notNull(),
		frame: jsonb('frame').notNull(),
		protocolVersion: integer('protocol_version').notNull().default(1),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.seq] }),
		check(
			'change_frame_limits',
			sql`${t.seq} > 0 AND ${t.protocolVersion} > 0 AND octet_length(${t.frame}::text) <= 1048576`
		),
		index('change_retention').on(t.vaultId, t.createdAt, t.seq)
	]
);

export const syncLeases = pgTable(
	'sync_leases',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		tokenHash: text('token_hash').notNull(),
		startSeq: bigint('start_seq', { mode: 'bigint' }).notNull(),
		expiresAt: utc('expires_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.tokenHash] }),
		check('lease_sequence_valid', sql`${t.startSeq} >= 0`),
		index('lease_expiry').on(t.expiresAt)
	]
);

export const deviceTokens = pgTable(
	'device_tokens',
	{
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		id: uuid('id').notNull(),
		name: text('name').notNull().default('Device'),
		tokenHash: text('token_hash').notNull().unique(),
		scopes: text('scopes').array().notNull(),
		expiresAt: utc('expires_at'),
		lastUsedAt: utc('last_used_at'),
		revokedAt: utc('revoked_at'),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.vaultId, t.id] }),
		check('device_token_hash_valid', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`)
	]
);

export const extensionPairings = pgTable(
	'extension_pairings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		codeHash: text('code_hash').notNull().unique(),
		expiresAt: utc('expires_at').notNull(),
		redeemedAt: utc('redeemed_at'),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		check('extension_pairing_hash_valid', sql`${t.codeHash} ~ '^[a-f0-9]{64}$'`),
		index('extension_pairing_expiry').on(t.expiresAt)
	]
);

export const maintenanceJobs = pgTable(
	'maintenance_jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		vaultId: uuid('vault_id')
			.notNull()
			.references(() => vaults.id),
		kind: text('kind').notNull(),
		deduplicationKey: text('deduplication_key').notNull(),
		payload: jsonb('payload').notNull(),
		state: jobState('state').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		runAfter: utc('run_after').notNull().defaultNow(),
		leaseUntil: utc('lease_until'),
		createdAt: utc('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('job_deduplication').on(t.vaultId, t.deduplicationKey),
		check('job_attempts_valid', sql`${t.attempts} >= 0`),
		index('jobs_due').on(t.state, t.runAfter)
	]
);
