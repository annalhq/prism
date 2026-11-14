import { and, eq, isNull, ne } from 'drizzle-orm';
import {
	APPEARANCE_ID,
	type AppearanceCommand,
	type AppearanceProjection,
	type ThemeProjection
} from '#lib/domain/appearance.js';
import type { Change, Revision, Sequence } from '#lib/domain/contracts.js';
import { normalizeOrganizationName } from '#lib/domain/organization.js';
import { builtinTheme, type ThemeDocument } from '#lib/domain/theme.js';
import type { Transaction } from '../db/connection.js';
import { themes, vaultAppearance } from '../db/schema.js';
import { reject } from './rejections.js';

function themeProjection(row: typeof themes.$inferSelect): ThemeProjection {
	return {
		id: row.id,
		kind: row.kind as ThemeProjection['kind'],
		name: row.name,
		document: row.document as ThemeDocument,
		enabled: row.enabled,
		position: row.position,
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
function appearanceProjection(row: typeof vaultAppearance.$inferSelect): AppearanceProjection {
	return {
		id: APPEARANCE_ID,
		activeTheme: row.activeTheme,
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

async function setActiveTheme(
	tx: Transaction,
	vaultId: string,
	activeTheme: string,
	seq: bigint,
	now: Date
): Promise<Change> {
	const [current] = await tx
		.select()
		.from(vaultAppearance)
		.where(eq(vaultAppearance.vaultId, vaultId));
	const [saved] = current
		? await tx
				.update(vaultAppearance)
				.set({ activeTheme, revision: current.revision + 1n, lastSeq: seq, updatedAt: now })
				.where(eq(vaultAppearance.vaultId, vaultId))
				.returning()
		: await tx
				.insert(vaultAppearance)
				.values({ vaultId, activeTheme, lastSeq: seq, createdAt: now, updatedAt: now })
				.returning();
	return { type: 'appearance.upsert', appearance: appearanceProjection(saved) };
}

async function requireUniqueName(
	tx: Transaction,
	vaultId: string,
	id: string,
	document: ThemeDocument
) {
	const { normalizedName } = normalizeOrganizationName(document.name);
	const [duplicate] = await tx
		.select({ id: themes.id })
		.from(themes)
		.where(
			and(
				eq(themes.vaultId, vaultId),
				eq(themes.kind, document.kind),
				eq(themes.normalizedName, normalizedName),
				isNull(themes.deletedAt),
				ne(themes.id, id)
			)
		)
		.limit(1);
	if (duplicate)
		reject('duplicate_name', `A ${document.kind} named "${document.name}" is already installed.`, {
			id,
			existingId: duplicate.id
		});
	return normalizedName;
}

export async function applyAppearanceCommand(
	tx: Transaction,
	vaultId: string,
	command: AppearanceCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	if (command.type === 'appearance.set') {
		if (!builtinTheme(command.activeTheme)) {
			const [theme] = await tx
				.select({ kind: themes.kind, deletedAt: themes.deletedAt })
				.from(themes)
				.where(and(eq(themes.vaultId, vaultId), eq(themes.id, command.activeTheme)));
			if (!theme || theme.deletedAt || theme.kind !== 'theme')
				reject('not_found', 'This theme is not installed.', { id: command.activeTheme });
		}
		return [await setActiveTheme(tx, vaultId, command.activeTheme, seq, now)];
	}

	const identity = and(eq(themes.vaultId, vaultId), eq(themes.id, command.id));
	const [current] = await tx.select().from(themes).where(identity);

	if (command.type === 'theme.create') {
		if (current) reject('id_exists', 'This theme ID is already reserved.', { id: command.id });
		const normalizedName = await requireUniqueName(tx, vaultId, command.id, command.document);
		const [saved] = await tx
			.insert(themes)
			.values({
				vaultId,
				id: command.id,
				kind: command.document.kind,
				name: command.document.name,
				normalizedName,
				document: command.document,
				lastSeq: seq,
				createdAt: now,
				updatedAt: now
			})
			.returning();
		return [{ type: 'theme.upsert', theme: themeProjection(saved) }];
	}

	if (!current || current.deletedAt)
		reject('not_found', 'This theme is not installed.', { id: command.id });
	if ('expectedRevision' in command && String(current.revision) !== command.expectedRevision)
		reject('revision_conflict', 'This theme changed. Review the current version.', {
			id: command.id,
			currentRevision: String(current.revision) as Revision
		});

	const changes: Change[] = [];
	let patch: Partial<typeof themes.$inferInsert>;
	switch (command.type) {
		case 'theme.update':
			if (command.document.kind !== current.kind)
				reject('invalid_command', `A ${current.kind} cannot become a ${command.document.kind}.`, {
					id: command.id
				});
			patch = {
				name: command.document.name,
				normalizedName: await requireUniqueName(tx, vaultId, command.id, command.document),
				document: command.document
			};
			break;
		case 'theme.move':
			patch = { position: command.position };
			break;
		case 'theme.toggle':
			patch = { enabled: command.enabled };
			break;
		case 'theme.delete': {
			patch = { deletedAt: now };
			const [appearance] = await tx
				.select({ activeTheme: vaultAppearance.activeTheme })
				.from(vaultAppearance)
				.where(eq(vaultAppearance.vaultId, vaultId));
			// Removing the active theme falls back to Zen of the same scheme.
			if (appearance?.activeTheme === command.id) {
				const scheme = (current.document as ThemeDocument).scheme;
				changes.push(
					await setActiveTheme(tx, vaultId, scheme === 'light' ? 'zen-light' : 'zen-dark', seq, now)
				);
			}
			break;
		}
	}
	const [saved] = await tx
		.update(themes)
		.set({ ...patch, revision: current.revision + 1n, lastSeq: seq, updatedAt: now })
		.where(identity)
		.returning();
	return [{ type: 'theme.upsert', theme: themeProjection(saved) }, ...changes];
}
