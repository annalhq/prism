<script lang="ts">
	import { Hash, Pencil, Trash2 } from '@lucide/svelte';
	import { ContextMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	type Row = Record<string, unknown>;
	// A folder's actions, on right-click (or long-press) anywhere on its header row.
	let {
		folder,
		onEdit,
		onCreateIn,
		children,
		class: className,
		ondragenter,
		ondragover
	}: {
		folder: Row;
		// Opens the folder sheet; `delete` arrives with the delete confirmation already showing.
		onEdit: (folder: Row, intent?: 'delete') => void;
		// Starts a new tag inside this folder.
		onCreateIn?: (folder: Row) => void;
		children: Snippet;
		class?: ClassValue;
		// The header is also a drop target while a tag is dragged.
		ondragenter?: (event: DragEvent) => void;
		ondragover?: (event: DragEvent) => void;
	} = $props();
</script>

<ContextMenu.Root
	><ContextMenu.Trigger class={className} {ondragenter} {ondragover}
		>{@render children()}</ContextMenu.Trigger
	><ContextMenu.Portal
		><ContextMenu.Content class="menu-content" collisionPadding={12}>
			{#if onCreateIn}<ContextMenu.Item class="menu-item" onSelect={() => onCreateIn(folder)}
					><Hash /><span>New tag</span></ContextMenu.Item
				>{/if}
			<ContextMenu.Item class="menu-item" onSelect={() => onEdit(folder)}
				><Pencil /><span>Edit</span></ContextMenu.Item
			><ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
				class="menu-item danger-text"
				onSelect={() => onEdit(folder, 'delete')}><Trash2 /><span>Delete</span></ContextMenu.Item
			>
		</ContextMenu.Content></ContextMenu.Portal
	></ContextMenu.Root
>
