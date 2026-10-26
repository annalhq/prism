<script lang="ts">
	import {
		Pencil as PencilIcon,
		Clock3 as Clock3Icon,
		Trash2 as Trash2Icon,
		RotateCcw as RotateCcwIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Bookmarks open validated external HTTP source URLs. */
	import { Collapsible, ContextMenu } from 'bits-ui';
	import Favicon from './ui/Favicon.svelte';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { isReadLater, type Row } from '#lib/client/workflows.js';
	let {
		item,
		note = '',
		timeline = false,
		relation = '',
		tagLabels = [],
		selected = false,
		readonly = false,
		onEdit,
		onAction,
		onOpen,
		onDisconnect,
		feedback = () => {}
	}: {
		item: Row;
		note?: string;
		timeline?: boolean;
		relation?: string;
		tagLabels?: string[];
		selected?: boolean;
		// Public visitors only read: no context menu, swipes or edit affordances.
		readonly?: boolean;
		onEdit: () => void;
		onAction: (action: 'later' | 'trash' | 'restore' | 'purge') => void;
		onOpen: () => void;
		onDisconnect?: () => void;
		feedback?: (message: string) => void;
	} = $props();
	let offset = $state(0),
		menuOpen = $state(false),
		expanded = $state(false);
	const hasNote = $derived(note.trim().length > 0);
	$effect(() => {
		if (!hasNote) expanded = false;
	});
	const source = $derived.by(() => {
		try {
			return normalizeUrl(String(item.url)).url;
		} catch {
			return null;
		}
	});
	function openSource() {
		if (!source) {
			onEdit();
			return;
		}
		onOpen();
		window.open(source, '_blank', 'noopener,noreferrer');
	}
	async function copy() {
		if (!source) return;
		try {
			await navigator.clipboard.writeText(source);
			feedback('Link copied.');
		} catch {
			feedback('Could not copy. Open the bookmark and copy its address.');
		}
	}
	function swipe(node: HTMLElement) {
		let start: { x: number; y: number } | null = null,
			tracking = false,
			suppress = 0;
		const down = (e: PointerEvent) => {
			if (readonly) return;
			if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button')) return;
			start = { x: e.clientX, y: e.clientY };
			tracking = false;
		};
		const move = (e: PointerEvent) => {
			if (!start) return;
			const dx = e.clientX - start.x,
				dy = e.clientY - start.y;
			if (!tracking && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
				start = null;
				return;
			}
			if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
				tracking = true;
				menuOpen = false;
				offset = Math.max(-110, Math.min(110, dx));
				e.preventDefault();
			}
		};
		const up = () => {
			if (tracking) {
				suppress = performance.now() + 500;
				if (offset <= -64) onAction('later');
				else if (offset >= 64) onEdit();
			}
			offset = 0;
			start = null;
			tracking = false;
		};
		const cancel = () => {
			offset = 0;
			start = null;
			tracking = false;
		};
		const click = (e: MouseEvent) => {
			if (performance.now() < suppress) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		node.addEventListener('pointerdown', down);
		node.addEventListener('pointermove', move, { passive: false });
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', cancel);
		node.addEventListener('click', click, true);
		return {
			destroy() {
				node.removeEventListener('pointerdown', down);
				node.removeEventListener('pointermove', move);
				node.removeEventListener('pointerup', up);
				node.removeEventListener('pointercancel', cancel);
				node.removeEventListener('click', click, true);
			}
		};
	}
	function toggleFromRow(event: MouseEvent) {
		if (!hasNote || (event.target as HTMLElement).closest('a, button')) return;
		expanded = !expanded;
	}
	function toggleFromTitle(event: MouseEvent) {
		if (
			!hasNote ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			event.button !== 0
		) {
			onOpen();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		expanded = !expanded;
	}
	function toggleFromButton(event: MouseEvent) {
		if (!hasNote) {
			onEdit();
			return;
		}
		event.stopPropagation();
		expanded = !expanded;
	}
</script>

{#snippet row()}
	<div class="row-leading"><Favicon url={source} /></div>

	<div class="bookmark-content">
		{#if timeline && relation}<span class="post-relation">{relation}</span>{/if}
		{#if source}<a
				class="bookmark-title"
				title={String(item.title)}
				href={source}
				target="_blank"
				rel="noopener noreferrer"
				onclick={toggleFromTitle}>{item.title}</a
			>{:else}<button class="bookmark-title" onclick={toggleFromButton}>{item.title}</button>{/if}
		{#if isReadLater(item)}<span class="later-badge" title="Read later"
				><Clock3Icon /><span class="sr-only">Read later</span></span
			>{/if}
	</div>
	<span class="bookmark-domain"
		>{String(item.domain ?? (source ? new URL(source).hostname : '')).replace(/^www\./, '')}</span
	>
	{#if timeline && note}<p class="bookmark-note">{note}</p>{/if}
	{#if timeline && tagLabels.length}<div class="post-tags">
			{#each tagLabels as label (label)}<span class="chip">{label}</span>{/each}
		</div>{/if}
	<time class="bookmark-date" datetime={String(item.createdAt)}
		>{new Date(String(item.createdAt)).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		})}</time
	>
	<button
		hidden
		class="bookmark-open"
		tabindex="-1"
		aria-label={`Open ${item.title}`}
		onclick={openSource}
	></button>
	{#if !readonly}<button
			hidden
			class="bookmark-edit"
			tabindex="-1"
			aria-label={`Edit ${item.title}`}
			onclick={onEdit}
		></button>{/if}
	{#if source}<button
			hidden
			class="bookmark-copy"
			tabindex="-1"
			aria-label={`Copy link for ${item.title}`}
			onclick={copy}
		></button>{/if}
{/snippet}

<div
	class="bookmark-gesture"
	data-bookmark-id={String(item.id)}
	class:timeline-card={timeline}
	use:swipe
>
	{#if offset}<span class="swipe-hint" class:to-later={offset < 0}
			>{offset < 0 ? 'Read later' : 'Edit'}</span
		>{/if}
	<Collapsible.Root
		bind:open={expanded}
		class={`bookmark-disclosure${expanded ? ' expanded' : ''}${hasNote ? ' expandable' : ''}`}
	>
		{#if readonly}
			<!-- The title link and keyboard shortcuts carry the same actions as this row click. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class={`library-row ${selected ? 'selected' : ''}`} onclick={toggleFromRow}>
				{@render row()}
			</div>
		{:else}<ContextMenu.Root bind:open={menuOpen}
				><ContextMenu.Trigger
					class={`library-row ${selected ? 'selected' : ''}`}
					style={`transform:translateX(${offset}px)`}
					onclick={toggleFromRow}
				>
					{@render row()}
				</ContextMenu.Trigger><ContextMenu.Portal
					><ContextMenu.Content class="menu-content">
						<ContextMenu.Item class="menu-item" onSelect={onEdit}
							><PencilIcon />Edit</ContextMenu.Item
						>
						{#if item.deletedAt}<ContextMenu.Item
								class="menu-item"
								onSelect={() => onAction('restore')}><RotateCcwIcon />Restore</ContextMenu.Item
							>{:else}
							<ContextMenu.Item class="menu-item" onSelect={() => onAction('later')}
								><Clock3Icon />{isReadLater(item)
									? 'Remove from Read later'
									: 'Read later'}</ContextMenu.Item
							>
							{#if onDisconnect}<ContextMenu.Item class="menu-item" onSelect={onDisconnect}
									>Disconnect from this person</ContextMenu.Item
								>{/if}<ContextMenu.Separator class="menu-separator" />
							<ContextMenu.Item class="menu-item danger-text" onSelect={() => onAction('trash')}
								><Trash2Icon />Delete</ContextMenu.Item
							>
						{/if}
						{#if item.deletedAt}<ContextMenu.Item
								class="menu-item danger-text"
								onSelect={() => onAction('purge')}
								><Trash2Icon />Delete permanently</ContextMenu.Item
							>{/if}
					</ContextMenu.Content></ContextMenu.Portal
				></ContextMenu.Root
			>{/if}
		<Collapsible.Content class="bookmark-expansion">
			{#if hasNote}<p>{note}</p>{/if}
		</Collapsible.Content>
	</Collapsible.Root>
</div>
