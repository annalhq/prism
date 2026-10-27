<script lang="ts">
	import { X as XIcon } from '@lucide/svelte';
	import { Combobox } from 'bits-ui';
	import { tick, type Snippet } from 'svelte';
	import { tagNames } from '#lib/client/workflows.js';
	export type TokenOption = { value: string; label: string; detail?: string; search?: string };
	let {
		items,
		selected = [],
		label,
		placeholder = 'Type to search…',
		allowCreate = false,
		showSelected = true,
		onAdd,
		onRemove,
		glyph
	}: {
		items: TokenOption[];
		selected?: string[];
		label: string;
		placeholder?: string;
		allowCreate?: boolean;
		showSelected?: boolean;
		onAdd: (value: string, create: boolean) => void | Promise<void>;
		onRemove?: (value: string) => void | Promise<void>;
		// Drawn before each chip and suggestion: a # for tags, an avatar for people.
		glyph?: Snippet<[TokenOption]>;
	} = $props();
	const byValue = $derived(new Map(items.map((item) => [item.value, item])));
	let query = $state(''),
		selection = $state<string[]>([]),
		open = $state(false),
		error = $state('');
	let chain = Promise.resolve();
	let input = $state<HTMLInputElement | null>(null);
	function clearInput(focus = true, suffix = '') {
		query = suffix;
		selection = [];
		open = focus;
		void tick().then(() => {
			if (input) input.value = suffix;
			if (focus) input?.focus({ preventScroll: true });
		});
	}
	const matches = $derived(
		items
			.filter(
				(i) =>
					!selected.includes(i.value) &&
					`${i.label} ${i.detail ?? ''} ${i.search ?? ''}`
						.toLocaleLowerCase()
						.includes(query.replace(/^#/, '').toLocaleLowerCase())
			)
			.slice(0, 8)
	);
	const canCreate = $derived(
		allowCreate &&
			!!query.trim().replace(/^#/, '') &&
			!items.some(
				(i) => i.label.toLocaleLowerCase() === query.trim().replace(/^#/, '').toLocaleLowerCase()
			)
	);
	function enqueue(value: string, create = false) {
		error = '';
		chain = chain
			.then(() => onAdd(value, create))
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
				if (!query) query = create ? value : (items.find((i) => i.value === value)?.label ?? '');
			});
	}
	function pick(value: string) {
		if (!value) return;
		const create = value.startsWith('new:');
		enqueue(create ? value.slice(4) : value, create);
		clearInput();
	}
	function commit(text: string) {
		if (!allowCreate || !text.trim()) return;
		try {
			for (const name of tagNames(text)) {
				const found = items.find((i) => i.label.toLocaleLowerCase() === name.toLocaleLowerCase());
				if (!found || !selected.includes(found.value)) enqueue(found?.value ?? name, !found);
			}
		} catch (e) {
			error = (e as Error).message;
		}
	}
</script>

<div class="token-editor">
	<div class="token-field">
		{#each showSelected ? selected : [] as value (value)}{@const item = byValue.get(value)}<span
				class="token-chip"
				>{#if item && glyph}{@render glyph(item)}{/if}<span>{item?.label ?? 'Unavailable'}</span
				>{#if onRemove}<button
						type="button"
						aria-label={`Remove ${item?.label ?? 'item'}`}
						onclick={() => {
							chain = chain
								.then(() => onRemove?.(value))
								.catch((e) => {
									error = e.message;
								});
						}}><XIcon /></button
					>{/if}</span
			>{/each}
		<Combobox.Root
			type="multiple"
			bind:value={selection}
			bind:open
			inputValue={query}
			onValueChange={(values) => {
				const value = values.at(-1);
				if (value) pick(value);
			}}
		>
			<Combobox.Input
				bind:ref={input}
				aria-label={label}
				class="token-search"
				{placeholder}
				clearOnDeselect
				oninput={(e) => {
					const text = e.currentTarget.value;
					if (allowCreate && text.includes(',')) {
						const parts = text.split(',');
						const suffix = parts.pop() ?? '';
						commit(parts.join(','));
						clearInput(true, suffix);
					} else query = text;
					open = !!query;
				}}
				onkeydown={(e) => {
					if (e.isComposing) return;
					if (
						e.key === 'Enter' &&
						query.trim() &&
						allowCreate &&
						!e.currentTarget.getAttribute('aria-activedescendant')
					) {
						e.preventDefault();
						commit(query);
						clearInput();
					}
				}}
				onblur={(e) => {
					const next = e.relatedTarget as HTMLElement | null;
					if (allowCreate && !next?.closest('[role="listbox"]')) {
						commit(query);
						clearInput(false);
					}
				}}
			/>
			<Combobox.Portal
				><Combobox.Content class="select-content token-suggestions" sideOffset={5}
					><Combobox.Viewport>
						{#each matches as item (item.value)}<Combobox.Item
								value={item.value}
								label={item.label}
								class="select-item"
								>{#if glyph}{@render glyph(item)}{/if}<span
									>{item.label}{#if item.detail}<small>{item.detail}</small>{/if}</span
								></Combobox.Item
							>{/each}
						{#if canCreate}<Combobox.Item
								value={`new:${query.trim().replace(/^#/, '')}`}
								label={query.trim()}
								class="select-item"
								><span>Create #{query.trim().replace(/^#/, '')}</span></Combobox.Item
							>{:else if !matches.length}<p class="picker-empty">
								No matches. Try another title or name.
							</p>{/if}
					</Combobox.Viewport></Combobox.Content
				></Combobox.Portal
			>
		</Combobox.Root>
	</div>
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
