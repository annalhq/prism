<script lang="ts">
	import { postTime } from '#lib/client/workflows.js';
	import PersonAvatar from '../ui/PersonAvatar.svelte';
	type Row = Record<string, unknown>;
	let {
		person,
		handle = null,
		count,
		lastAdded = '',
		onOpen
	}: {
		person: Row;
		handle?: string | null;
		count: number;
		lastAdded?: string;
		onOpen: () => void;
	} = $props();
	const name = $derived(String(person.displayName));
	const about = $derived(String(person.bio || ''));
</script>

<!-- `person-card` is the row the list keyboard moves between. -->
<button class="person-card person-row" onclick={onOpen}>
	<PersonAvatar {name} {handle} size={36} />
	<span class="person-row-copy">
		<span class="person-row-name"
			><strong>{name}</strong>{#if handle}<span>@{handle}</span>{/if}</span
		>{#if about}<small>{about}</small>{/if}
	</span>
	<span class="person-row-meta"
		>{#if count}<span>{count}</span>{/if}{#if lastAdded}<time>{postTime(lastAdded)}</time
			>{/if}</span
	>
</button>
