<script lang="ts">
	import { asset } from '$app/paths';
	import { AVATAR_LAYERS, avatarFromSeed, parseAvatar } from '#lib/domain/avatars.js';
	let { id, config = null, size = 48 }: { id: string; config?: unknown; size?: number } = $props();
	const avatar = $derived.by(() => {
		try {
			return parseAvatar(config) ?? avatarFromSeed(id);
		} catch {
			return avatarFromSeed(id);
		}
	});
</script>

<svg
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
</svg>
