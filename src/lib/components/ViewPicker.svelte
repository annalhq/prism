<script lang="ts">
	import { Popover } from 'bits-ui';
	import { tick } from 'svelte';
	import {
		Search,
		ChevronDown,
		Check,
		Hash,
		Folder,
		Bookmark,
		Clock3,
		Pin,
		Users,
		Archive,
		Trash2
	} from '@lucide/svelte';
	type Row = Record<string, unknown>;
	let {
		title,
		view,
		tags,
		collections,
		saved,
		onSelect
	}: {
		title: unknown;
		view: string;
		tags: Row[];
		collections: Row[];
		saved: Row[];
		onSelect: (view: string) => void;
	} = $props();
	let open = $state(false),
		query = $state(''),
		active = $state(0);
	let input = $state<HTMLInputElement>();
	const id = $props.id();
	const options = $derived([
		{ value: 'all', label: 'All bookmarks', group: 'Library', icon: Bookmark },
		{ value: 'later', label: 'Read later', group: 'Library', icon: Clock3 },
		{ value: 'pinned', label: 'Pinned', group: 'Library', icon: Pin },
		{ value: 'people', label: 'People', group: 'Library', icon: Users },
		{ value: 'archive', label: 'Archive', group: 'Library', icon: Archive },
		{ value: 'trash', label: 'Trash', group: 'Library', icon: Trash2 },
		...tags.map((t) => ({ value: `tag:${t.id}`, label: String(t.name), group: 'Tag', icon: Hash })),
		...collections.map((t) => ({
			value: `collection:${t.id}`,
			label: String(t.name),
			group: 'Collection',
			icon: Folder
		})),
		...saved.map((t) => ({
			value: `saved:${t.id}`,
			label: String(t.name),
			group: 'Saved search',
			icon: Search
		}))
	]);
	const matches = $derived(
		options.filter((o) =>
			`${o.label} ${o.group}`
				.toLocaleLowerCase()
				.includes(query.replace(/^#/, '').trim().toLocaleLowerCase())
		)
	);
	const visible = $derived(matches.slice(0, 40));
	$effect(() => {
		if (!open) {
			query = '';
			active = 0;
		}
	});
	export function show() {
		open = true;
	}
	function select(value: string) {
		open = false;
		onSelect(value);
	}
	async function move(direction: number) {
		active = Math.max(0, Math.min(visible.length - 1, active + direction));
		await tick();
		document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger class="view-switch" aria-label="Choose library view"
		><span class="view-dot" aria-hidden="true"></span><span>{title}</span><ChevronDown
		/></Popover.Trigger
	>
	<Popover.Portal
		><Popover.Content
			class="view-picker"
			sideOffset={10}
			align="start"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				input?.focus();
			}}
		>
			<div class="filter-search">
				<Search /><input
					bind:this={input}
					role="combobox"
					aria-label="Search views, tags and collections"
					aria-expanded={open}
					aria-controls={`${id}-options`}
					aria-autocomplete="list"
					aria-activedescendant={visible[active] ? `${id}-option-${active}` : undefined}
					placeholder="Find a view, tag or collection…"
					bind:value={query}
					oninput={() => (active = 0)}
					onkeydown={(event) => {
						if (event.isComposing) return;
						if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
							event.preventDefault();
							void move(1);
						}
						if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
							event.preventDefault();
							void move(-1);
						}
						if (event.key === 'Enter' && visible[active]) {
							event.preventDefault();
							select(visible[active].value);
						}
					}}
				/>
			</div>
			<div id={`${id}-options`} role="listbox" aria-label="Library views" class="filter-results">
				{#each visible as option, index (option.value)}<button
						id={`${id}-option-${index}`}
						role="option"
						aria-selected={view === option.value}
						tabindex="-1"
						class="filter-option"
						class:highlighted={active === index}
						onpointermove={() => (active = index)}
						onclick={() => select(option.value)}
						><option.icon /><span>{option.label}</span><small>{option.group}</small
						>{#if view === option.value}<Check class="filter-check" />{/if}</button
					>{/each}
			</div>
			{#if !visible.length}<p class="picker-empty">No matches. Try a different name.</p>{/if}
			<div class="filter-footer">
				<span
					>{matches.length > 40
						? `40 of ${matches.length} · type to narrow`
						: `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`}</span
				><span><kbd>↑</kbd><kbd>↓</kbd> <kbd>↵</kbd></span>
			</div>
		</Popover.Content></Popover.Portal
	>
</Popover.Root>
