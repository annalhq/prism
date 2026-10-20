import type { EntityProjection, Revision, Sequence } from './contracts.js';
import { normalizeOrganizationName } from './organization.js';
import { keys, object, revision, text, uuid, ValidationError } from './validation-fields.js';

export type PersonaFields = { name: string; description: string };
export type PersonaProjection = EntityProjection & PersonaFields & { kind: 'persona' };
export type PersonaMember = { kind: 'bookmark' | 'person'; id: string };
export type PersonaMemberProjection = {
	personaId: string;
	member: PersonaMember;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type PersonaCommand =
	| { type: 'persona.create'; id: string; name: string; description?: string }
	| {
			type: 'persona.update';
			id: string;
			expectedRevision: Revision;
			patch: Partial<PersonaFields>;
	  }
	| {
			type: 'persona.trash' | 'persona.restore' | 'persona.purge';
			id: string;
			expectedRevision: Revision;
	  }
	| {
			type: 'persona-member.add' | 'persona-member.remove';
			personaId: string;
			member: PersonaMember;
	  };
export type PersonaChange =
	| { type: 'persona.upsert'; persona: PersonaProjection }
	| { type: 'persona-member.upsert'; membership: PersonaMemberProjection }
	| {
			type: 'persona.purge';
			tombstone: {
				id: string;
				kind: 'persona';
				revision: Revision;
				lastSeq: Sequence;
				deletedAt: string;
				purgedAt: string;
			};
	  };

const TYPES = [
	'persona.create',
	'persona.update',
	'persona.trash',
	'persona.restore',
	'persona.purge',
	'persona-member.add',
	'persona-member.remove'
];
export function isPersonaCommand(value: { type: string }): value is PersonaCommand {
	return TYPES.includes(value.type);
}
export function parsePersonaCommand(value: unknown): PersonaCommand {
	const c = object(value);
	switch (c.type) {
		case 'persona.create':
			keys(c, ['type', 'id', 'name', 'description']);
			return {
				type: c.type,
				id: uuid(c.id),
				name: normalizeOrganizationName(c.name).name,
				description: c.description === undefined ? '' : text(c.description, 10000)
			};
		case 'persona.update': {
			keys(c, ['type', 'id', 'expectedRevision', 'patch']);
			const p = object(c.patch);
			keys(p, ['name', 'description']);
			if (!Object.keys(p).length)
				throw new ValidationError('A persona update requires a writable field.');
			return {
				type: c.type,
				id: uuid(c.id),
				expectedRevision: revision(c.expectedRevision),
				patch: {
					...('name' in p ? { name: normalizeOrganizationName(p.name).name } : {}),
					...('description' in p ? { description: text(p.description, 10000) } : {})
				}
			};
		}
		case 'persona.trash':
		case 'persona.restore':
		case 'persona.purge':
			keys(c, ['type', 'id', 'expectedRevision']);
			return { type: c.type, id: uuid(c.id), expectedRevision: revision(c.expectedRevision) };
		case 'persona-member.add':
		case 'persona-member.remove': {
			keys(c, ['type', 'personaId', 'member']);
			const m = object(c.member);
			keys(m, ['kind', 'id']);
			if (m.kind !== 'bookmark' && m.kind !== 'person')
				throw new ValidationError(
					'Persona members must be content or people; personas cannot be nested.'
				);
			return {
				type: c.type,
				personaId: uuid(c.personaId),
				member: { kind: m.kind, id: uuid(m.id) }
			};
		}
		default:
			throw new ValidationError('Unknown persona command.');
	}
}
