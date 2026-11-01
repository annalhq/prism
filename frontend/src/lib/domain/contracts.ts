export const PROTOCOL_VERSION = 1 as const;
export const MAX_COMMAND_BYTES = 1_048_576;
export const MAX_BULK_BOOKMARKS = 100;

// Validated decimal strings on the wire; bigint belongs only inside the server.
export type Revision = `${bigint}`;
export type Sequence = `${bigint}`;
export type BookmarkKind = 'page' | 'social' | 'image';
export type BookmarkFields = { title: string; description: string; url: string | null };
export type BookmarkCommand =
	| {
			type: 'bookmark.organize';
			id: string;
			expectedRevision: Revision;
			patch: import('./organization.js').BookmarkOrganization;
	  }
	| {
			type: 'bookmark.create';
			id: string;
			kind: BookmarkKind;
			title: string;
			description?: string;
			url?: string | null;
	  }
	| {
			type: 'bookmark.update';
			id: string;
			expectedRevision: Revision;
			patch: Partial<BookmarkFields>;
	  }
	| {
			type: 'bookmark.trash' | 'bookmark.restore' | 'bookmark.purge';
			id: string;
			expectedRevision: Revision;
	  };
export type ExtensionBookmarkCommand = {
	type: 'extension.bookmark.create';
	id: string;
	kind: Exclude<BookmarkKind, 'image'>;
	title: string;
	url: string;
	tagIds: string[];
	// Tags typed in the extension that weren't in its catalog. Each is created with this ID,
	// or matched by name to an existing tag (one may have been made since the catalog loaded).
	newTags?: { id: string; name: string }[];
	person?: { id: string };
};
export type NoteCommand = {
	type: 'note.replace';
	id: string;
	// 0 is the absence of a stored note. All accepted note revisions are positive.
	expectedRevision: Revision;
	bodyMarkdown: string;
};
export type RelatedLinkCommand = {
	id: string;
	expectedRevision: Revision;
	target: import('./notes.js').EntityReference;
} & ({ type: 'related-link.add' } | { type: 'related-link.remove' });
export type Command =
	| import('./personas.js').PersonaCommand
	| ExtensionBookmarkCommand
	| BookmarkCommand
	| import('./people.js').PersonCommand
	| import('./people.js').PersonIdentityCommand
	| import('./relationships.js').ContentPersonCommand
	| import('./organization.js').OrganizationCommand
	| NoteCommand
	| RelatedLinkCommand
	| { type: 'bookmark.bulk'; commands: BulkBookmarkCommand[] };
export type BulkBookmarkCommand =
	BookmarkCommand | import('./organization.js').TagMembershipCommand;
export type CommandEnvelope = { protocolVersion: 1; operationId: string; command: Command };

export type BookmarkProjection = BookmarkFields & {
	id: string;
	kind: BookmarkKind;
	canonicalUrl: string | null;
	domain: string | null;
	collectionId: string | null;
	readingStatus: 'unread' | 'reading' | 'read';
	isPinned: boolean;
	archivedAt: string | null;
	tagIds: string[];
	deletedAt: string | null;
	revision: Revision;
	lastSeq: Sequence;
	createdAt: string;
	updatedAt: string;
};
export type BookmarkTombstone = {
	id: string;
	kind: 'bookmark';
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string;
	purgedAt: string;
};
export type Change =
	| import('./personas.js').PersonaChange
	| { type: 'bookmark.upsert'; bookmark: BookmarkProjection }
	| { type: 'entity.upsert'; entity: EntityProjection }
	| { type: 'note.upsert'; note: NoteProjection }
	| { type: 'links.replace'; links: LinkProjection }
	| { type: 'tag.upsert'; tag: TaxonomyProjection }
	| { type: 'collection.upsert'; collection: TaxonomyProjection }
	| { type: 'saved-search.upsert'; savedSearch: SavedSearchProjection }
	| { type: 'activity.upsert'; activity: ActivityProjection }
	| { type: 'person.upsert'; person: import('./people.js').PersonProjection }
	| { type: 'person-identity.upsert'; identity: import('./people.js').PersonIdentityProjection }
	| {
			type: 'content-person.upsert';
			relationship: import('./relationships.js').ContentPersonProjection;
	  }
	// Clears owned profile data and hides its relationships; incoming note links retain identity.
	| { type: 'person.purge'; tombstone: import('./people.js').PersonTombstone }
	// Removes the bookmark, its note/history, outgoing links, tags, activity, media,
	// content-person relations and persona memberships. Incoming links retain the tombstone.
	| { type: 'bookmark.purge'; tombstone: BookmarkTombstone };
export type EntityProjection = {
	id: string;
	tagIds: string[];
	kind: import('./notes.js').EntityKind;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	purgedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type TaxonomyProjection = {
	id: string;
	name: string;
	normalizedName: string;
	/** Tags only: fractional sort key, null until the user reorders tags. */
	position?: string | null;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type SavedSearchProjection = Omit<TaxonomyProjection, 'normalizedName'> & {
	filter: import('./search.js').SearchFilter;
	astVersion: 1;
	sort: import('./search.js').SearchSort;
};
export type ActivityProjection = {
	bookmarkId: string;
	lastOpenedAt: string;
	openCount: `${bigint}`;
	revision: Revision;
	lastSeq: Sequence;
	createdAt: string;
	updatedAt: string;
};
export type NoteProjection = {
	entityId: string;
	bodyMarkdown: string;
	revision: Revision;
	lastSeq: Sequence;
	createdAt: string;
	updatedAt: string;
};
export type LinkProjection = {
	sourceId: string;
	lastSeq: Sequence;
	// Full replacement of both kinds; targets resolve via the registry, including tombstones.
	edges: { targetId: string; kind: 'note_reference' | 'related' }[];
};
export type ChangeFrame = {
	protocolVersion: 1;
	operationId: string;
	seq: Sequence;
	changes: Change[];
};
export type CommandErrorCode =
	| 'invalid_command'
	| 'not_found'
	| 'id_exists'
	| 'revision_conflict'
	| 'in_trash'
	| 'not_in_trash'
	| 'purged'
	| 'duplicate_url'
	| 'url_hash_collision'
	| 'identity_limit'
	| 'duplicate_identity'
	| 'identity_hash_collision'
	| 'duplicate_name'
	| 'in_use'
	| 'tag_limit'
	| 'invalid_reference'
	| 'frame_too_large'
	| 'operation_id_reused';
export type CommandResult =
	| { protocolVersion: 1; operationId: string; status: 'accepted'; frame: ChangeFrame }
	| {
			protocolVersion: 1;
			operationId: string;
			status: 'already_exists';
			bookmark: BookmarkProjection;
	  }
	| {
			protocolVersion: 1;
			operationId: string;
			status: 'rejected';
			error: {
				code: CommandErrorCode;
				message: string;
				id?: string;
				existingId?: string;
				currentRevision?: Revision;
			};
	  };

export function serializedBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
