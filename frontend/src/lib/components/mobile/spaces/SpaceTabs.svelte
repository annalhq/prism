<script lang="ts">
	import { Ellipsis, Plus } from '@lucide/svelte';
	import { ContextMenu, DropdownMenu } from 'bits-ui';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { TransitionConfig } from 'svelte/transition';
	import { stickers } from '#lib/client/stickers.svelte.js';
	import Sticker from '../../ui/Sticker.svelte';
	import SpaceActions from './SpaceActions.svelte';

	type Row = Record<string, unknown>;
	// Mobile space switcher. Tap to switch; long-press a tab or use ⋯ for actions.
	let {
		spaces,
		current,
		defaultId,
		panelId,
		hidden = false,
		onSelect,
		onEditSpace,
		onSetDefault,
		onReorderSpace
	}: {
		spaces: Row[];
		current: string;
		defaultId: string;
		panelId: string;
		// Collapses the bar while searching.
		hidden?: boolean;
		onSelect: (id: string) => void;
		onEditSpace?: (space: Row | null, intent?: 'delete') => void;
		onSetDefault?: (id: string) => void;
		onReorderSpace?: (id: string, toIndex: number) => void;
	} = $props();

	const currentIndex = $derived(spaces.findIndex((s) => String(s.id) === current));
	const currentSpace = $derived(spaces[currentIndex]);
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);

	// Positions the pill and centres the active tab. Resizes only reposition the pill.
	function strip(id: string, order: string): Attachment<HTMLElement> {
		return (bar) => {
			void order;
			const place = (centre: boolean) => {
				const tab = bar.querySelector<HTMLElement>(`[data-space-id="${CSS.escape(id)}"]`);
				if (!tab?.offsetWidth) {
					bar.dataset.pill = 'off';
					return;
				}
				bar.style.setProperty('--pill-x', `${tab.offsetLeft}px`);
				bar.style.setProperty('--pill-w', `${tab.offsetWidth}px`);
				// Skip the transition on first placement.
				if (bar.dataset.pill !== 'on') {
					bar.dataset.pill = 'placing';
					requestAnimationFrame(() => (bar.dataset.pill = 'on'));
				}
				if (centre)
					bar.scrollTo({
						left: Math.max(0, tab.offsetLeft + tab.offsetWidth / 2 - bar.clientWidth / 2),
						behavior: motion ? 'smooth' : 'instant'
					});
			};
			const edges = () => {
				bar.toggleAttribute('data-more-start', bar.scrollLeft > 2);
				bar.toggleAttribute(
					'data-more-end',
					bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2
				);
			};
			place(true);
			edges();
			const observer = new ResizeObserver(() => {
				place(false);
				edges();
			});
			observer.observe(bar);
			for (const tab of bar.querySelectorAll('.space-chip')) observer.observe(tab);
			bar.addEventListener('scroll', edges, { passive: true });
			return () => {
				observer.disconnect();
				bar.removeEventListener('scroll', edges);
			};
		};
	}

	async function keys(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const next = spaces[currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)];
		if (!next) return;
		onSelect(String(next.id));
		await tick();
		(event.currentTarget as HTMLElement | null)
			?.querySelector<HTMLElement>('.space-chip[aria-selected="true"]')
			?.focus();
	}

	function fold(node: HTMLElement): TransitionConfig {
		const width = node.offsetWidth;
		return {
			duration: 200 * motion,
			css: (t) =>
				`opacity: ${t}; transform: scale(${0.8 + 0.2 * t}); max-width: ${width * t}px; overflow: hidden`
		};
	}
	function pop(node: Element): TransitionConfig {
		(node as HTMLElement).style.transformOrigin = 'center';
		return {
			duration: 280 * motion,
			easing: (t) => (t === 1 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(7 * t)),
			css: (t) => `opacity: ${Math.min(1, t * 2)}; transform: scale(${0.8 + 0.2 * t})`
		};
	}
	// Haptic feedback on long-press (Android only).
	const buzz = (open: boolean) => {
		if (open) navigator.vibrate?.(10);
	};
</script>

