// Synced appearance: installed themes and modules, and the active theme.
import type { Revision, Sequence } from './contracts.js';
import { parseTagPosition } from './organization.js';
import { BUILTIN_THEMES, parseThemeDocument, ThemeError, type ThemeDocument } from './theme.js';
import { keys, object, revision, uuid, ValidationError } from './validation-fields.js';

/** Replica key of the per-vault appearance record. */
export const APPEARANCE_ID = '00000000-0000-0000-0000-000000000000';

export type ThemeProjection = {
	id: string;
	kind: ThemeDocument['kind'];
	name: string;
	document: ThemeDocument;
	/** Modules: applied on top of the active theme. */
	enabled: boolean;
	/** Modules: stacking order. */
	position: string | null;
	revision: Revision;
	lastSeq: Sequence;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
export type AppearanceProjection = {
	id: typeof APPEARANCE_ID;
	/** Built-in theme id or installed theme id. */
	activeTheme: string;
	revision: Revision;
	lastSeq: Sequence;
	createdAt: string;
	updatedAt: string;
};
export type AppearanceChange =
	| { type: 'theme.upsert'; theme: ThemeProjection }
	| { type: 'appearance.upsert'; appearance: AppearanceProjection };

export type AppearanceCommand =
	| { type: 'theme.create'; id: string; document: ThemeDocument }
	| { type: 'theme.update'; id: string; expectedRevision: Revision; document: ThemeDocument }
	| { type: 'theme.delete'; id: string; expectedRevision: Revision }
	| { type: 'theme.move'; id: string; expectedRevision: Revision; position: string }
	// Last writer wins.
	| { type: 'theme.toggle'; id: string; enabled: boolean }
	| { type: 'appearance.set'; id: typeof APPEARANCE_ID; activeTheme: string };

export const APPEARANCE_COMMAND_TYPES = [
	'theme.create',
	'theme.update',
	'theme.delete',
	'theme.move',
	'theme.toggle',
	'appearance.set'
] as const;
export function isAppearanceCommand(value: { type: string }): value is AppearanceCommand {
	return (APPEARANCE_COMMAND_TYPES as readonly string[]).includes(value.type);
}

function document(value: unknown): ThemeDocument {
	try {
		return parseThemeDocument(value);
	} catch (error) {
		if (error instanceof ThemeError) throw new ValidationError(error.message);
		throw error;
	}
}
export function parseActiveTheme(value: unknown): string {
	if (BUILTIN_THEMES.some((theme) => theme.id === value)) return value as string;
	return uuid(value);
}

export function parseAppearanceCommand(value: unknown): AppearanceCommand {
	const c = object(value);
	switch (c.type) {
		case 'theme.create':
			keys(c, ['type', 'id', 'document']);
			return { type: c.type, id: uuid(c.id), document: document(c.document) };
		case 'theme.update':
			keys(c, ['type', 'id', 'expectedRevision', 'document']);
			return {
				type: c.type,
				id: uuid(c.id),
				expectedRevision: revision(c.expectedRevision),
				document: document(c.document)
			};
		case 'theme.delete':
			keys(c, ['type', 'id', 'expectedRevision']);
			return { type: c.type, id: uuid(c.id), expectedRevision: revision(c.expectedRevision) };
		case 'theme.move':
			keys(c, ['type', 'id', 'expectedRevision', 'position']);
			return {
				type: c.type,
				id: uuid(c.id),
				expectedRevision: revision(c.expectedRevision),
				position: parseTagPosition(c.position)
			};
		case 'theme.toggle':
			keys(c, ['type', 'id', 'enabled']);
			if (typeof c.enabled !== 'boolean') throw new ValidationError('Expected true or false.');
			return { type: c.type, id: uuid(c.id), enabled: c.enabled };
		case 'appearance.set':
			keys(c, ['type', 'id', 'activeTheme']);
			if (c.id !== APPEARANCE_ID) throw new ValidationError('Unknown appearance record.');
			return { type: c.type, id: APPEARANCE_ID, activeTheme: parseActiveTheme(c.activeTheme) };
		default:
			throw new ValidationError('Unknown appearance command.');
	}
}
