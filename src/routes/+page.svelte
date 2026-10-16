<script lang="ts">
	import LibraryWorkspace from '#lib/components/LibraryWorkspace.svelte';
	import AuthScreen from '#lib/components/AuthScreen.svelte';
	let { data } = $props();
	let offline = $state(false);
</script>

<svelte:head>
	<title>Prism - Your knowledge, connected</title>
	<meta name="description" content="A personal space for saved content, people and connections." />
</svelte:head>

{#if data.signedIn || offline}<LibraryWorkspace openOffline={offline} />{:else}<AuthScreen
		{data}
		openOffline={() => (offline = true)}
	/>{/if}
