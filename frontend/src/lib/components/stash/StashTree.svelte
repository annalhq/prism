<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Tree links are validated external http(s) URLs. */
	import {
		Folder,
		FolderOpen,
		ArrowUpRight,
		Copy,
		CornerLeftUp,
		Trash2,
		Pencil,
		CornerDownLeft
	} from '@lucide/svelte';
	import { ContextMenu } from 'bits-ui';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { SvelteSet } from 'svelte/reactivity';
	import Favicon from '../ui/Favicon.svelte';
	import {
		countLinks,
		descendantCount,
		filterStash,
		flatten,
		pathTo,
		type StashNode
	} from '#lib/domain/stash.js';

	// A rabbit hole's trail as a file tree. Each link hangs off the one it was found from on a
	// curved connector, and the connectors along the path to the selected link are drawn darker,
	// so the way down is always visible. A link that led to others is a folder: closed, it shows
	// how many links are inside. Read-only in previews (with a row limit); editable in the editor.
	let {
		nodes,
		open,
		selected = $bindable(null),
		readonly = false,
		query = '',
		limit = 0,
		loading = new Set<string>(),
		onDescribe,
		onRename,
		onRemove,
		onOutdent,
		onMove,
		onCopy
	}: {
		nodes: StashNode[];
		// Keys of the folders shown open; shared so the editor can open the way to a link.
		open: SvelteSet<string>;
		selected?: string | null;
		readonly?: boolean;
		// Shows only links matching this (and the links leading to them).
		query?: string;
		// Read-only previews: show this many rows, then "Show all".
		limit?: number;
		loading?: ReadonlySet<string>;
		onDescribe?: (key: string, description: string) => void;
		onRename?: (key: string, title: string) => void;
		onRemove?: (key: string) => void;
		onOutdent?: (key: string) => void;
		onMove?: (key: string, by: -1 | 1) => void;
		onCopy?: (url: string) => void;
	} = $props();

	let renaming = $state<string | null>(null);
	let menuKey = $state<string | null>(null);
	let showAll = $state(false);

	const everything = $derived(flatten(nodes, new Set(allKeys(nodes))));
	const menuNode = $derived(menuKey ? everything.find((n) => n.key === menuKey) : null);
	// The way down to the selected link, drawn darker.
	const onPath = $derived(new Set(selected ? pathTo(nodes, selected).map((n) => n.key) : []));
	// Searching opens every branch that holds a match and hides the rest.
	const found = $derived(query.trim() ? filterStash(nodes, query) : null);
	const isOpen = (key: string) => (found ? found.visible.has(key) : open.has(key));
	// Rows in reading order as shown, for the preview limit and keyboard movement.
	const shown = $derived(
		flatten(nodes, found ? found.visible : open).filter((n) => !found || found.visible.has(n.key))
	);
	const allowed = $derived(
		readonly && limit && !showAll && shown.length > limit
			? new Set(shown.slice(0, limit).map((n) => n.key))
			: null
	);
	// The same link more than once in a trail is allowed, just marked.
	const repeated = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const node of everything) counts[node.url] = (counts[node.url] ?? 0) + 1;
		return new Set(Object.keys(counts).filter((url) => counts[url] > 1));
	});
	function allKeys(list: StashNode[]): string[] {
		return list.flatMap((node) => [node.key, ...allKeys(node.children)]);
	}
	const domain = (url: string) => {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	};
	function toggle(key: string) {
		if (open.has(key)) open.delete(key);
		else open.add(key);
	}
	function openLink(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	// Tree keyboard: ↑/↓ move, →/← open or close (or step in and out), Enter opens the link;
	// in the editor, Delete removes and Alt+↑/↓ reorders among siblings.
	function keydown(event: KeyboardEvent) {
		if ((event.target as HTMLElement).closest('input, textarea')) return;
		const index = shown.findIndex((node) => node.key === selected);
		const node = shown[index];
		const go = (to: number) => {
			const next = shown[Math.max(0, Math.min(shown.length - 1, to))];
			if (next) selected = next.key;
		};
		if (
			event.altKey &&
			!readonly &&
			node &&
			(event.key === 'ArrowUp' || event.key === 'ArrowDown')
		) {
			event.preventDefault();
			onMove?.(node.key, event.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				go(index + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				go(index < 0 ? 0 : index - 1);
				break;
			case 'ArrowRight':
				if (!node?.children.length) return;
				event.preventDefault();
				if (!open.has(node.key)) open.add(node.key);
				else selected = node.children[0].key;
				break;
			case 'ArrowLeft': {
				if (!node) return;
				event.preventDefault();
				if (open.has(node.key) && node.children.length) open.delete(node.key);
				else {
					const way = pathTo(nodes, node.key);
					if (way.length > 1) selected = way[way.length - 2].key;
				}
				break;
			}
			case 'Enter':
				if (!node) return;
				event.preventDefault();
				openLink(node.url);
				break;
			case 'Delete':
			case 'Backspace':
				if (readonly || !node) return;
				event.preventDefault();
				go(index + 1 < shown.length ? index + 1 : index - 1);
				onRemove?.(node.key);
				break;
		}
	}
</script>

{#snippet branch(list: StashNode[], depth: number)}
	{#each list.filter((n) => (!found || found.visible.has(n.key)) && (!allowed || allowed.has(n.key))) as node, index (node.key)}
		{@const folder = node.children.length > 0}
		{@const expanded = folder && isOpen(node.key)}
		{@const editing = !readonly && selected === node.key}
		<li
			class="stash-node"
			class:on-path={onPath.has(node.key)}
			role="treeitem"
			aria-level={depth + 1}
			aria-selected={selected === node.key}
			aria-expanded={folder ? expanded : undefined}
			aria-posinset={index + 1}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="stash-row"
				class:selected={selected === node.key}
				class:match={found?.matches.has(node.key)}
				data-key={node.key}
				onclick={(event) => {
					if ((event.target as HTMLElement).closest('a, button, input')) return;
					selected = node.key;
				}}
			>
				{#if folder}<button
						type="button"
						class="stash-icon stash-toggle"
						aria-label={expanded ? `Close ${node.title}` : `Open ${node.title}`}
						onclick={() => {
							selected = node.key;
							if (!found) toggle(node.key);
						}}
						>{#if expanded}<FolderOpen />{:else}<Folder />{/if}</button
					>{:else}<span class="stash-icon"><Favicon url={node.url} /></span>{/if}
				<span class="stash-text">
					<span class="stash-line">
						{#if renaming === node.key && !readonly}<input
								class="stash-rename"
								value={node.title}
								aria-label="Link title"
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
									if (event.key === 'Escape') {
										event.currentTarget.value = node.title;
										event.currentTarget.blur();
									}
								}}
								onblur={(event) => {
									const title = event.currentTarget.value.trim();
									if (title && title !== node.title) onRename?.(node.key, title);
									renaming = null;
								}}
								{@attach (input) => input.select()}
							/>{:else}<a
								class="stash-title"
								class:shimmer={loading.has(node.key)}
								class:repeated={repeated.has(node.url)}
								href={node.url}
								target="_blank"
								rel="noopener noreferrer"
								title={repeated.has(node.url)
									? `${node.url} · also elsewhere in this trail`
									: node.url}
								ondblclick={(event) => {
									if (readonly) return;
									event.preventDefault();
									renaming = node.key;
								}}>{node.title}</a
							>{/if}
						{#if folder && !expanded}<span
								class="stash-badge"
								title={`${descendantCount(node)} links inside`}>{descendantCount(node)}</span
							>{/if}
					</span>
					{#if node.description && !editing}<span class="stash-description">{node.description}</span
						>{/if}
				</span>
				<span class="stash-domain">{domain(node.url)}</span>
			</div>
			{#if editing}<div
					class="stash-describe"
					transition:slide={{ duration: 220, easing: cubicOut }}
				>
					<input
						value={node.description}
						placeholder="Why this link…"
						aria-label={`Why ${node.title}`}
						maxlength="500"
						oninput={(event) => onDescribe?.(node.key, event.currentTarget.value)}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === 'Escape') {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
					/>
				</div>{/if}
			{#if expanded}<ul
					class="stash-children"
					role="group"
					transition:slide={{ duration: 300, easing: cubicOut }}
				>
					{@render branch(node.children, depth + 1)}
				</ul>{/if}
		</li>
	{/each}
{/snippet}

{#snippet tree()}
	<ul
		class="stash-tree"
		class:readonly
		role="tree"
		aria-label="Rabbit hole"
		tabindex="0"
		onkeydown={keydown}
		oncontextmenu={(event) => {
			const row = (event.target as HTMLElement).closest<HTMLElement>('[data-key]');
			menuKey = row?.dataset.key ?? null;
			if (menuKey) selected = menuKey;
		}}
	>
		{@render branch(nodes, 0)}
	</ul>
	{#if found && !found.matches.size}<p class="stash-empty">No links match “{query.trim()}”.</p>{/if}
	{#if allowed}<button type="button" class="stash-more" onclick={() => (showAll = true)}
			>Show all {countLinks(nodes)} links</button
		>{/if}
{/snippet}

{#if readonly}{@render tree()}{:else}<ContextMenu.Root
		><ContextMenu.Trigger
			>{#snippet child({ props })}<div {...props} class="stash-tree-frame">
					{@render tree()}
				</div>{/snippet}</ContextMenu.Trigger
		><ContextMenu.Portal
			><ContextMenu.Content class="menu-content" collisionPadding={12}>
				{#if menuNode}
					<div class="menu-header" aria-hidden="true">
						<Favicon url={menuNode.url} /><span>{domain(menuNode.url)}</span>
					</div>
					<ContextMenu.Item class="menu-item" onSelect={() => openLink(menuNode.url)}
						><ArrowUpRight /><span>Open link</span><kbd aria-label="Enter"
							><CornerDownLeft class="kbd-icon" /></kbd
						></ContextMenu.Item
					>
					<ContextMenu.Item class="menu-item" onSelect={() => onCopy?.(menuNode.url)}
						><Copy /><span>Copy link</span></ContextMenu.Item
					>
					<ContextMenu.Item class="menu-item" onSelect={() => (renaming = menuNode.key)}
						><Pencil /><span>Rename</span></ContextMenu.Item
					>
					<ContextMenu.Item class="menu-item" onSelect={() => onOutdent?.(menuNode.key)}
						><CornerLeftUp /><span>Move out a level</span></ContextMenu.Item
					>
					<ContextMenu.Separator class="menu-separator" />
					<ContextMenu.Item class="menu-item danger-text" onSelect={() => onRemove?.(menuNode.key)}
						><Trash2 /><span>Remove</span><kbd>⌫</kbd></ContextMenu.Item
					>
				{:else}<p class="menu-empty">Right-click a link.</p>{/if}
			</ContextMenu.Content></ContextMenu.Portal
		></ContextMenu.Root
	>{/if}
