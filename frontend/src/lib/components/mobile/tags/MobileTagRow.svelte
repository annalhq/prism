<script lang="ts">
	import { ChevronRight, Hash } from '@lucide/svelte';

	type Row = Record<string, unknown>;
	// `where` labels the tag's folder (and space, in search results).
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
