import type { Revision, Sequence } from './contracts.js';
import { keys, object, uuid, ValidationError } from './validation-fields.js';

export type PersonRole = 'author' | 'about' | 'related';
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
export type PersonFeedMode = 'all' | 'authored' | 'about' | 'related' | 'tweets';
export function parsePersonFeedMode(value: unknown): PersonFeedMode {
	if (
		value === 'all' ||
		value === 'authored' ||
		value === 'about' ||
		value === 'related' ||
		value === 'tweets'
	)
		return value;
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
	if (c.role !== 'author' && c.role !== 'about' && c.role !== 'related')
		throw new ValidationError('Unknown person role.');
	const common: Pick<ContentPersonProjection, 'bookmarkId' | 'personId' | 'role'> = {
		bookmarkId: uuid(c.bookmarkId),
		personId: uuid(c.personId),
		role: c.role
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
