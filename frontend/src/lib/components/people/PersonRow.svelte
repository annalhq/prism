<script lang="ts">
	import PersonAvatar from '../ui/PersonAvatar.svelte';
	type Row = Record<string, unknown>;
	let {
		person,
		handle = null,
		photo = null,
		count,
		onOpen
	}: {
		person: Row;
		handle?: string | null;
		photo?: string | null;
		count: number;
		onOpen: () => void;
	} = $props();
	const name = $derived(String(person.displayName));
	const about = $derived(String(person.bio || ''));
</script>

<!-- `person-card` is the row the list keyboard moves between. -->
<button class="person-card person-row" onclick={onOpen}>
	<PersonAvatar {name} {photo} size={36} />
	<span class="person-row-copy">
		<span class="person-row-name"
			><strong>{name}</strong>{#if handle}<span>@{handle}</span>{/if}</span
		>{#if about}<small>{about}</small>{/if}
	</span>
	{#if count}<span class="person-row-count" title={`${count} ${count === 1 ? 'link' : 'links'}`}
			>{count}</span
		>{/if}
</button>
