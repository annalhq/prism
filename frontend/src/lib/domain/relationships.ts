import type { Revision, Sequence } from './contracts.js';
import { keys, object, uuid, ValidationError } from './validation-fields.js';

// A bookmark is simply connected to a person. `role` survives only as a storage key: rows
// saved before connections were unified may still say 'author' or 'about', and every reader
// treats all three the same. New connections are always 'related'.
export type PersonRole = 'author' | 'about' | 'related';
export const CONNECTION_ROLE = 'related' satisfies PersonRole;
export type RelationshipProvenance = 'manual' | 'capture_confirmed';
export type ContentPersonProjection = {
	bookmarkId: string;
	personId: string;
	role: PersonRole;
	provenance: RelationshipProvenance;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type ContentPersonCommand =
	| {
			type: 'content-person.add';
			bookmarkId: string;
			personId: string;
			role: PersonRole;
			provenance: RelationshipProvenance;
	  }
	| { type: 'content-person.remove'; bookmarkId: string; personId: string; role: PersonRole };
export type PersonFeedMode = 'all' | 'tweets';
export function parsePersonFeedMode(value: unknown): PersonFeedMode {
	if (value === 'all' || value === 'tweets') return value;
	throw new ValidationError('Unknown person feed mode.');
}
export function isTweetSource(kind: string, domain: string | null): boolean {
	if (kind !== 'social' || !domain) return false;
	const host = domain.toLowerCase().replace(/\.+$/, '');
	return ['x.com', 'twitter.com'].some((base) => host === base || host.endsWith(`.${base}`));
}
export function parseContentPersonCommand(value: unknown): ContentPersonCommand {
	const c = object(value);
	if (c.type !== 'content-person.add' && c.type !== 'content-person.remove')
		throw new ValidationError('Unknown content-person command.');
	keys(c, [
		'type',
		'bookmarkId',
		'personId',
		'role',
		...(c.type === 'content-person.add' ? ['provenance'] : [])
	]);
	// Omitted on new clients. Removal still names a legacy role so old rows can be cleared;
	// an add always creates the one connection role.
	const role = c.role === undefined ? CONNECTION_ROLE : c.role;
	if (role !== 'author' && role !== 'about' && role !== 'related')
		throw new ValidationError('Unknown person role.');
	const common: Pick<ContentPersonProjection, 'bookmarkId' | 'personId' | 'role'> = {
		bookmarkId: uuid(c.bookmarkId),
		personId: uuid(c.personId),
		role: c.type === 'content-person.add' ? CONNECTION_ROLE : role
	};
	if (c.type === 'content-person.remove') return { type: c.type, ...common };
	if (c.provenance !== 'manual' && c.provenance !== 'capture_confirmed')
		throw new ValidationError('Relationships require manual or confirmed-capture provenance.');
	return { type: c.type, ...common, provenance: c.provenance };
}
export function shouldPreserveManual(
	existing: RelationshipProvenance,
	incoming: RelationshipProvenance
): boolean {
	return existing === 'manual' && incoming === 'capture_confirmed';
}
