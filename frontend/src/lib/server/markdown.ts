import { hastToHtml, markdownToHast } from 'satteri';
import { isSafeNoteUrl } from '#lib/domain/notes.js';

// Markdown for text items, rendered with Sätteri (GFM: tables, strikethrough, task lists,
// autolinks). Sätteri re-emits raw HTML verbatim and keeps any link target, so the tree is
// cleaned before it is serialised, to the same policy as the client's note renderer: no raw
// HTML, no remote images (their alt text stays), and only http(s), mailto and prism: links.

type Node = {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: Node[];
};

// Elements Markdown produces that are safe to keep; anything else is unwrapped to its children.
const ALLOWED = new Set([
	...['p', 'br', 'hr', 'blockquote', 'pre', 'code', 'strong', 'em', 'del', 's', 'sup', 'sub'],
	...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'input', 'span'],
	...['table', 'thead', 'tbody', 'tr', 'th', 'td']
]);
const TASK_CLASSES = new Set(['contains-task-list', 'task-list-item']);

function attributes(node: Node): Record<string, unknown> {
	const from = node.properties ?? {};
	const kept: Record<string, unknown> = {};
	if (node.tagName === 'a') {
		const href = typeof from.href === 'string' ? from.href : '';
		kept.href = href;
		if (/^https?:/i.test(href)) {
			kept.target = '_blank';
			kept.rel = 'noopener noreferrer';
		}
	}
	// Task-list checkboxes: shown, never interactive.
	if (node.tagName === 'input') {
		kept.type = 'checkbox';
		kept.disabled = true;
		if (from.checked) kept.checked = true;
	}
	if ((node.tagName === 'th' || node.tagName === 'td') && typeof from.align === 'string')
		kept.align = from.align;
	const classes = Array.isArray(from.className) ? from.className : [from.className];
	const task = classes.filter((name) => typeof name === 'string' && TASK_CLASSES.has(name));
	if (task.length) kept.className = task;
	// Ordered lists that start elsewhere keep their number.
	if (node.tagName === 'ol' && typeof from.start === 'number') kept.start = from.start;
	return kept;
}

function clean(nodes: Node[] = []): Node[] {
	return nodes.flatMap((node): Node[] => {
		if (node.type === 'text') return [node];
		if (node.type !== 'element' || !node.tagName) return []; // raw HTML, comments, doctypes
		if (node.tagName === 'img') {
			const alt = node.properties?.alt;
			return typeof alt === 'string' && alt ? [{ type: 'text', value: alt }] : [];
		}
		const children = clean(node.children);
		if (!ALLOWED.has(node.tagName)) return children;
		if (node.tagName === 'input' && node.properties?.type !== 'checkbox') return [];
		if (node.tagName === 'a') {
			const href = node.properties?.href;
			if (typeof href !== 'string' || !isSafeNoteUrl(href)) return children;
		}
		return [{ type: 'element', tagName: node.tagName, properties: attributes(node), children }];
	});
}

export function renderMarkdown(markdown: string): string {
	const tree = markdownToHast(markdown, { position: false }) as unknown as Node;
	return hastToHtml({ type: 'root', children: clean(tree.children) } as never);
}
