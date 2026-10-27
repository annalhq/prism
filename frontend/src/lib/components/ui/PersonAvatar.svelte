<script lang="ts">
	let { name, size = 32 }: { name: string; size?: number } = $props();
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
	// A stable hue from the name, so a person keeps the same colour everywhere with nothing
	// stored. The theme turns it into a pastel: pale tint on paper, muted tint at night.
	const hue = $derived.by(() => {
		let hash = 0;
		for (const char of name.trim().toLocaleLowerCase())
			hash = (Math.imul(hash, 31) + char.codePointAt(0)!) | 0;
		return Math.abs(hash) % 360;
	});
</script>

<span
	class="person-avatar"
	style:--avatar-size={`${size}px`}
	style:--avatar-hue={hue}
	aria-hidden="true">{initials}</span
>
