<script lang="ts">
	import AuthScreen from '#lib/components/AuthScreen.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Sign in · Prism</title></svelte:head>
<AuthScreen {data} {form} />
