import { fromMarkdown } from 'mdast-util-from-markdown';
import type { List, ListItem, Nodes, Paragraph, PhrasingContent } from 'mdast';

// A rabbit hole's trail of links, kept as a nested Markdown list in the item's note so it syncs,
// searches and exports like any note:
//
//   - [Title](https://…) — why this link
//     - [Found from it](https://…) — …
//
// A link nests under the link it was found from. `key`s identify nodes while editing; they are
// made up when parsing and never stored.

export type StashNode = {
	key: string;
	url: string;
	title: string;
	description: string;
	children: StashNode[];
};

const SEPARATOR = ' — ';
let counter = 0;
export const newKey = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

function safeUrl(value: string): string | null {
	try {
		const url = new URL(value);
		return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}

/** Plain text of inline Markdown, keeping what was escaped as written. */
function text(nodes: readonly PhrasingContent[]): string {
	return nodes
		.map((node) =>
			'value' in node
				? node.value
				: 'children' in node
					? text(node.children as PhrasingContent[])
					: ''
		)
		.join('');
}

function item(node: ListItem): StashNode | null {
	const paragraph = node.children.find((child): child is Paragraph => child.type === 'paragraph');
	const link = paragraph?.children.find((child) => child.type === 'link');
	const url = link?.type === 'link' ? safeUrl(link.url) : null;
	const nested = node.children.find((child): child is List => child.type === 'list');
	const children = nested ? list(nested) : [];
	if (!url || !paragraph || link?.type !== 'link') return null;
	const after = text(paragraph.children.slice(paragraph.children.indexOf(link) + 1))
		.replace(/\s+/g, ' ')
		.trim();
	return {
		key: newKey(),
		url,
		title: text(link.children).trim() || new URL(url).hostname.replace(/^www\./, ''),
		description: after.replace(/^[—–-]\s*/, ''),
		children
	};
}

function list(node: List): StashNode[] {
	return node.children.flatMap((child) => {
		const parsed = item(child);
		// An item without a usable link keeps its children, one level up.
		if (parsed) return [parsed];
		const nested = child.children.find((c): c is List => c.type === 'list');
		return nested ? list(nested) : [];
	});
}

/** Reads the trail from a note. Tolerant of hand edits: anything that isn't a link is skipped. */
export function parseStash(markdown: string): StashNode[] {
	const tree = fromMarkdown(markdown);
	return (tree.children as Nodes[]).flatMap((node) => (node.type === 'list' ? list(node) : []));
}

// Backslash-escapes what Markdown would otherwise read as formatting, so text round-trips.
const escapeText = (value: string) =>
	value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[\\`*_[\]<>#|~]/g, (char) => `\\${char}`);
// Angle brackets let a URL hold spaces and parentheses; `<` and `>` themselves are encoded.
const escapeUrl = (value: string) => `<${value.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;

export function serializeStash(nodes: readonly StashNode[], depth = 0): string {
	return nodes
		.map((node) => {
			const line = `${'  '.repeat(depth)}- [${escapeText(node.title) || 'link'}](${escapeUrl(node.url)})${
				node.description.trim() ? `${SEPARATOR}${escapeText(node.description)}` : ''
			}`;
			const children = node.children.length ? `\n${serializeStash(node.children, depth + 1)}` : '';
			return line + children;
		})
		.join('\n');
}

export function countLinks(nodes: readonly StashNode[]): number {
	return nodes.reduce((total, node) => total + 1 + countLinks(node.children), 0);
}

export function createNode(url: string, title = '', description = ''): StashNode | null {
	const safe = safeUrl(url);
	if (!safe) return null;
	return {
		key: newKey(),
		url: safe,
		title: title.trim() || new URL(safe).hostname.replace(/^www\./, ''),
		description,
		children: []
	};
}

/** Where a node sits: its sibling list and index, plus its parent node (null at the top). */
export function locate(
	nodes: StashNode[],
	key: string,
	parent: StashNode | null = null
): { siblings: StashNode[]; index: number; parent: StashNode | null } | null {
	for (let index = 0; index < nodes.length; index++) {
		if (nodes[index].key === key) return { siblings: nodes, index, parent };
		const found = locate(nodes[index].children, key, nodes[index]);
		if (found) return found;
	}
	return null;
}

/** A deep copy, so edits produce a new tree for reactivity and saving. */
export const cloneStash = (nodes: readonly StashNode[]): StashNode[] =>
	nodes.map((node) => ({ ...node, children: cloneStash(node.children) }));

/** Adds `node` under `parentKey` (the trail goes deeper), or at the end when there's no parent. */
export function addChild(nodes: StashNode[], parentKey: string | null, node: StashNode) {
	const tree = cloneStash(nodes);
	const at = parentKey ? locate(tree, parentKey) : null;
	if (at) at.siblings[at.index].children.push(node);
	else tree.push(node);
	return tree;
}

/** Adds `node` right after `siblingKey`, beside it (a branch). */
export function addSibling(nodes: StashNode[], siblingKey: string | null, node: StashNode) {
	const tree = cloneStash(nodes);
	const at = siblingKey ? locate(tree, siblingKey) : null;
	if (at) at.siblings.splice(at.index + 1, 0, node);
	else tree.push(node);
	return tree;
}

/** Removes a node; its children take its place, so the trail below it isn't lost. */
export function removeNode(nodes: StashNode[], key: string) {
	const tree = cloneStash(nodes);
	const at = locate(tree, key);
	if (at) at.siblings.splice(at.index, 1, ...at.siblings[at.index].children);
	return tree;
}

/** Moves a node out to sit after its parent, one level up. */
export function outdent(nodes: StashNode[], key: string) {
	const tree = cloneStash(nodes);
	const at = locate(tree, key);
	if (!at?.parent) return tree;
	const [node] = at.siblings.splice(at.index, 1);
	const up = locate(tree, at.parent.key)!;
	up.siblings.splice(up.index + 1, 0, node);
	return tree;
}

/** Moves a node up or down among its siblings. */
export function move(nodes: StashNode[], key: string, by: -1 | 1) {
	const tree = cloneStash(nodes);
	const at = locate(tree, key);
	if (!at) return tree;
	const to = at.index + by;
	if (to < 0 || to >= at.siblings.length) return tree;
	[at.siblings[at.index], at.siblings[to]] = [at.siblings[to], at.siblings[at.index]];
	return tree;
}

/** Changes one node's fields. */
export function updateNode(
	nodes: StashNode[],
	key: string,
	patch: Partial<Pick<StashNode, 'title' | 'description'>>
) {
	const tree = cloneStash(nodes);
	const at = locate(tree, key);
	if (at) Object.assign(at.siblings[at.index], patch);
	return tree;
}

/** Every node in reading order, for keyboard movement. */
export function flatten(nodes: readonly StashNode[], open: ReadonlySet<string>): StashNode[] {
	return nodes.flatMap((node) => [
		node,
		...(open.has(node.key) ? flatten(node.children, open) : [])
	]);
}

/** Keys of every link that has links under it: the folders, for opening a whole trail. */
export function branchKeys(nodes: readonly StashNode[]): string[] {
	return nodes.flatMap((node) =>
		node.children.length ? [node.key, ...branchKeys(node.children)] : []
	);
}

/** The links from the top of the trail down to `key`, inclusive; empty when it isn't there. */
export function pathTo(nodes: readonly StashNode[], key: string): StashNode[] {
	for (const node of nodes) {
		if (node.key === key) return [node];
		const below = pathTo(node.children, key);
		if (below.length) return [node, ...below];
	}
	return [];
}

/** How many links sit anywhere under a node. */
export const descendantCount = (node: StashNode): number => countLinks(node.children);

/**
 * The keys to show for a search: every link whose title, description or address matches, and
 * the links leading to it, so a match is always seen in its place in the trail. `matches` holds
 * only the links that matched.
 */
export function filterStash(
	nodes: readonly StashNode[],
	query: string
): { visible: Set<string>; matches: Set<string> } {
	const visible = new Set<string>();
	const matches = new Set<string>();
	const needle = query.trim().toLocaleLowerCase();
	const walk = (list: readonly StashNode[]): boolean => {
		let any = false;
		for (const node of list) {
			const own = `${node.title} ${node.description} ${node.url}`
				.toLocaleLowerCase()
				.includes(needle);
			const below = walk(node.children);
			if (own) matches.add(node.key);
			if (own || below) {
				visible.add(node.key);
				any = true;
			}
		}
		return any;
	};
	if (needle) walk(nodes);
	return { visible, matches };
}
