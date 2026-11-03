import { parseMarkdown as parseTanStack } from '@tanstack/markdown/parser';
import { renderHtml } from '@tanstack/markdown/html';
import { autolinksExtension } from '@tanstack/markdown/extensions/autolinks';
import type {
	BlockNode,
	InlineNode,
	LinkNode,
	ListItemNode,
	MarkdownDocument,
	MarkdownExtension,
	ParseOptions,
	TableCellNode
} from '@tanstack/markdown';

// The one Markdown implementation for notes, stashes, references, imports and rendering, on the
// server and in the browser (TanStack Markdown: synchronous, dependency-free, works offline).
//
// Parsing keeps every destination as written (the URL policy is applied when rendering, so
// reference extraction sees `prism:` links). Raw HTML is not recognised: this parser would read
// any line starting with `<` as an HTML block, hiding the Markdown on it, so HTML stays inert
// text instead, is escaped when rendered, and never hides a link or reference.
// The AST has no source positions: source edits are proposed as text edits and accepted only
// when re-parsing proves that just the intended link changed (see reference-edits.ts).

export type MarkdownRoot = MarkdownDocument;
export type MarkdownNode = MarkdownDocument | BlockNode | InlineNode | ListItemNode | TableCellNode;
export type { LinkNode };

const keepUrl = (url: string) => url;
const autolinks = autolinksExtension();
const baseOptions = {
	allowHtml: false,
	headingIds: false,
	urlTransform: keepUrl
} satisfies ParseOptions;

/** Parses Markdown. `autolinks` turns bare http(s) URLs into links (rendering only). */
export function parseMarkdown(source: string, { autolinks: bare = false } = {}): MarkdownRoot {
	return parseTanStack(source, bare ? { ...baseOptions, extensions: [autolinks] } : baseOptions);
}

/** Direct children of any node, including list items and table cells. */
export function childNodes(node: MarkdownNode): MarkdownNode[] {
	switch (node.type) {
		case 'list':
			return node.items;
		case 'table':
			return [...node.header, ...node.rows.flat()];
		case 'footnotes':
			return node.items.flatMap((item) => item.children);
		default:
			return 'children' in node ? (node.children as MarkdownNode[]) : [];
	}
}

/** Depth-first, document order. Code and HTML have no children, so their contents are never visited. */
export function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
	visit(node);
	for (const child of childNodes(node)) walk(child, visit);
}

/** Text content as read: escapes resolved, formatting dropped, code kept. */
export function plainText(node: MarkdownNode): string {
	if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value;
	if (node.type === 'image') return node.alt;
	return childNodes(node).map(plainText).join('');
}

export type RenderPolicy = {
	/** Whether a destination may stay a link; unsafe ones are unwrapped to their text. */
	safeUrl: (url: string) => boolean;
	/** Typed `prism:` links: kept for the editor's navigation handler, or shown as text. */
	internalLinks: 'link' | 'text';
};

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
	);

// External links open in a new tab; task lists keep the classes the note styles use.
const htmlPolicy: MarkdownExtension = {
	name: 'prism-html',
	renderHtml(node, context) {
		if (node.type === 'link') {
			const external = /^https?:/i.test(node.href);
			const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
			return `<a href="${escapeHtml(node.href)}"${title}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${node.children.map(context.renderInline).join('')}</a>`;
		}
		if (node.type === 'list' && node.items.some((item) => item.checked !== undefined)) {
			const tag = node.ordered ? 'ol' : 'ul';
			const start = node.ordered && node.start !== undefined && node.start !== 1;
			const items = node.items.map((item) => {
				const box =
					item.checked === undefined
						? ''
						: `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `;
				const body = item.children
					.map((child) =>
						child.type === 'paragraph' && !node.loose
							? child.children.map(context.renderInline).join('')
							: context.renderBlock(child)
					)
					.join('\n');
				return `<li${item.checked === undefined ? '' : ' class="task-list-item"'}>${box}${body}</li>`;
			});
			return `<${tag} class="contains-task-list"${start ? ` start="${node.start}"` : ''}>\n${items.join('\n')}\n</${tag}>`;
		}
		return undefined;
	}
};

function sanitizeInline(nodes: InlineNode[], policy: RenderPolicy): InlineNode[] {
	return nodes.flatMap((node): InlineNode[] => {
		if (node.type === 'inlineHtml') return [];
		// No remote image requests: the alt text stays.
		if (node.type === 'image') return node.alt ? [{ type: 'text', value: node.alt }] : [];
		if (node.type === 'link') {
			const children = sanitizeInline(node.children, policy);
			const internal = /^prism:/i.test(node.href);
			if ((internal && policy.internalLinks === 'text') || !policy.safeUrl(node.href))
				return children;
			return [{ ...node, children }];
		}
		if ('children' in node && Array.isArray(node.children))
			return [{ ...node, children: sanitizeInline(node.children as InlineNode[], policy) }];
		return [node];
	});
}

function sanitizeBlocks(nodes: BlockNode[], policy: RenderPolicy): BlockNode[] {
	return nodes.flatMap((node): BlockNode[] => {
		switch (node.type) {
			case 'html':
				return [];
			case 'heading':
			case 'paragraph':
				return [{ ...node, children: sanitizeInline(node.children, policy) }];
			case 'blockquote':
			case 'callout':
			case 'component':
				return [{ ...node, children: sanitizeBlocks(node.children, policy) }];
			case 'list':
				return [
					{
						...node,
						items: node.items.map((item) => ({
							...item,
							children: sanitizeBlocks(item.children, policy)
						}))
					}
				];
			case 'table': {
				const cell = (value: TableCellNode): TableCellNode => ({
					...value,
					children: sanitizeInline(value.children, policy)
				});
				return [
					{ ...node, header: node.header.map(cell), rows: node.rows.map((r) => r.map(cell)) }
				];
			}
			case 'footnotes':
				return [
					{
						...node,
						items: node.items.map((item) => ({
							...item,
							children: sanitizeBlocks(item.children, policy)
						}))
					}
				];
			default:
				return [node];
		}
	});
}

/**
 * Safe HTML for note text: raw HTML shown as text, never markup; no remote images (alt text stays), only destinations the
 * policy allows. Markdown only — nothing is ever evaluated.
 */
export function renderSafeMarkdown(source: string, policy: RenderPolicy): string {
	const tree = parseMarkdown(source, { autolinks: true });
	return renderHtml(
		{ ...tree, children: sanitizeBlocks(tree.children, policy) },
		{ allowHtml: false, headingIds: false, urlTransform: keepUrl, extensions: [htmlPolicy] }
	);
}
