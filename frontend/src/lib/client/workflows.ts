import { normalizeOrganizationName } from '#lib/domain/organization.js';
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
