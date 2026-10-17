<script lang="ts">
	import { Layers3 as Layers3Icon } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	let { auth = false, compact = false }: { auth?: boolean; compact?: boolean } = $props();
</script>

<a
	class="brand"
	class:auth-brand={auth}
	class:compact-brand={compact}
	href={resolve('/')}
	aria-label="Prism home"
>
	<span class="brand-symbol"><Layers3Icon /></span>{#if !compact}<span>prism</span>{/if}
</a>
