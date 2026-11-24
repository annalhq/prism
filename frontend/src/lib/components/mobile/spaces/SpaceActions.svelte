<script lang="ts">
	import { ChevronLeft, ChevronRight, Pencil, Star, Trash2 } from '@lucide/svelte';
	import type { ContextMenu, DropdownMenu } from 'bits-ui';

	type Row = Record<string, unknown>;
	// Space actions, shared by the tab's long-press menu and the ⋯ menu.
	let {
		Menu,
		space,
		index,
		count,
		isDefault,
		onEditSpace,
		onSetDefault,
		onReorderSpace
	}: {
		Menu: typeof ContextMenu | typeof DropdownMenu;
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

<Menu.Item class="menu-item" onSelect={() => onEditSpace(space)}
	><Pencil /><span>Edit space</span></Menu.Item
>
{#if onSetDefault && !isDefault}<Menu.Item class="menu-item" onSelect={() => onSetDefault(id)}
		><Star /><span>Make default</span></Menu.Item
	>{/if}
{#if onReorderSpace && index > 0}<Menu.Item
		class="menu-item"
		onSelect={() => onReorderSpace(id, index - 1)}><ChevronLeft /><span>Move left</span></Menu.Item
	>{/if}
{#if onReorderSpace && index < count - 1}<Menu.Item
		class="menu-item"
		onSelect={() => onReorderSpace(id, index + 1)}
		><ChevronRight /><span>Move right</span></Menu.Item
	>{/if}
<Menu.Separator class="menu-separator" />
<Menu.Item
	class="menu-item danger-text"
	disabled={locked}
	onSelect={() => onEditSpace(space, 'delete')}
	><Trash2 /><span>{locked ? 'Default can’t be deleted' : 'Delete'}</span></Menu.Item
>
