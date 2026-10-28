<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { setTheme, themePreference } from '#lib/client/theme.svelte.js';
	let { class: className = '' }: { class?: string } = $props();
	const light = $derived(themePreference.value === 'light');
</script>

<button
	class="icon-button {className}"
	aria-label={light ? 'Use dark appearance' : 'Use light appearance'}
	onclick={() => setTheme(light ? 'dark' : 'light')}
	>{#if light}<Moon />{:else}<Sun />{/if}</button
>
