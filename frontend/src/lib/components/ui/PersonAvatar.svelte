<script lang="ts" module>
	// Per session: photos already shown appear at once on remount; photos that failed are not
	// requested again.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Session cache, not state.
	const shown = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Session cache, not state.
	const failedPhotos = new Set<string>();

	// A stable hue from the name, so a person keeps the same colour everywhere with nothing
	// stored. Shared so a profile can tint its cover to match the avatar.
	export function avatarHue(name: string): number {
		let hash = 0;
		for (const char of name.trim().toLocaleLowerCase())
			hash = (Math.imul(hash, 31) + char.codePointAt(0)!) | 0;
		return Math.abs(hash) % 360;
	}
</script>

<script lang="ts">
	let {
		name,
		size = 32,
		photo = null
	}: {
		name: string;
		size?: number;
		// Their X photo, when they have one. The monogram stays underneath: it shows while the
		// photo loads and whenever there turns out to be none.
		photo?: string | null;
	} = $props();
	let loaded = $state(false),
		instant = $state(false),
		failed = $state(false);
	$effect.pre(() => {
		loaded = instant = !!photo && shown.has(photo);
		failed = !!photo && failedPhotos.has(photo);
	});
	function settle() {
		if (!photo) return;
		shown.add(photo);
		loaded = true;
	}
	// A cached image can finish before its load handler is attached.
	const cached = (image: HTMLImageElement) => {
		if (image.complete && image.naturalWidth) {
			instant = true;
			settle();
		}
	};
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
	// The theme turns the hue into a pastel: pale tint on paper, muted tint at night.
	const hue = $derived(avatarHue(name));
</script>

<span
	class="person-avatar"
	style:--avatar-size={`${size}px`}
	style:--avatar-hue={hue}
	aria-hidden="true"
	>{initials}{#if photo && !failed}<img
			src={photo}
			alt=""
			decoding="async"
			class={{ loaded, instant }}
			{@attach cached}
			onload={settle}
			onerror={() => {
				if (photo) failedPhotos.add(photo);
				failed = true;
			}}
		/>{/if}</span
>
