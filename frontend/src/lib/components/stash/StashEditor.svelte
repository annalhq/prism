<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { ChevronRight, CornerDownLeft, CornerDownRight, Search, X } from '@lucide/svelte';
	import StashTree from './StashTree.svelte';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { NoteSession } from '#lib/client/note-session.svelte.js';
	import { requestTitle } from '#lib/client/titles.js';
	import { copyLink } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import {
		addChild,
		addSibling,
		branchKeys,
		createNode,
		flatten,
		locate,
		move,
		outdent,
		parseStash,
		pathTo,
		countLinks,
		removeNode,
		serializeStash,
		updateNode,
		type StashNode
	} from '#lib/domain/stash.js';

	// Editing a rabbit hole: the trail as a tree, and one field to paste the next link into.
	// Enter puts it under the selected link (going deeper); Shift+Enter beside it (a branch).
	let {
		library,
		id,
		version,
		feedback
	}: {
		library: LibraryClient;
		id: string;
		version: number;
		feedback: (message: string) => void;
	} = $props();

	const session = untrack(() => new NoteSession(library, id));
	onDestroy(() => session.destroy());
	$effect(() => session.sync(version));

	let tree = $state<StashNode[]>([]);
	let written = ''; // The Markdown this editor last produced, to tell our edits from remote ones.
	const open = new SvelteSet<string>();
	const loading = new SvelteSet<string>();
	let selected = $state<string | null>(null);
	let next = $state(''),
		problem = $state(''),
		query = $state('');
	// Small trails open fully; past this many links only the way to the selected link is open,
	// so a big rabbit hole stays readable and every closed folder says how much it holds.
	const OPEN_ALL_UP_TO = 12;
	const total = $derived(countLinks(tree));
	// The way down to the selected link, as a breadcrumb trail.
	const trail = $derived(selected ? pathTo(tree, selected) : []);

	// A note that changed elsewhere (another device, or first load) is read back into the tree,
	// with the last link selected, ready to keep digging.
	$effect(() => {
		const body = session.body;
		if (body === written) return;
		untrack(() => {
			tree = parseStash(body);
			written = body;
			if (!selected || !locate(tree, selected))
				selected = flatten(tree, new Set(branchKeys(tree))).at(-1)?.key ?? null;
			open.clear();
			if (countLinks(tree) <= OPEN_ALL_UP_TO) for (const key of branchKeys(tree)) open.add(key);
			else reveal(selected);
		});
	});
	/** Opens every folder on the way to a link, so it can be seen. */
	function reveal(key: string | null) {
		if (!key) return;
		for (const node of pathTo(tree, key).slice(0, -1)) open.add(node.key);
	}
	$effect(() => {
		const key = selected;
		untrack(() => reveal(key));
	});
	function commit(nextTree: StashNode[]) {
		tree = nextTree;
		written = serializeStash(nextTree);
		session.edit(written);
	}

	function add(beside: boolean) {
		problem = '';
		const text = next.trim();
		if (!text) return;
		let url: string;
		try {
			url = normalizeUrl(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`).url;
		} catch {
			problem = 'That doesn’t look like a link.';
			return;
		}
		const node = createNode(url);
		if (!node) {
			problem = 'Only web links (http or https) can go in a rabbit hole.';
			return;
		}
		const parent = beside || !selected ? null : selected;
		commit(beside ? addSibling(tree, selected, node) : addChild(tree, parent, node));
		if (parent) open.add(parent);
		selected = node.key;
		next = '';
		// The hostname stands in until the page's own title arrives.
		loading.add(node.key);
		void requestTitle(url)
			.then((title) => {
				const current = locate(tree, node.key);
				if (title && current && current.siblings[current.index].title === node.title)
					commit(updateNode(tree, node.key, { title: title.slice(0, 300) }));
			})
			.catch(() => {})
			.finally(() => loading.delete(node.key));
	}

	const parentTitle = $derived(trail.at(-1)?.title ?? null);
</script>

<section class="stash-editor" aria-label="Rabbit hole">
	{#if session.conflicted}<div class="editor-conflict" role="status">
			<p>This rabbit hole changed on another device. Your edits are kept.</p>
			<div>
				<button onclick={() => void session.keepMine()}>Keep mine</button><button
					onclick={() => session.useCurrent()}>Use newer</button
				>
			</div>
		</div>{/if}

	<!-- Where you are: the way from the first link down to the selected one. -->
	{#if trail.length > 1}<nav class="stash-trail" aria-label="Path to the selected link">
			{#each trail as step, index (step.key)}{#if index}<ChevronRight
						class="stash-trail-sep"
						aria-hidden="true"
					/>{/if}<button
					type="button"
					class="stash-trail-step"
					aria-current={index === trail.length - 1 ? 'location' : undefined}
					title={step.title}
					onclick={() => (selected = step.key)}>{step.title}</button
				>{/each}
		</nav>{/if}

	{#if total > 8}<label class="stash-find">
			<Search aria-hidden="true" /><input
				bind:value={query}
				placeholder={`Find in ${total} links…`}
				aria-label="Find in this rabbit hole"
				autocomplete="off"
				spellcheck="false"
				onkeydown={(event) => {
					if (event.key === 'Escape') query = '';
				}}
			/>{#if query}<button
					type="button"
					class="stash-find-clear"
					aria-label="Clear"
					onclick={() => (query = '')}><X /></button
				>{/if}
		</label>{/if}

	{#if tree.length}<StashTree
			nodes={tree}
			{open}
			{loading}
			{query}
			bind:selected
			onDescribe={(key, description) => commit(updateNode(tree, key, { description }))}
			onRename={(key, title) => commit(updateNode(tree, key, { title }))}
			onRemove={(key) => {
				commit(removeNode(tree, key));
				if (selected === key) selected = flatten(tree, open).at(-1)?.key ?? null;
			}}
			onOutdent={(key) => commit(outdent(tree, key))}
			onMove={(key, by) => commit(move(tree, key, by))}
			onCopy={(url) => void copyLink(url, feedback)}
		/>{:else}<p class="stash-empty">Paste the first link of this rabbit hole below.</p>{/if}

	<!-- One field for the next link, pinned to the bottom: under the selected one, or beside it. -->
	<div class="stash-dock">
		<label class="stash-next">
			<CornerDownRight aria-hidden="true" />
			<input
				bind:value={next}
				type="url"
				inputmode="url"
				autocomplete="off"
				spellcheck="false"
				placeholder="Paste the next link…"
				aria-label="Add a link to this rabbit hole"
				onkeydown={(event) => {
					if (event.key === 'Enter' && !event.isComposing) {
						event.preventDefault();
						add(event.shiftKey);
					}
				}}
			/>
		</label>
		<p class="stash-hint">
			{#if problem}<span class="stash-problem" role="alert">{problem}</span
				>{:else if parentTitle}<CornerDownLeft class="kbd-icon" aria-label="Enter" />
				under
				<b>{parentTitle}</b> · ⇧<CornerDownLeft class="kbd-icon" aria-label="Enter" /> beside it{:else}<CornerDownLeft
					class="kbd-icon"
					aria-label="Enter"
				/> to add{/if}
		</p>
	</div>
	<p
		class={[
			'editor-status',
			(session.busy || session.dirty) && 'pending',
			session.error && 'failed'
		]}
		role="status"
	>
		<span class="editor-status-dot" aria-hidden="true"></span>{session.status}
	</p>
	{#if session.error}<p class="form-error" role="alert">
			{session.error}
			<button class="text-button" onclick={() => void session.save()}>Try again</button>
		</p>{/if}
</section>
