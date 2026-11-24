<script lang="ts">
	import { Layers, Plus } from '@lucide/svelte';
	import { stickers } from '#lib/client/stickers.svelte.js';
	import Sticker from '../../ui/Sticker.svelte';

	type Row = Record<string, unknown>;
	let {
		space,
		onEditSpace,
		onCreate
	}: {
		space: Row;
		onEditSpace?: (space: Row) => void;
		onCreate?: () => void;
	} = $props();
	const sticker = $derived(typeof space.icon === 'string' ? stickers.get(space.icon) : undefined);
</script>

<div class="space-empty">
	<span class="space-empty-art" aria-hidden="true"
		>{#if sticker}<Sticker {sticker} size={44} />{:else}<Layers />{/if}</span
	>
	<p>Nothing in <strong>{space.name}</strong> yet.</p>
	{#if onEditSpace || onCreate}<div class="space-empty-actions">
			{#if onEditSpace}<button class="primary-button" onclick={() => onEditSpace(space)}
					>Choose tags & folders</button
				>{/if}
			{#if onCreate}<button class="secondary-button" onclick={onCreate}
					><Plus /><span>New tag here</span></button
				>{/if}
		</div>{/if}
</div>

<style>
	.space-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 40px 16px 24px;
		color: var(--secondary);
		font-size: var(--text-md);
		text-align: center;
		text-wrap: balance;
	}
	.space-empty strong {
		color: var(--ink);
		font-weight: 500;
	}
	.space-empty-art {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: var(--field);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--tertiary);
		animation: empty-art-in 420ms var(--ease-spring) both;
	}
	.space-empty-art :global(svg:not(.sticker)) {
		width: 28px;
		height: 28px;
	}
	@keyframes empty-art-in {
		from {
			opacity: 0;
			scale: 0.85;
		}
	}
	.space-empty-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(280px, 100%);
		margin-top: 4px;
	}
	.space-empty-actions button {
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: scale 200ms var(--ease-spring);
	}
	.space-empty-actions button:active {
		scale: 0.97;
		transition-duration: 80ms;
	}
	.space-empty-actions :global(svg) {
		width: 16px;
		height: 16px;
	}
	@media (prefers-reduced-motion: reduce) {
		.space-empty-art {
			animation: none;
		}
	}
</style>
