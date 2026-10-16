<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Bookmarks open validated external HTTP source URLs. */
	import { ContextMenu } from 'bits-ui';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { isReadLater, type Row } from '#lib/client/workflows.js';
	import Check from './ui/Check.svelte';
	import IconPencilSimpleFill from 'phosphor-icons-svelte/IconPencilSimpleFill.svelte';
	import IconClockFill from 'phosphor-icons-svelte/IconClockFill.svelte';
	import IconArchiveFill from 'phosphor-icons-svelte/IconArchiveFill.svelte';
	import IconTrashFill from 'phosphor-icons-svelte/IconTrashFill.svelte';
	import IconArrowCounterClockwiseFill from 'phosphor-icons-svelte/IconArrowCounterClockwiseFill.svelte';
	let {
		item,
		note = '',
		timeline = false,
		checked = false,
		selected = false,
		onCheck,
		onEdit,
		onAction,
		onOpen,
		onDisconnect
	}: {
		item: Row;
		note?: string;
		timeline?: boolean;
		checked?: boolean;
		selected?: boolean;
		onCheck?: (checked: boolean) => void;
		onEdit: () => void;
		onAction: (action: 'later' | 'archive' | 'trash' | 'restore') => void;
		onOpen: () => void;
		onDisconnect?: () => void;
	} = $props();
	let offset = $state(0),
		menuOpen = $state(false);
	const source = $derived.by(() => {
		try {
			return normalizeUrl(String(item.url)).url;
		} catch {
			return null;
		}
	});
	function swipe(node: HTMLElement) {
		let start: { x: number; y: number } | null = null,
			tracking = false,
			suppress = 0;
		const down = (e: PointerEvent) => {
			if (
				e.pointerType !== 'touch' ||
				(e.target as HTMLElement).closest('[role="checkbox"],button')
			)
				return;
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
</script>

<div class="bookmark-gesture" class:timeline-card={timeline} use:swipe>
	{#if offset}<span class="swipe-hint" class:to-later={offset < 0}
			>{offset < 0 ? 'Read later' : 'Edit'}</span
		>{/if}
	<ContextMenu.Root bind:open={menuOpen}
		><ContextMenu.Trigger
			class={`library-row ${selected ? 'selected' : ''}`}
			style={`transform:translateX(${offset}px)`}
		>
			{#if onCheck && !item.deletedAt}<Check
					label={`Select ${item.title}`}
					{checked}
					onCheckedChange={onCheck}
				/>{/if}
			<div class="bookmark-content">
				<div class="bookmark-card-meta">
					<span>{item.domain ?? (source ? new URL(source).hostname : 'Saved bookmark')}</span><time
						datetime={String(item.createdAt)}
						>{new Date(String(item.createdAt)).toLocaleDateString(undefined, {
							month: 'short',
							day: 'numeric'
						})}</time
					>
				</div>
				{#if source}<a
						class="bookmark-title"
						href={source}
						target="_blank"
						rel="noopener noreferrer"
						onclick={onOpen}>{item.title}</a
					>{:else}<button class="bookmark-title" onclick={onEdit}>{item.title}</button>{/if}
				{#if note}<p class="bookmark-note">{note}</p>{/if}
				{#if isReadLater(item)}<span class="later-badge"><IconClockFill />Read later</span>{/if}
			</div>
			<button class="icon-button bookmark-edit" onclick={onEdit} aria-label={`Edit ${item.title}`}
				><IconPencilSimpleFill /></button
			>
		</ContextMenu.Trigger><ContextMenu.Portal
			><ContextMenu.Content class="menu-content">
				<ContextMenu.Item class="menu-item" onSelect={onEdit}
					><IconPencilSimpleFill />Edit</ContextMenu.Item
				>
				{#if item.deletedAt}<ContextMenu.Item class="menu-item" onSelect={() => onAction('restore')}
						><IconArrowCounterClockwiseFill />Restore</ContextMenu.Item
					>{:else}
					<ContextMenu.Item class="menu-item" onSelect={() => onAction('later')}
						><IconClockFill />{isReadLater(item)
							? 'Remove from Read later'
							: 'Read later'}</ContextMenu.Item
					>
					<ContextMenu.Item class="menu-item" onSelect={() => onAction('archive')}
						><IconArchiveFill />{item.archivedAt ? 'Unarchive' : 'Archive'}</ContextMenu.Item
					>
					{#if onDisconnect}<ContextMenu.Item class="menu-item" onSelect={onDisconnect}
							>Disconnect from this person</ContextMenu.Item
						>{/if}<ContextMenu.Separator class="menu-separator" />
					<ContextMenu.Item class="menu-item danger-text" onSelect={() => onAction('trash')}
						><IconTrashFill />Delete</ContextMenu.Item
					>
				{/if}
			</ContextMenu.Content></ContextMenu.Portal
		></ContextMenu.Root
	>
</div>
