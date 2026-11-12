// Netscape bookmark file format (the HTML that Chrome, Firefox, Safari and Edge import/export).
// Parsing is a bounded tag scan over the text: nothing is rendered, executed, navigated or
// fetched, so a hostile file can only produce data, which callers validate like any other input.

export const NETSCAPE_MAX_LINKS = 10_000;
export const NETSCAPE_MAX_FOLDERS = 5_000;
export const NETSCAPE_MAX_DEPTH = 32;
// Before 1990 or more than a day ahead is a broken clock or a different unit, not a save date.
const MIN_DATE_MS = Date.UTC(1990, 0, 1);

export type NetscapeLink = {
	/** Position among all links in the file, stable for the same file contents. */
	index: number;
	title: string;
	href: string;
	/** ISO time from ADD_DATE, when it is a plausible date. */
	addedAt: string | null;
	/** Comma-separated TAGS attribute (Firefox and Prism exports). */
	tags: string[];
	description: string;
	/** Folder titles below any browser root container (Bookmarks bar, Other bookmarks, …). */
	path: string[];
	/** The browser root container the link came from, if any. */
	container: string | null;
};
export type NetscapeParse = {
	title: string;
	links: NetscapeLink[];
	folders: number;
	/** Browser root containers whose contents were treated as top level. */
	containers: string[];
	invalidDates: number;
	/** Folders nested deeper than the limit were merged into their ancestor at the limit. */
	flattenedDeepFolders: number;
};

// Roots browsers write around the user's own folders. Chrome and Firefox mark the toolbar and
// "other" roots with attributes; names cover the menu/mobile roots and older exports.
const CONTAINER_NAMES = new Set(
	[
		'bookmarks bar',
		'bookmarks toolbar',
		'bookmarks menu',
		'other bookmarks',
		'mobile bookmarks',
		'favorites bar',
		'favourites bar',
		'other favorites',
		'other favourites',
		'favorites',
		'favourites'
	].map((name) => name.toLowerCase())
);
const CONTAINER_ATTRIBUTES = ['personal_toolbar_folder', 'unfiled_bookmarks_folder'];

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	hellip: '…',
	middot: '·',
	bull: '•',
	copy: '©',
	reg: '®',
	trade: '™',
	laquo: '«',
	raquo: '»'
};

export function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});?/gi, (match, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			// Surrogates, NUL and out-of-range code points become the replacement character.
			if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
			return String.fromCodePoint(code);
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	for (const match of source.matchAll(
		/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
	)) {
		const name = match[1].toLowerCase();
		if (!(name in attributes))
			attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
	}
	return attributes;
}
/** Collapses markup whitespace the way a browser displays a title. */
const clean = (value: string) =>
	decodeEntities(value.replace(/<[^>]*>/g, ''))
		.replace(/\s+/gu, ' ')
		.trim();

/** Browsers write seconds; some tools write milliseconds or microseconds. */
export function parseBookmarkDate(value: string | undefined, now = Date.now()): string | null {
	if (!value || !/^\d{1,17}$/.test(value.trim())) return null;
	let n = Number(value.trim());
	if (n > 1e14) n /= 1000;
	if (n > 1e11) n /= 1000;
	const ms = Math.round(n * 1000);
	return ms >= MIN_DATE_MS && ms <= now + 86_400_000 ? new Date(ms).toISOString() : null;
}

/** Cheap structural check on a bounded prefix; extensions and MIME types are not trusted. */
export function looksLikeNetscape(text: string): boolean {
	const head = text.slice(0, 64 * 1024);
	if (/<!doctype\s+netscape-bookmark-file-1/i.test(head)) return true;
	return /<dl[\s>]/i.test(head) && /<dt[\s>]/i.test(head) && /<a\s[^>]*href\s*=/i.test(head);
}

const STRUCTURAL = new Set(['dt', 'dd', 'dl', 'h3', 'a', 'hr']);

type Folder = { title: string; container: boolean; depthLimited: boolean };

