<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { tick } from 'svelte';
	import type { Row } from '#lib/client/workflows.js';
	let {
		open = $bindable(false),
		count,
		tags,
		counts = {},
		sourceId = null,
		onPick,
		onCreate
	}: {
		open?: boolean;
		count: number;
		tags: Row[];
		counts?: Record<string, number>;
		// The tag page the bookmarks are cut from; moving takes it off, so it is not a destination.
		sourceId?: string | null;
		onPick: (tagId: string) => void;
		onCreate: (name: string) => void;
	} = $props();
	let query = $state(''),
		active = $state(0),
		list: HTMLElement | undefined = $state();
	const needle = $derived(query.trim().toLowerCase().replace(/^#/, ''));
	// Names that start with what was typed come first; otherwise the sidebar's own order.
	const matches = $derived.by(() => {
		const all = tags.filter((t) => t.id !== sourceId);
		if (!needle) return all;
		const name = (t: Row) => String(t.name).toLowerCase();
		return [
			...all.filter((t) => name(t).startsWith(needle)),
			...all.filter((t) => !name(t).startsWith(needle) && name(t).includes(needle))
		];
	});
	const creatable = $derived(
		!!needle && needle.length <= 64 && !tags.some((t) => String(t.name).toLowerCase() === needle)
	);
	const total = $derived(matches.length + (creatable ? 1 : 0));
	const verb = $derived(sourceId ? 'Move' : 'Add');
	const noun = $derived(count === 1 ? 'bookmark' : `${count} bookmarks`);
	$effect(() => {
		void needle;
		active = 0;
	});
	$effect(() => {
		if (!open) query = '';
	});
	$effect(() => {
		void active;
		void tick().then(() =>
			list?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' })
		);
	});
	function choose(index = active) {
		if (index < matches.length) onPick(String(matches[index].id));
		else if (creatable) onCreate(query.trim().replace(/^#/, ''));
		else return;
		open = false;
	}
	function keydown(event: KeyboardEvent) {
		const step =
			event.key === 'ArrowDown' || (event.ctrlKey && ['n', 'j'].includes(event.key))
				? 1
				: event.key === 'ArrowUp' || (event.ctrlKey && ['p', 'k'].includes(event.key))
					? -1
					: 0;
		if (step && total) {
			event.preventDefault();
			active = (active + step + total) % total;
		} else if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			choose();
		}
	}
</script>

<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay move-overlay" /><Dialog.Content
			class="menu-content move-palette"
		>
			<Dialog.Title class="menu-header move-palette-title">{verb} {noun} to…</Dialog.Title>
			<Dialog.Description class="sr-only"
				>Type to find a tag, or a new name to create one. Enter chooses, Escape cancels.</Dialog.Description
			>
			<label class="move-palette-field">
				<span class="move-hash" aria-hidden="true">#</span>
				<input
					bind:value={query}
					onkeydown={keydown}
					placeholder="Find or create a tag"
					autocomplete="off"
					spellcheck="false"
					role="combobox"
					aria-expanded="true"
					aria-controls="move-palette-options"
					aria-activedescendant={total ? `move-option-${active}` : undefined}
				/>
			</label>
			<div class="move-palette-list" id="move-palette-options" role="listbox" bind:this={list}>
				{#each matches as tag, i (tag.id)}
					<div
						id={`move-option-${i}`}
						role="option"
						tabindex="-1"
						aria-selected={i === active}
						class="menu-item"
						data-highlighted={i === active ? '' : undefined}
						onpointermove={() => (active = i)}
						onclick={() => choose(i)}
						onkeydown={() => {}}
					>
						<span class="move-hash" aria-hidden="true">#</span><span>{tag.name}</span
						>{#if counts[String(tag.id)]}<kbd>{counts[String(tag.id)]}</kbd>{/if}
					</div>
				{/each}
				{#if creatable}<div
						id={`move-option-${matches.length}`}
						role="option"
						tabindex="-1"
						aria-selected={active === matches.length}
						class="menu-item move-create"
						data-highlighted={active === matches.length ? '' : undefined}
						onpointermove={() => (active = matches.length)}
						onclick={() => choose(matches.length)}
						onkeydown={() => {}}
					>
						<span class="move-hash" aria-hidden="true">+</span><span
							>Create <strong>#{query.trim().replace(/^#/, '')}</strong></span
						>
					</div>{/if}
				{#if !total}<p class="move-palette-empty">
						{tags.length ? 'No tag matches.' : 'No tags yet. Type a name to create one.'}
					</p>{/if}
			</div>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
