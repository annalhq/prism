<script lang="ts">
	import { resolve, asset } from '$app/paths';
	let { auth = false, compact = false }: { auth?: boolean; compact?: boolean } = $props();
</script>

<a
	class="brand"
	class:auth-brand={auth}
	class:compact-brand={compact}
	href={resolve('/')}
	aria-label="Prism home"
>
	<span class="brand-symbol" aria-hidden="true"
		><img src={asset('logo.svg')} alt="" width="25" height="25" /></span
	>{#if !compact}<span>prism</span>{/if}
</a>
