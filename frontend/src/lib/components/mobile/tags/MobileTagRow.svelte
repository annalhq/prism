<script lang="ts">
	import { ChevronRight, Hash } from '@lucide/svelte';

	type Row = Record<string, unknown>;
	// One tag: tap to open it. `where` names its folder (and space, in search results), when the
	// list around it doesn't already say.
	let {
		tag,
		count,
		where,
		onSelect
	}: {
		tag: Row;
		count: number;
		where?: string;
		onSelect: (value: string) => void;
	} = $props();
</script>

<!-- Global row classes, so this shares the tags page's inset-group look on phones. -->
<button class="tag-row" onclick={() => onSelect(`tag:${tag.id}`)}
	><Hash /><span>{tag.name}</span>{#if where}<em class="tag-row-folder">{where}</em>{/if}<small
		>{count}</small
	><ChevronRight class="tag-row-go" /></button
>

<style>
	.tag-row {
		-webkit-tap-highlight-color: transparent;
	}
</style>
