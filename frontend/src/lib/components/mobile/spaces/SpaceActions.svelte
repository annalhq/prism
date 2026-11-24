<script lang="ts">
	import { ChevronLeft, ChevronRight, Pencil, Star, Trash2 } from '@lucide/svelte';
	import { ContextMenu } from 'bits-ui';

	type Row = Record<string, unknown>;
	// Actions for a space, shown in its tab's long-press menu.
	let {
		space,
		index,
		count,
		isDefault,
		onEditSpace,
		onSetDefault,
		onReorderSpace
	}: {
		space: Row;
		index: number;
		count: number;
		isDefault: boolean;
		onEditSpace: (space: Row, intent?: 'delete') => void;
		onSetDefault?: (id: string) => void;
		onReorderSpace?: (id: string, toIndex: number) => void;
	} = $props();
	const id = $derived(String(space.id));
	// The default space can only be deleted when it is the last one.
	const locked = $derived(isDefault && count > 1);
</script>

<ContextMenu.Item class="menu-item" onSelect={() => onEditSpace(space)}
	><Pencil /><span>Edit space</span></ContextMenu.Item
>
{#if onSetDefault && !isDefault}<ContextMenu.Item
		class="menu-item"
		onSelect={() => onSetDefault(id)}><Star /><span>Make default</span></ContextMenu.Item
	>{/if}
{#if onReorderSpace && index > 0}<ContextMenu.Item
		class="menu-item"
		onSelect={() => onReorderSpace(id, index - 1)}
		><ChevronLeft /><span>Move left</span></ContextMenu.Item
	>{/if}
{#if onReorderSpace && index < count - 1}<ContextMenu.Item
		class="menu-item"
		onSelect={() => onReorderSpace(id, index + 1)}
		><ChevronRight /><span>Move right</span></ContextMenu.Item
	>{/if}
<ContextMenu.Separator class="menu-separator" />
<ContextMenu.Item
	class="menu-item danger-text"
	disabled={locked}
	onSelect={() => onEditSpace(space, 'delete')}
	><Trash2 /><span>{locked ? 'Default can’t be deleted' : 'Delete'}</span></ContextMenu.Item
>
