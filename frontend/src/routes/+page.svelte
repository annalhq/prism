<script lang="ts">
	import LibraryWorkspace from '#lib/components/LibraryWorkspace.svelte';
	import Landing from '#lib/components/Landing.svelte';
	let { data } = $props();
	let offline = $state(false);
</script>

<svelte:head>
	<title>Prism</title>
	<meta name="description" content="digital silo for bookmarks" />
</svelte:head>

{#if data.signedIn || offline}<LibraryWorkspace
		openOffline={offline}
		identity={data.identity}
	/>{:else}<Landing openOffline={() => (offline = true)} />{/if}
