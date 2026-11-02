<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import GrainSplit from './GrainSplit.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- The landing page's layout carries on: the form in a glass card over the grain. -->
<GrainSplit id="auth-main">
	<div class="grain-card-head">
		<a class="auth-back" href={resolve('/')}><ArrowLeft />Back</a>
	</div>
	<div class="grain-card-body">{@render children()}</div>
</GrainSplit>
