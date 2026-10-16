<script lang="ts">
	import { resolve } from '$app/paths';
	import IconIntersectThreeFill from 'phosphor-icons-svelte/IconIntersectThreeFill.svelte';
	let { auth = false }: { auth?: boolean } = $props();
</script>

<a class="brand" class:auth-brand={auth} href={resolve('/')} aria-label="Prism home">
	<span class="brand-symbol"><IconIntersectThreeFill /></span><span
		>prism<span class="brand-period">.</span></span
	>
</a>
