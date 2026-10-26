<script lang="ts">
	import { resolve, asset } from '$app/paths';
	let {
		auth = false,
		compact = false,
		home = '/'
	}: { auth?: boolean; compact?: boolean; home?: '/' | '/public' } = $props();
</script>

<a
	class="brand"
	class:auth-brand={auth}
	class:compact-brand={compact}
	href={resolve(home)}
	aria-label="Prism home"
>
	<span class="brand-symbol" aria-hidden="true"
		><img src={asset('logo.svg')} alt="" width="25" height="25" /></span
	>{#if !compact}<span>prism</span>{/if}
</a>
