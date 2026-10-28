/**
 * The search bar's query language, before anything is resolved against the library.
 *
 *   word  "a phrase"        text anywhere in a bookmark
 *   #tag  #a #b             tags; every one must match (intersection)
 *   #a|b  #{a, b}           any of these tags (union)
 *   @name  @a|b             connected to a person, or any of several
 *   !x  -x                  not: works on any of the above and every operator below;
 *                           a bare !name means the tag of that name, else the word
 *   !{a, b}                 none of these tags
 *   site:  is:  has:  before:  after:  title:
 *
 * The bar turns each finished operator into a chip; the query string stays the one source
 * of truth, so the URL, back button and saved searches keep working unchanged.
 */
export type QueryToken = { raw: string; complete: boolean };

/** Splits on whitespace outside quotes and braces. `complete` = followed by whitespace. */
export function tokenizeQuery(input: string): { tokens: QueryToken[]; error?: string } {
	const tokens: QueryToken[] = [];
	let value = '',
		inQuote = false,
		depth = 0;
	for (const char of input) {
		if (char === '"') inQuote = !inQuote;
		else if (!inQuote && char === '{') depth++;
		else if (!inQuote && char === '}') depth = Math.max(0, depth - 1);
		if (/\s/.test(char) && !inQuote && depth === 0) {
			if (value) tokens.push({ raw: value, complete: true });
			value = '';
		} else value += char;
	}
	if (value) tokens.push({ raw: value, complete: false });
	return {
		tokens,
		error: inQuote
			? 'Close the quotation mark to search.'
			: depth
				? 'Close the brace to search.'
				: undefined
	};
}

export type TokenKind = 'text' | 'tag' | 'person' | 'operator' | 'bare';
export type ParsedToken = {
	raw: string;
	negate: boolean;
	kind: TokenKind;
	/** Tag or person names (one, or several for a union); the text; or the operator value. */
	values: string[];
	/** For operators: site, is, has, before, after or title. */
	key?: string;
	quoted: boolean;
};

export const OPERATORS = ['site', 'is', 'has', 'before', 'after', 'title'] as const;

/** Names in `#a|b|#c`, `#{a, b}` or `{a,b}`, without their # or @ sigils. */
function names(body: string, sigil: '#' | '@'): string[] {
	let inner = body.startsWith(sigil) ? body.slice(1) : body;
	if (inner.startsWith('{') && inner.endsWith('}')) inner = inner.slice(1, -1);
	return [
		...new Set(
			inner
				.split(/[|,]/)
				.map((name) => name.trim().replace(sigil === '#' ? /^#/ : /^@/, ''))
				.filter(Boolean)
		)
	];
}
const unquote = (value: string) =>
	value.length > 1 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

export function parseToken(raw: string): ParsedToken {
	// `!` or `-` negates, but only as a prefix to something: a lone dash is just a dash.
	const negate = /^[!-]\S/.test(raw);
	const body = negate ? raw.slice(1) : raw;
	const base = { raw, negate, quoted: body.startsWith('"') };
	if (body.startsWith('"')) return { ...base, kind: 'text', values: [unquote(body)] };
	if (body.startsWith('#') || body.startsWith('{'))
		return { ...base, kind: 'tag', values: names(body, '#') };
	if (body.startsWith('@')) return { ...base, kind: 'person', values: names(body, '@') };
	const colon = body.indexOf(':');
	if (colon > 0) {
		const key = body.slice(0, colon).toLowerCase();
		return {
			...base,
			kind: 'operator',
			key,
			values: unquote(body.slice(colon + 1))
				.split('|')
				.map((value) => value.trim())
				.filter(Boolean)
		};
	}
	// `!tweets`: the tag named tweets if there is one, otherwise the word.
	return { ...base, kind: negate ? 'bare' : 'text', values: [body] };
}

/** Whether a token is a filter (shown as a chip) rather than plain text to match. */
export const isFilterToken = (token: ParsedToken) =>
	token.kind !== 'text' || (token.negate && !!token.values[0]);

/** A short human label for a chip: `not #tweets`, `#design or #essays`, `site x.com`. */
export function describeToken(token: ParsedToken): string {
	const join = (items: string[], sigil: string) =>
		items.map((item) => `${sigil}${item}`).join(token.negate ? ', ' : ' or ');
	const body =
		token.kind === 'tag'
			? join(token.values, '#')
			: token.kind === 'person'
				? join(token.values, '@')
				: token.kind === 'operator'
					? `${token.key} ${token.values.join(' or ')}`
					: token.quoted
						? `“${token.values[0]}”`
						: token.values[0];
	return token.negate ? `not ${body}` : body;
}
