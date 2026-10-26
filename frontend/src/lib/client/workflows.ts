import {
	normalizeOrganizationName,
	positionBetween,
	spreadPositions
} from '#lib/domain/organization.js';
import type { Revision } from '#lib/domain/contracts.js';
import type { PersonLink } from '#lib/domain/person-links.js';
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

type Reader = { list<T>(table: 'identities'): T[] };
/** Active profile links for every person, X first. */
export function personLinksIndex(library: Reader | null): Map<string, Row[]> {
	const index = new Map<string, Row[]>();
	for (const row of library?.list<Row>('identities') ?? []) {
		if (row.deletedAt) continue;
		const list = index.get(String(row.personId)) ?? [];
		list.push(row);
		index.set(String(row.personId), list);
	}
	for (const list of index.values())
		list.sort(
			(a, b) =>
				Number(b.platform === 'x') - Number(a.platform === 'x') ||
				String(a.createdAt).localeCompare(String(b.createdAt))
		);
	return index;
}
export function xHandle(links: Row[] | undefined): string | null {
	const x = links?.find((row) => row.platform === 'x' && row.handle);
	return x ? String(x.handle) : null;
}
/** Adds and removes confirmed identities so the person has exactly `links`. */
export async function syncPersonLinks(
	library: LibraryClient,
	personId: string,
	links: PersonLink[]
): Promise<void> {
	const current = library
		.list<Row>('identities')
		.filter((row) => !row.deletedAt && row.personId === personId);
	const wanted = new Set(links.map((link) => link.profileUrl));
	const have = new Set(current.map((row) => String(row.profileUrl)));
	for (const row of current) {
		if (wanted.has(String(row.profileUrl))) continue;
		const result = await library.save({
			type: 'person-identity.remove',
			id: String(row.id),
			personId,
			expectedRevision: String(row.revision) as Revision
		});
		if (result.status === 'rejected')
			throw new Error(result.message ?? 'Could not remove a profile link.');
	}
	for (const link of links) {
		if (have.has(link.profileUrl)) continue;
		const result = await library.save({
			type: 'person-identity.add',
			id: crypto.randomUUID(),
			personId,
			platform: link.platform,
			profileUrl: link.profileUrl,
			handle: link.handle,
			confirmed: true
		});
		if (result.status === 'rejected')
			throw new Error(
				result.existingId
					? `${link.handle ? '@' + link.handle : link.profileUrl} already belongs to another person.`
					: (result.message ?? 'Could not add a profile link.')
			);
	}
}
/** Feed-style time: "now", "5m", "3h", "2d", then "Mar 4", with the year once it differs. */
export function postTime(value: unknown, now = Date.now()): string {
	const date = new Date(String(value));
	const seconds = Math.max(0, (now - date.getTime()) / 1000);
	if (!Number.isFinite(seconds)) return '';
	if (seconds < 60) return 'now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {})
	});
}
