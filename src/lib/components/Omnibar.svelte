<script lang="ts">
	import {
		Plus as PlusIcon,
		Search as SearchIcon,
		ArrowRight as ArrowRightIcon,
		X as XIcon
	} from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { ensureTag, inferBookmarkKind, type Row } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	let {
		library,
		ready,
		tags,
		people,
		query = $bindable(''),
		personId = null,
		feedback,
		onNormal
	}: {
		library: LibraryClient | null;
		ready: boolean;
		tags: Row[];
		people: Row[];
		query?: string;
		personId?: string | null;
		feedback: (message: string) => void;
		onNormal: () => void;
	} = $props();
	let mode = $state<'insert' | 'search'>('insert');
	let draft = $state(''),
		url = $state(''),
		organizer = $state(''),
		error = $state(''),
		busy = $state(false);
	let input = $state<HTMLInputElement>(),
		picker = $state<HTMLInputElement>();
	let captureId = '';
	let created = $state(false);
	let normalRequested = false;
	const choices = $derived(
		[
			...tags.map((t) => ({ kind: 'tag' as const, id: String(t.id), name: String(t.name) })),
			...people.map((p) => ({
				kind: 'person' as const,
				id: String(p.id),
				name: String(p.displayName)
			}))
		]
			.filter((c) =>
				c.name.toLocaleLowerCase().includes(organizer.replace(/^[#@]/, '').toLocaleLowerCase())
			)
			.slice(0, 8)
	);
	const tagName = $derived(organizer.trim().replace(/^#/, ''));
	const canCreate = $derived(
		!!tagName &&
			!organizer.startsWith('@') &&
			!tags.some((t) => String(t.name).toLocaleLowerCase() === tagName.toLocaleLowerCase())
	);
	$effect(() => {
		if (query) mode = 'search';
	});
	onMount(() => {
		const key = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				document.querySelector(
					'[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'
				)
			)
				return;
			if ((event.ctrlKey || event.metaKey) && ['f', 'k'].includes(event.key.toLowerCase())) {
				event.preventDefault();
				void switchMode('search');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				normalRequested = true;
				if (busy) {
					onNormal();
					return;
				}
				if (mode === 'insert' && !created) {
					url = '';
					error = '';
				}
				void switchMode('insert', false).then(onNormal);
			} else if (
				event.key === '/' &&
				!(event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
			) {
				event.preventDefault();
				void switchMode('search');
			}
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	});
	export async function focusInsert() {
		await switchMode('insert');
	}
	async function switchMode(next: 'insert' | 'search', focus = true) {
		if (busy) return;
		if (focus) normalRequested = false;
		mode = next;
		if (next === 'insert') query = '';
		await tick();
		if (!focus) return;
		if (next === 'insert' && url) picker?.focus();
		else input?.focus();
	}
	function prepare(event: SubmitEvent) {
		event.preventDefault();
		if (mode === 'search' || busy || !ready) return;
		error = '';
		try {
			const value = draft.trim();
			url = normalizeUrl(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`).url;
			captureId = crypto.randomUUID();
			created = false;
			organizer = '';
			void tick().then(() => picker?.focus());
		} catch {
			error = 'Enter a valid website link, such as example.com/article.';
		}
	}
	async function save(choice?: { kind: 'tag' | 'person' | 'new-tag'; id: string; name: string }) {
		if (!library || busy || !ready) return;
		normalRequested = false;
		busy = true;
		error = '';
		try {
			if (!created) {
				const result = await library.save({
					type: 'bookmark.create',
					id: captureId,
					kind: inferBookmarkKind(url),
					title: url
						.replace(/^https?:\/\/(www\.)?/, '')
						.replace(/\/$/, '')
						.slice(0, 500),
					url
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not save this link.');
				if (result.status === 'already_exists')
					throw new Error(
						'This link is already in your library. Search for it to edit its tags and people.'
					);
				created = true;
			}
			if (choice?.kind === 'tag' || choice?.kind === 'new-tag') {
				const tagId = choice.kind === 'new-tag' ? await ensureTag(library, choice.name) : choice.id;
				const result = await library.save({ type: 'tag.add', id: captureId, tagId });
				if (result.status === 'rejected')
					throw new Error(
						result.message ?? 'Link saved, but the tag could not be added. Try again.'
					);
			}
			for (const id of new Set(
				[personId, choice?.kind === 'person' ? choice.id : null].filter((id): id is string => !!id)
			)) {
				const result = await library.save({
					type: 'content-person.add',
					bookmarkId: captureId,
					personId: id,
					role: 'related',
					provenance: 'manual'
				});
				if (result.status === 'rejected')
					throw new Error(
						result.message ?? 'Link saved, but the person could not be connected. Try again.'
					);
			}
			feedback(
				`${library.state.online ? 'Saved' : 'Saved on this device'}${choice ? ` · ${choice.name}` : ''}.`
			);
			draft = '';
			url = '';
			organizer = '';
			created = false;
			await tick();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
			await tick();
			if (normalRequested) onNormal();
			else if (!url) input?.focus();
		}
	}
</script>

<section class="omnibar-section" aria-label="Omnibar">
	<form class="omnibar" class:search-mode={mode === 'search'} onsubmit={prepare}>
		<button
			type="button"
			class="omnibar-mode"
			aria-label={mode === 'search' ? 'Switch to insert mode' : 'Switch to search mode'}
			title={mode === 'search' ? 'Insert mode · Esc' : 'Search mode · Ctrl / ⌘ F'}
			onclick={() => switchMode(mode === 'search' ? 'insert' : 'search')}
			>{#if mode === 'search'}<SearchIcon />{:else}<PlusIcon />{/if}</button
		>
		<input
			bind:this={input}
			aria-label={mode === 'search' ? 'Search library' : 'Add a link'}
			aria-describedby="omnibar-help"
			placeholder={mode === 'search' ? 'Search titles, notes, #tags, people…' : 'Insert a link…'}
			value={mode === 'search' ? query : draft}
			oninput={(e) => {
				if (mode === 'search') query = e.currentTarget.value;
				else draft = e.currentTarget.value;
			}}
			disabled={!ready || busy || (mode === 'insert' && !!url)}
			autocomplete="off"
			spellcheck="false"
		/>
		{#if mode === 'search'}<button
				type="button"
				class="icon-button"
				aria-label="Return to insert mode"
				onclick={() => switchMode('insert')}><XIcon /></button
			>
		{:else if !url && draft.trim()}<button
				class="omnibar-submit"
				aria-label="Continue to tags and people"
				disabled={!ready || !draft.trim() || busy}><ArrowRightIcon /></button
			>{:else if !url}<button
				type="button"
				class="search-shortcut"
				aria-label="Search library"
				onclick={() => switchMode('search')}><kbd>Ctrl</kbd><kbd>F</kbd></button
			>{/if}
	</form>
	{#if mode === 'insert' && url}
		<div class="capture-picker" aria-busy={busy}>
			<div class="section-heading">
				<strong>{created ? 'Link saved. Finish organizing.' : 'Add a tag or person to save'}</strong
				><button
					class="text-button"
					disabled={busy}
					onclick={() => {
						url = '';
						error = '';
						void tick().then(() => input?.focus());
					}}>{created ? 'Done' : 'Cancel'}</button
				>
			</div>
			<input
				bind:this={picker}
				aria-label="Find a tag or person"
				placeholder="Find a tag or person…"
				bind:value={organizer}
				disabled={busy}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.isComposing) {
						e.preventDefault();
						if (!organizer.trim()) void save();
						else if (choices[0]) void save(choices[0]);
						else if (canCreate) void save({ kind: 'new-tag', id: '', name: tagName });
					}
					if (e.key === 'ArrowDown') {
						e.preventDefault();
						document.querySelector<HTMLButtonElement>('.capture-choices button')?.focus();
					}
				}}
			/>
			<div class="capture-choices">
				{#each choices as choice (`${choice.kind}:${choice.id}`)}<button
						disabled={busy}
						onclick={() => save(choice)}
						><span class="choice-symbol">{choice.kind === 'tag' ? '#' : '@'}</span><span
							>{choice.name}</span
						><small>{choice.kind === 'tag' ? 'Tag' : 'Person'}</small></button
					>{/each}
				{#if canCreate}<button
						disabled={busy}
						onclick={() => save({ kind: 'new-tag', id: '', name: tagName })}
						><PlusIcon /><span>Create #{tagName} and save</span></button
					>{/if}
			</div>
			<button class="text-button" disabled={busy} onclick={() => save()}
				>{busy ? 'Saving…' : 'Save without organizing'} <span aria-hidden="true">↵</span></button
			>
		</div>
	{/if}
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
	<p id="omnibar-help" class="omnibar-help" class:visible={mode === 'search' || !!draft || !!url}>
		{mode === 'search'
			? 'Search your library · Esc for normal mode'
			: 'Enter to continue · choose a tag or person to save'}<span
			>{mode === 'search' ? '#tag · site:example.com · has:note' : 'Ctrl / ⌘ F to search'}</span
		>
	</p>
</section>