export function parseNetscape(text: string, now = Date.now()): NetscapeParse {
	const result: NetscapeParse = {
		title: '',
		links: [],
		folders: 0,
		containers: [],
		invalidDates: 0,
		flattenedDeepFolders: 0
	};
	// `null` stands for an anonymous list (the outer <DL>, or one without a heading).
	const stack: (Folder | null)[] = [];
	let heading: Folder | null = null;
	let capture: 'a' | 'h3' | 'h1' | 'title' | 'dd' | null = null;
	let buffer = '';
	let anchor: Record<string, string> | null = null;
	let headingAttributes: Record<string, string> = {};
	let last: NetscapeLink | null = null;
	const containers = new Set<string>();

	const finishText = () => {
		const value = buffer;
		buffer = '';
		const kind = capture;
		capture = null;
		if (kind === 'dd') {
			const description = decodeEntities(value.replace(/<[^>]*>/g, ''))
				.replace(/\r\n?/g, '\n')
				.trim();
			if (last && description && !last.description) last.description = description;
		} else if ((kind === 'h1' || kind === 'title') && !result.title) result.title = clean(value);
		else if (kind === 'h3') {
			const title = clean(value);
			result.folders++;
			if (result.folders > NETSCAPE_MAX_FOLDERS)
				throw new Error(
					`This file has more than ${NETSCAPE_MAX_FOLDERS.toLocaleString()} folders. Split it before importing.`
				);
			const depth = stack.filter(Boolean).length;
			const container =
				depth === 0 &&
				(CONTAINER_ATTRIBUTES.some((name) => name in headingAttributes) ||
					CONTAINER_NAMES.has(title.toLowerCase()));
			heading = { title, container, depthLimited: false };
			last = null;
		} else if (kind === 'a' && anchor) {
			const attributes = anchor;
			anchor = null;
			if (result.links.length >= NETSCAPE_MAX_LINKS)
				throw new Error(
					`This file has more than ${NETSCAPE_MAX_LINKS.toLocaleString()} bookmarks. Split it before importing.`
				);
			const folders = stack.filter((folder): folder is Folder => !!folder);
			const container = folders.find((folder) => folder.container)?.title ?? null;
			const addedAt = parseBookmarkDate(attributes.add_date, now);
			if (attributes.add_date && !addedAt) result.invalidDates++;
			last = {
				index: result.links.length,
				title: clean(value),
				href: (attributes.href ?? '').trim(),
				addedAt,
				tags: (attributes.tags ?? '')
					.split(',')
					.map((tag) => tag.replace(/\s+/gu, ' ').trim())
					.filter(Boolean),
				description: '',
				path: folders
					.filter((folder) => !folder.container && !folder.depthLimited)
					.map((f) => f.title),
				container
			};
			result.links.push(last);
		}
	};

	const pattern =
		/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		if (capture) buffer += text.slice(at, match.index);
		at = match.index + match[0].length;
		if (!match[2]) continue; // Comment, doctype or CDATA.
		const closing = match[1] === '/';
		const tag = match[2].toLowerCase();
		// Raw-text elements are skipped whole; their contents are never interpreted.
		if (!closing && (tag === 'script' || tag === 'style' || tag === 'textarea')) {
			const end = text.slice(at).search(new RegExp(`</${tag}\\s*>`, 'i'));
			if (capture) finishText();
			at = end < 0 ? text.length : at + end;
			pattern.lastIndex = at;
			continue;
		}
		if (capture === 'a' || capture === 'h3' || capture === 'h1' || capture === 'title') {
			if (closing && tag === capture) {
				finishText();
				continue;
			}
			// An unclosed title ends at the next structural tag instead of swallowing the file.
			if (!STRUCTURAL.has(tag)) continue; // Inline markup is dropped by `clean`.
			finishText();
		}
		if (capture === 'dd') {
			if (STRUCTURAL.has(tag)) finishText();
			else continue;
		}
		if (closing) {
			if (tag === 'dl') {
				stack.pop();
				last = null;
			}
			continue;
		}
		const attributes = match[3];
		if (tag === 'dl') {
			// Set inside `finishText`, which control-flow analysis can't see.
			const folder = heading as Folder | null;
			if (folder && stack.filter(Boolean).length >= NETSCAPE_MAX_DEPTH) {
				folder.depthLimited = true;
				result.flattenedDeepFolders++;
			}
			if (folder?.container) containers.add(folder.title);
			stack.push(folder);
			heading = null;
			last = null;
		} else if (tag === 'a') {
			capture = 'a';
			anchor = parseAttributes(attributes);
		} else if (tag === 'h3') {
			capture = 'h3';
			headingAttributes = parseAttributes(attributes);
		} else if (tag === 'h1' || tag === 'title') capture = tag;
		else if (tag === 'dd') capture = 'dd';
	}
	if (capture) {
		buffer += text.slice(at);
		finishText();
	}
	result.containers = [...containers];
	return result;
}

export type NetscapeExportLink = {
	title: string;
	url: string;
	addedAt: string | null;
	modifiedAt: string | null;
	tags: string[];
	description: string;
};
export type NetscapeExportFolder = { title: string; links: NetscapeExportLink[] };

const seconds = (iso: string | null) => {
	const ms = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : null;
};
function serializeLink(link: NetscapeExportLink, indent: string): string {
	const added = seconds(link.addedAt),
		modified = seconds(link.modifiedAt);
	let line = `${indent}<DT><A HREF="${escapeHtml(link.url)}"`;
	if (added) line += ` ADD_DATE="${added}"`;
	if (modified) line += ` LAST_MODIFIED="${modified}"`;
	if (link.tags.length) line += ` TAGS="${escapeHtml(link.tags.join(','))}"`;
	line += `>${escapeHtml(link.title || link.url)}</A>\n`;
	// A description is a single DD run; line breaks survive as text, markup is escaped.
	if (link.description) line += `${indent}<DD>${escapeHtml(link.description)}\n`;
	return line;
}

/** A standard file that Chrome, Firefox, Safari and Edge can import. */
export function serializeNetscape(
	root: NetscapeExportLink[],
	folders: NetscapeExportFolder[],
	exportedAt = new Date().toISOString()
): string {
	let out =
		'<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
		'<!-- This is an automatically generated file.\n' +
		'     It will be read and overwritten.\n' +
		'     DO NOT EDIT! -->\n' +
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
		'<TITLE>Bookmarks</TITLE>\n' +
		'<H1>Bookmarks</H1>\n' +
		'<DL><p>\n';
	const stamp = seconds(exportedAt);
	for (const folder of folders) {
		out += `    <DT><H3${stamp ? ` ADD_DATE="${stamp}" LAST_MODIFIED="${stamp}"` : ''}>${escapeHtml(folder.title)}</H3>\n`;
		out += '    <DL><p>\n';
		for (const link of folder.links) out += serializeLink(link, '        ');
		out += '    </DL><p>\n';
	}
	for (const link of root) out += serializeLink(link, '    ');
	return out + '</DL><p>\n';
}
