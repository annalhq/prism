import { parseAvatar, type AvatarConfig } from './avatars.js';
import type { EntityProjection, Revision, Sequence } from './contracts.js';
import { normalizeUrl } from './urls.js';
import { keys, object, revision, text, uuid, ValidationError } from './validation-fields.js';

export const MAX_PERSON_IDENTITIES = 50;
export type PersonFields = {
	displayName: string;
	bio: string;
	website: string | null;
	avatarConfig?: AvatarConfig | null;
};
export type PersonProjection = EntityProjection & PersonFields & { kind: 'person' };
export type PersonCommand =
	| {
			type: 'person.create';
			id: string;
			displayName: string;
			bio?: string;
			website?: string | null;
			avatarConfig?: AvatarConfig | null;
	  }
	| { type: 'person.update'; id: string; expectedRevision: Revision; patch: Partial<PersonFields> }
	| ({
			id: string;
			expectedRevision: Revision;
	  } & ({ type: 'person.trash' } | { type: 'person.restore' } | { type: 'person.purge' }));
export type PersonIdentityProjection = {
	id: string;
	personId: string;
	platform: string;
	nativeAccountId: string | null;
	profileUrl: string;
	handle: string | null;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type PersonIdentityCommand =
	| {
			type: 'person-identity.add';
			id: string;
			personId: string;
			platform: string;
			nativeAccountId?: string | null;
			profileUrl: string;
			handle?: string | null;
			confirmed: true;
	  }
	| { type: 'person-identity.remove'; id: string; personId: string; expectedRevision: Revision };
export type PersonTombstone = {
	id: string;
	kind: 'person';
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string;
	purgedAt: string;
};
export const PERSON_COMMAND_TYPES = [
	'person.create',
	'person.update',
	'person.trash',
	'person.restore',
	'person.purge',
	'person-identity.add',
	'person-identity.remove'
] as const;
export function isPersonCommand(command: {
	type: string;
}): command is PersonCommand | PersonIdentityCommand {
	return (PERSON_COMMAND_TYPES as readonly string[]).includes(command.type);
}
export function personWebsite(value: unknown): string | null {
	if (value === null) return null;
	const input = text(value, 8192, true);
	try {
		return normalizeUrl(input).canonicalUrl;
	} catch (error) {
		throw new ValidationError((error as Error).message);
	}
}
export function identityPlatform(value: unknown): string {
	const platform = text(value, 64, true).trim().toLowerCase();
	if (!/^[a-z][a-z0-9_-]{0,63}$/.test(platform))
		throw new ValidationError(
			'Use a platform key of ASCII letters, digits, underscores or hyphens.'
		);
	return platform === 'twitter' ? 'x' : platform;
}
function nullableText(value: unknown, max: number): string | null {
	return value === undefined || value === null ? null : text(value, max, true);
}
export function parsePersonCommand(value: unknown): PersonCommand | PersonIdentityCommand {
	const c = object(value);
	const id = uuid(c.id);
	switch (c.type) {
		case 'person.create':
			keys(c, ['type', 'id', 'displayName', 'bio', 'website', 'avatarConfig']);
			return {
				type: c.type,
				id,
				displayName: text(c.displayName, 200, true),
				bio: c.bio === undefined ? '' : text(c.bio, 10000),
				website: c.website === undefined ? null : personWebsite(c.website),
				...('avatarConfig' in c ? { avatarConfig: parseAvatar(c.avatarConfig) } : {})
			};
		case 'person.update': {
			keys(c, ['type', 'id', 'expectedRevision', 'patch']);
			const p = object(c.patch);
			keys(p, ['displayName', 'bio', 'website', 'avatarConfig']);
			if (!Object.keys(p).length)
				throw new ValidationError('A person update requires a writable field.');
			return {
				type: c.type,
				id,
				expectedRevision: revision(c.expectedRevision),
				patch: {
					...('displayName' in p ? { displayName: text(p.displayName, 200, true) } : {}),
					...('bio' in p ? { bio: text(p.bio, 10000) } : {}),
					...('website' in p ? { website: personWebsite(p.website) } : {}),
					...('avatarConfig' in p ? { avatarConfig: parseAvatar(p.avatarConfig) } : {})
				}
			};
		}
		case 'person.trash':
		case 'person.restore':
		case 'person.purge':
			keys(c, ['type', 'id', 'expectedRevision']);
			return { type: c.type, id, expectedRevision: revision(c.expectedRevision) };
		case 'person-identity.add':
			keys(c, [
				'type',
				'id',
				'personId',
				'platform',
				'nativeAccountId',
				'profileUrl',
				'handle',
				'confirmed'
			]);
			if (c.confirmed !== true)
				throw new ValidationError('Explicitly confirm this external identity before assigning it.');
			return {
				type: c.type,
				id,
				personId: uuid(c.personId),
				platform: identityPlatform(c.platform),
				profileUrl: personWebsite(text(c.profileUrl, 8192, true))!,
				nativeAccountId: nullableText(c.nativeAccountId, 256),
				handle: nullableText(c.handle, 256),
				confirmed: true
			};
		case 'person-identity.remove':
			keys(c, ['type', 'id', 'personId', 'expectedRevision']);
			return {
				type: c.type,
				id,
				personId: uuid(c.personId),
				expectedRevision: revision(c.expectedRevision)
			};
		default:
			throw new ValidationError('Unknown person command.');
	}
}
