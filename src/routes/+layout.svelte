<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initializeSounds } from '#lib/client/sounds.svelte.js';
	onMount(initializeSounds);
	let { children } = $props();
</script>

{@render children()}
