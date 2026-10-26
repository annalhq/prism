<script lang="ts">
	import PublicLibrary from '#lib/components/PublicLibrary.svelte';
	let { data } = $props();
</script>

<svelte:head>
	<meta name="description" content="A read-only view of a Prism bookmark library" />
</svelte:head>

<PublicLibrary snapshot={data.snapshot} />
