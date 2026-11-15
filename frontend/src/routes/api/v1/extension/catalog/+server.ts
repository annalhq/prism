import type { RequestHandler } from './$types';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { requireExtensionOwner } from '#lib/server/extension-auth.js';
import { database } from '#lib/server/db/connection.js';
import {
	bookmarkHighlights,
	entities,
	people,
	tags,
	themes,
	vaultAppearance
} from '#lib/server/db/schema.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { sortByPosition } from '#lib/domain/organization.js';
import {
	builtinTheme,
	DEFAULT_THEME,
	parseThemeDocument,
	resolveAppearance,
	type BuiltinThemeId,
	type ThemeDocument
} from '#lib/domain/theme.js';

/**
 * The library's active theme and enabled modules, resolved to CSS variables the extension
 * layers over its built-in Zen tokens. Mirrors `syncAppearance` in the web app.
 */
async function extensionAppearance(vaultId: string) {
	const [[record], rows] = await Promise.all([
		database()
			.select({ activeTheme: vaultAppearance.activeTheme })
			.from(vaultAppearance)
			.where(eq(vaultAppearance.vaultId, vaultId)),
		database()
			.select({
				id: themes.id,
				document: themes.document,
				enabled: themes.enabled,
				position: themes.position
			})
			.from(themes)
			.where(and(eq(themes.vaultId, vaultId), isNull(themes.deletedAt)))
	]);
	const installed = sortByPosition(rows).flatMap((row) => {
		try {
			return [{ ...row, document: parseThemeDocument(row.document) }];
		} catch {
			return [];
		}
	});
	const id = record?.activeTheme ?? DEFAULT_THEME;
	const theme: BuiltinThemeId | ThemeDocument =
		installed.find((row) => row.id === id && row.document.kind === 'theme')?.document ??
		(builtinTheme(id) ? (id as BuiltinThemeId) : DEFAULT_THEME);
	const modules = installed
		.filter((row) => row.document.kind === 'module' && row.enabled)
		.map((row) => row.document);
	const { scheme, tokens, radii } = resolveAppearance(theme, modules);
	return { scheme, tokens: Object.fromEntries([...tokens, ...radii]) };
}

/** Before migration 0015 there is no highlights table; the catalog still works without it. */
function missingTable(error: unknown): never[] {
	// Drizzle wraps driver errors; the Postgres code is on the cause.
	const code = (value: unknown) =>
		value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined;
	if (code(error) === '42P01' || code((error as { cause?: unknown })?.cause) === '42P01') return [];
	throw error;
}

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireExtensionOwner(event.request);
		const [tagRows, personRows, highlighted, appearance] = await Promise.all([
			database()
				.select({ id: tags.id, name: tags.name })
				.from(tags)
				.where(and(eq(tags.vaultId, owner.vaultId), isNull(tags.deletedAt)))
				.orderBy(asc(tags.name))
				.limit(1000),
			database()
				.select({ id: people.id, displayName: people.displayName })
				.from(people)
				.innerJoin(entities, and(eq(entities.vaultId, people.vaultId), eq(entities.id, people.id)))
				.where(
					and(
						eq(people.vaultId, owner.vaultId),
						eq(entities.kind, 'person'),
						isNull(entities.deletedAt),
						isNull(entities.purgedAt)
					)
				)
				.orderBy(asc(people.displayName))
				.limit(1000),
			// Pages with highlights, as URL hashes: the extension checks the page it is on against
			// these locally and only asks for highlights on a match.
			database()
				.selectDistinct({ urlHash: entities.urlHash })
				.from(bookmarkHighlights)
				.innerJoin(
					entities,
					and(
						eq(entities.vaultId, bookmarkHighlights.vaultId),
						eq(entities.id, bookmarkHighlights.bookmarkId)
					)
				)
				.where(
					and(
						eq(bookmarkHighlights.vaultId, owner.vaultId),
						isNull(entities.deletedAt),
						isNotNull(entities.urlHash)
					)
				)
				.limit(5000)
				.catch(missingTable),
			extensionAppearance(owner.vaultId)
		]);
		return Response.json(
			{
				tags: tagRows,
				people: personRows,
				highlightedUrls: highlighted.map((row) => row.urlHash!),
				appearance
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
