<script lang="ts">
	let { url }: { url: string | null } = $props();
	let failed = $state(false);
	const origin = $derived.by(() => {
		try {
			const parsed = new URL(url ?? '');
			return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : null;
		} catch {
			return null;
		}
	});
	const letter = $derived(
		origin
			? new URL(origin).hostname
					.replace(/^www\./, '')
					.slice(0, 1)
					.toUpperCase()
			: 'B'
	);
	$effect(() => {
		void origin;
		failed = false;
	});
</script>

<span class="favicon" aria-hidden="true">
	{#if origin && !failed}
		<img
			src={`${origin}/favicon.ico`}
			alt=""
			width="20"
			height="20"
			loading="lazy"
			referrerpolicy="no-referrer"
			onerror={() => (failed = true)}
		/>
	{:else}{letter}{/if}
</span>