<div class={['space-tabs', hidden && 'folded']} inert={hidden}>
	<div
		class="space-strip"
		role="tablist"
		aria-label="Spaces"
		tabindex="-1"
		onkeydown={keys}
		{@attach strip(current, spaces.map((s) => String(s.id)).join())}
	>
		<span class="space-pill" aria-hidden="true"></span>
		{#each spaces as space, index (String(space.id))}
			{@const id = String(space.id)}
			{@const selected = id === current}
			{@const sticker = typeof space.icon === 'string' ? stickers.get(space.icon) : undefined}
			<div
				class="space-cell"
				role="presentation"
				animate:flip={{ duration: 240 * motion }}
				in:pop
				out:fold
			>
				{#snippet chip()}<button
						class={['space-chip', selected && 'active', sticker && 'has-icon']}
						role="tab"
						aria-selected={selected}
						aria-controls={panelId}
						tabindex={selected ? 0 : -1}
						data-space-id={id}
						onclick={() => onSelect(id)}
						>{#if sticker}<span class="space-chip-icon"><Sticker {sticker} /></span>{/if}<span
							class="space-chip-name">{space.name}</span
						></button
					>{/snippet}
				{#if onEditSpace}<ContextMenu.Root onOpenChange={buzz}
						><ContextMenu.Trigger class="space-chip-slot">{@render chip()}</ContextMenu.Trigger
						><ContextMenu.Portal
							><ContextMenu.Content class="menu-content" collisionPadding={12}>
								<SpaceActions
									Menu={ContextMenu}
									{space}
									{index}
									count={spaces.length}
									isDefault={id === defaultId}
									{onEditSpace}
									{onSetDefault}
									{onReorderSpace}
								/>
							</ContextMenu.Content></ContextMenu.Portal
						></ContextMenu.Root
					>{:else}{@render chip()}{/if}
			</div>
		{/each}
	</div>
	{#if onEditSpace}<DropdownMenu.Root
			><DropdownMenu.Trigger class="icon-button space-more" aria-label="Space actions"
				><Ellipsis /></DropdownMenu.Trigger
			><DropdownMenu.Portal
				><DropdownMenu.Content
					class="menu-content"
					align="end"
					sideOffset={6}
					collisionPadding={12}
				>
					<DropdownMenu.Item class="menu-item" onSelect={() => onEditSpace(null)}
						><Plus /><span>New space</span></DropdownMenu.Item
					>
					{#if currentSpace}<DropdownMenu.Separator class="menu-separator" /><DropdownMenu.Group
							><DropdownMenu.GroupHeading class="space-menu-heading"
								>{currentSpace.name}{#if current === defaultId}<span>
										· Default</span
									>{/if}</DropdownMenu.GroupHeading
							><SpaceActions
								Menu={DropdownMenu}
								space={currentSpace}
								index={currentIndex}
								count={spaces.length}
								isDefault={current === defaultId}
								{onEditSpace}
								{onSetDefault}
								{onReorderSpace}
							/></DropdownMenu.Group
						>{/if}
				</DropdownMenu.Content></DropdownMenu.Portal
			></DropdownMenu.Root
		>{/if}
</div>

<style>
	.space-tabs {
		position: sticky;
		z-index: 2;
		top: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 -4px;
		padding: 6px 4px;
		background: var(--surface);
		transition:
			opacity 180ms ease,
			translate 260ms var(--ease-spring),
			margin-bottom 260ms var(--ease-spring);
	}
	/* Collapsed: offsets the bar height (56px) plus the parent gap (16px). */
	.space-tabs.folded {
		margin-bottom: -72px;
		opacity: 0;
		translate: 0 -8px;
		pointer-events: none;
	}
	.space-strip {
		--fade-start: 0px;
		--fade-end: 0px;
		position: relative;
		display: flex;
		flex: 1;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding: 2px;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fade-start),
			#000 calc(100% - var(--fade-end)),
			transparent
		);
	}
	.space-strip::-webkit-scrollbar {
		display: none;
	}
	.space-strip:global([data-more-start]) {
		--fade-start: 24px;
	}
	.space-strip:global([data-more-end]) {
		--fade-end: 24px;
	}
	.space-strip:focus-visible {
		outline: none;
	}
	.space-cell {
		display: flex;
		flex-shrink: 0;
	}
	:global(.space-chip-slot) {
		display: contents;
	}
	.space-chip {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 40px;
		padding: 0 16px;
		border-radius: var(--radius-pill);
		color: var(--secondary);
		font-size: var(--text-md);
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		-webkit-tap-highlight-color: transparent;
		-webkit-touch-callout: none;
		user-select: none;
		transition:
			color 160ms ease,
			scale 220ms var(--ease-spring);
	}
	.space-chip.has-icon {
		padding-left: 11px;
	}
	.space-chip:active {
		scale: 0.96;
		transition-duration: 80ms;
	}
	.space-chip.active {
		color: var(--ink);
	}
	.space-chip:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--line);
	}
	.space-chip-name {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.space-chip-icon {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 20px;
		height: 20px;
		opacity: 0.7;
		filter: saturate(0.6);
		transition:
			opacity 160ms ease,
			filter 200ms ease;
	}
	.space-chip.active .space-chip-icon {
		opacity: 1;
		filter: none;
		animation: chip-pop 280ms var(--ease-spring);
	}
	@keyframes chip-pop {
		40% {
			scale: 1.14;
		}
	}
	.space-pill {
		position: absolute;
		top: 2px;
		left: 0;
		width: var(--pill-w, 0);
		height: 40px;
		border-radius: var(--radius-pill);
		background: var(--field);
		box-shadow: var(--raised);
		opacity: 0;
		pointer-events: none;
		translate: var(--pill-x, 0) 0;
	}
	.space-strip:global([data-pill='placing']) .space-pill,
	.space-strip:global([data-pill='on']) .space-pill {
		opacity: 1;
	}
	.space-strip:global([data-pill='on']) .space-pill {
		transition:
			translate 320ms var(--ease-spring),
			width 320ms var(--ease-spring);
	}
	:global(.space-more) {
		flex-shrink: 0;
		border-radius: 50%;
		color: var(--secondary);
		-webkit-tap-highlight-color: transparent;
	}
	:global(.space-more:active) {
		background: var(--hover);
		scale: 0.94;
	}
	:global(.space-menu-heading) {
		padding: 6px 10px 4px;
		color: var(--tertiary);
		font-size: var(--text-xs);
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	@media (prefers-reduced-motion: reduce) {
		.space-tabs,
		.space-chip,
		.space-chip-icon,
		.space-strip:global([data-pill='on']) .space-pill {
			transition: none;
		}
		.space-chip.active .space-chip-icon {
			animation: none;
		}
	}
</style>
