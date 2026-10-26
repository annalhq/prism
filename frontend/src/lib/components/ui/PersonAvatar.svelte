<script lang="ts">
	import { asset } from '$app/paths';
	import { AVATAR_LAYERS, avatarFromSeed, parseAvatar } from '#lib/domain/avatars.js';
	let {
		id,
		config = null,
		size = 48,
		handle = null
	}: { id: string; config?: unknown; size?: number; handle?: string | null } = $props();
	const avatar = $derived.by(() => {
		try {
			return parseAvatar(config) ?? avatarFromSeed(id);
		} catch {
			return avatarFromSeed(id);
		}
	});
	// A person with an X username shows their real profile picture. `fallback=false` makes
	// unavatar answer 404 for unknown accounts, so the drawn avatar takes over instead of a
	// generic placeholder; a rate limit or network error falls back the same way.
	let failed = $state<string | null>(null);
	const photo = $derived(
		handle && failed !== handle
			? `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false`
			: null
	);
</script>

{#if photo}<img
		class="person-avatar person-photo"
		src={photo}
		alt=""
		width={size}
		height={size}
		style:width={`${size}px`}
		style:height={`${size}px`}
		loading="lazy"
		decoding="async"
		referrerpolicy="no-referrer"
		onerror={() => (failed = handle)}
	/>{:else}<svg
		class="person-avatar"
		style:width={`${size}px`}
		style:height={`${size}px`}
		width={size}
		height={size}
		viewBox="0 0 1080 1080"
		aria-hidden="true"
	>
		{#each AVATAR_LAYERS as part (part)}<use
				href={`${asset('avatars/parts.svg')}#${part}-${avatar.parts[part]}`}
				width="1080"
				height="1080"
			/>{/each}
	</svg>{/if}
