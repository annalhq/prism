<script lang="ts">
	let {
		name,
		size = 32,
		handle = null
	}: { name: string; size?: number; handle?: string | null } = $props();
	// Two letters at most: first and last word, so "Ada King Lovelace" reads "AL".
	const initials = $derived.by(() => {
		const words = name.trim().split(/\s+/).filter(Boolean);
		const letters = words.length > 1 ? [words[0], words.at(-1)!] : words;
		return (
			letters
				.map((word) => [...word][0] ?? '')
				.join('')
				.toLocaleUpperCase() || '?'
		);
	});
	// A person with an X username shows their real profile picture. `fallback=false` makes
	// unavatar answer 404 for unknown accounts, so the monogram takes over instead of a
	// generic placeholder; a rate limit or network error falls back the same way.
	let failed = $state<string | null>(null),
		loaded = $state<string | null>(null);
	const photo = $derived(
		handle && failed !== handle
			? `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false`
			: null
	);
</script>

<span
	class="person-avatar"
	class:has-photo={!!photo && loaded === handle}
	style:--avatar-size={`${size}px`}
	aria-hidden="true"
>
	<span class="person-initials">{initials}</span>
	{#if photo}<img
			src={photo}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
			onload={() => (loaded = handle)}
			onerror={() => (failed = handle)}
		/>{/if}
</span>
