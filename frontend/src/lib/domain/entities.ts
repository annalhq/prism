import { keys, object, uuid, ValidationError } from './validation-fields.js';

export type EntityKind = 'bookmark' | 'person' | 'persona';
export type EntityRef = { kind: EntityKind; id: string };
export function parseEntityRef(value: unknown): EntityRef {
	const ref = object(value);
	keys(ref, ['kind', 'id']);
	if (ref.kind !== 'bookmark' && ref.kind !== 'person' && ref.kind !== 'persona')
		throw new ValidationError('Unknown entity kind.');
	return { kind: ref.kind, id: uuid(ref.id) };
}
