// Passages saved from pages with the browser extension, and how the library shows them.

type Row = Record<string, unknown>;

/** Bookmarks saved with a page highlight carry this tag (see the extension save command). */
export const HIGHLIGHT_TAG = 'highlight';

export type Passage = { id: string; text: string; createdAt: string | null };

/** The `#highlight` tag's ID, if the library has one. */
export function highlightTagId(tags: Row[]): string | null {
	const tag = tags.find((t) => String(t.name).toLowerCase() === HIGHLIGHT_TAG);
	return tag ? String(tag.id) : null;
}

export function isHighlightEntry(row: Row, tagId: string | null): boolean {
	return !!tagId && ((row.tagIds as string[] | undefined) ?? []).includes(tagId);
}

/** Every saved passage, grouped by bookmark in the order they were highlighted. */
export async function loadHighlights(signal?: AbortSignal): Promise<Map<string, Passage[]>> {
	const response = await fetch('/api/v1/highlights', { cache: 'no-store', signal });
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(result.message ?? 'Could not load highlights.');
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Built once, then read only.
	const byBookmark = new Map<string, Passage[]>();
	for (const row of (result.highlights ?? []) as Record<string, unknown>[]) {
		const id = String(row.bookmarkId);
		const list = byBookmark.get(id) ?? [];
		list.push({
			id: String(row.id),
			text: String(row.text),
			createdAt: row.createdAt ? String(row.createdAt) : null
		});
		byBookmark.set(id, list);
	}
	return byBookmark;
}

/**
 * Passages read back from a description, for when the saved ones can't be fetched (offline).
 * Repeated highlights are appended to the description separated by a blank line.
 */
export function passagesFromDescription(id: string, description: string): Passage[] {
	return description
		.split(/\n\s*\n/)
		.map((text) => text.trim())
		.filter(Boolean)
		.map((text, i) => ({ id: `${id}:${i}`, text, createdAt: null }));
}

/** The passage's paragraphs, as the reader saw them on the page. */
export function paragraphs(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.map((part) => part.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

// Text fragments treat these as syntax, so they must be escaped inside a term.
const fragmentTerm = (text: string) =>
	encodeURIComponent(text).replace(
		/[-,&]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);

/**
 * The source URL with a text fragment (`#:~:text=`) that scrolls to and marks the passage in
 * browsers that support it; others just open the page. Long passages are matched by their first
 * and last few words, which is what the directive's `start,end` form is for.
 */
export function passageUrl(source: string, text: string): string {
	const words = text.replace(/\s+/g, ' ').trim().split(' ');
	if (!words[0]) return source;
	const directive =
		words.length <= 10
			? fragmentTerm(words.join(' '))
			: `${fragmentTerm(words.slice(0, 5).join(' '))},${fragmentTerm(words.slice(-5).join(' '))}`;
	try {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- A scratch parse, not state.
		const url = new URL(source);
		const hash = url.hash.split(':~:')[0];
		url.hash = '';
		return `${url.href}${hash || '#'}:~:text=${directive}`;
	} catch {
		return source;
	}
}

/** The passages as Markdown quotes with their source, for pasting into notes. */
export function passagesMarkdown(
	title: string,
	source: string | null,
	passages: Passage[]
): string {
	const quotes = passages.map((p) =>
		paragraphs(p.text)
			.map((line) => `> ${line}`)
			.join('\n>\n')
	);
	const heading = source ? `[${title}](${source})` : title;
	return `${heading}\n\n${quotes.join('\n\n')}\n`;
}

// Device preference: highlight entries can stay out of All bookmarks, which is for bookmarks.
const HIDE_KEY = 'prism:highlights-in-all';
export const highlightPreference = $state<{ hideInAll: boolean }>({ hideInAll: false });
export function initializeHighlightPreference() {
	try {
		highlightPreference.hideInAll = localStorage.getItem(HIDE_KEY) === 'hidden';
	} catch {
		/* Use default. */
	}
}
export function setHighlightsHiddenInAll(hidden: boolean) {
	highlightPreference.hideInAll = hidden;
	try {
		localStorage.setItem(HIDE_KEY, hidden ? 'hidden' : 'shown');
	} catch {
		/* Device storage is optional. */
	}
}
