<script lang="ts">
	import { page } from '$app/state';
	import AuthScreen from '#lib/components/AuthScreen.svelte';
	import LibraryWorkspace from '#lib/components/LibraryWorkspace.svelte';
	let { data } = $props();
	let offline = $state(false);
</script>

<svelte:head><title>Person · Prism</title></svelte:head>
{#if data.signedIn || offline}<LibraryWorkspace
		personSlug={page.params.slug}
		openOffline={offline}
		identity={data.identity}
	/>{:else}<AuthScreen {data} openOffline={() => (offline = true)} />{/if}
