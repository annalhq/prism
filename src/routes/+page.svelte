<script lang="ts">
	import LibraryWorkspace from '#lib/components/LibraryWorkspace.svelte';
	import AuthScreen from '#lib/components/AuthScreen.svelte';
	let { data } = $props();
	let offline = $state(false);
</script>

<svelte:head>
	<title>Prism/title>
	<meta name="description" content="digital silo for bookmarks" />
</svelte:head>

{#if data.signedIn || offline}<LibraryWorkspace
		openOffline={offline}
		identity={data.identity}
	/>{:else}<AuthScreen {data} openOffline={() => (offline = true)} />{/if}
