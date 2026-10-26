import {
	normalizeOrganizationName,
	positionBetween,
	spreadPositions
} from '#lib/domain/organization.js';
import type { Revision } from '#lib/domain/contracts.js';
import { normalizeUrl } from '#lib/domain/urls.js';
import type { LibraryClient } from './vault/library.js';
export type Row = Record<string, unknown>;
export function inferBookmarkKind(url: string): 'page' | 'social' {
	const host = new URL(normalizeUrl(url).url).hostname;
	return /(^|\.)(x\.com|twitter\.com)$/i.test(host) ? 'social' : 'page';
}
export const isReadLater = (row: Row) => row.readingStatus === 'reading';
export function personSlug(person: Row): string {
	const name =
		String(person.displayName ?? 'person')
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'person';
	return `${name}--${person.id}`;
}
export function personIdFromSlug(slug: string): string | null {
	return (
		slug
			.match(/(?:^|--)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1]
			.toLowerCase() ?? null
	);
}
/**
 * Moves one tag to `toIndex` of `ordered` (the list as shown, already sorted). Usually one
 * command; the first reorder of never-ordered tags gives every tag a position.
 */
export async function moveTag(
	library: LibraryClient,
	ordered: Row[],
	id: string,
	toIndex: number
): Promise<void> {
	const from = ordered.findIndex((t) => t.id === id);
	if (from < 0) return;
	const next = ordered.filter((t) => t.id !== id);
	const index = Math.max(0, Math.min(toIndex, next.length));
	if (index === from) return;
	next.splice(index, 0, ordered[from]);
	const position = (row: Row | undefined) =>
		typeof row?.position === 'string' ? row.position : null;
	const before = next[index - 1],
		after = next[index + 1];
	const updates: [Row, string][] =
		(!before || position(before)) && (!after || position(after))
			? [[ordered[from], positionBetween(position(before), position(after))]]
			: ((keys) =>
					next
						.map((row, i): [Row, string] => [row, keys[i]])
						.filter(([row, key]) => row.position !== key))(spreadPositions(next.length));
	for (const [row, key] of updates) {
		const current = library.get<Row>('tags', String(row.id)) ?? row;
		const result = await library.save({
			type: 'tag.move',
			id: String(row.id),
			expectedRevision: String(current.revision) as Revision,
			position: key
		});
		if (result.status === 'rejected') throw new Error(result.message ?? 'Could not reorder tags.');
	}
}
export function tagNames(input: string): string[] {
	const names = new Map<string, string>();
	for (const token of input.split(',')) {
		const raw = token.trim().replace(/^#+/, '');
		if (!raw) continue;
		const name = normalizeOrganizationName(raw);
		names.set(name.normalizedName, name.name);
	}
	return [...names.values()];
}
export async function ensureTag(library: LibraryClient, name: string): Promise<string> {
	const normalized = normalizeOrganizationName(name);
	const existing = library
		.list<Row>('tags')
		.find(
			(t) =>
				!t.deletedAt &&
				normalizeOrganizationName(t.name).normalizedName === normalized.normalizedName
		);
	if (existing) return String(existing.id);
	const id = crypto.randomUUID();
	const result = await library.save({ type: 'tag.create', id, name: normalized.name });
	if (result.status === 'rejected') throw new Error(result.message ?? 'Could not create tag.');
	return id;
}
