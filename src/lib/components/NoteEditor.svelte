<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { NoteProjection, Revision } from '#lib/domain/contracts.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { parseReference, renderNote, validateNoteBody } from '#lib/domain/notes.js';
	import { entityLabel } from '#lib/client/search.js';
	let {
		library,
		entity,
		version,
		feedback,
		navigate
	}: {
		library: LibraryClient;
		entity: EntityRef;
		version: number;
		feedback: (message: string) => void;
		navigate: (target: EntityRef) => void;
	} = $props();
	let body = $state(''),
		base = $state<Revision>('0'),
		initialized = $state(false),
		dirty = $state(false),
		queued = $state(false),
		preview = $state(false),
		busy = $state(false);
	let queuedBody = $state<string | null>(null);
	let error = $state(''),
		referenceId = $state(''),
		history = $state<{ revision: Revision; bodyMarkdown: string; acceptedAt: string }[]>([]),
		historyBefore = $state<string | null>(null);
	let editor = $state<HTMLTextAreaElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	const current = $derived.by(() => {
		void version;
		return library.get<NoteProjection>('notes', entity.id);
	});
	const choices = $derived.by(() => {
		void version;
		const rows: (Record<string, unknown> & { entityKind: string })[] = [
			...library
				.list<Record<string, unknown>>('bookmarks')
				.map((r) => ({ ...r, entityKind: 'bookmark' })),
			...library
				.list<Record<string, unknown>>('people')
				.map((r) => ({ ...r, entityKind: 'person' })),
			...library
				.list<Record<string, unknown>>('personas')
				.map((r) => ({ ...r, entityKind: 'persona' }))
		];
		return rows.filter((r) => !r.deletedAt && !r.purgedAt);
	});
	const rendered = $derived(renderNote(body));
	$effect(() => {
		void version;
		if (!initialized) {
			const draft = library.getDraft(entity.id);
			body = draft?.body ?? current?.bodyMarkdown ?? '';
			base = draft?.baseRevision ?? current?.revision ?? '0';
			dirty = !!draft && draft.body !== current?.bodyMarkdown;
			initialized = true;
		} else if (!dirty && !queued && current) {
			body = current.bodyMarkdown;
			base = current.revision;
		}
		if (queued && !library.state.pending && current?.bodyMarkdown === queuedBody) {
			base = current.revision;
			queued = false;
			queuedBody = null;
			if (body === current.bodyMarkdown) {
				dirty = false;
				untrack(() => {
					void library.clearDraft(entity.id);
				});
			} else {
				dirty = true;
				untrack(() => {
					void library.setDraft(entity.id, body, base);
				});
			}
		}
	});
	function persistDraft() {
		clearTimeout(timer);
		const draftBody = body,
			draftBase = base,
			id = entity.id;
		timer = setTimeout(() => {
			void library.setDraft(id, draftBody, draftBase).catch((e: Error) => {
				error = e.message;
			});
		}, 300);
	}
	onDestroy(() => {
		destroyed = true;
		clearTimeout(timer);
		if (dirty || queued) void library.setDraft(entity.id, body, base).catch(() => {});
	});
	function edited() {
		dirty = true;
		error = '';
		persistDraft();
	}
	async function save() {
		if (busy) return;
		error = '';
		const submittedBody = body,
			submittedBase = base;
		try {
			validateNoteBody(submittedBody);
		} catch (e) {
			error = (e as Error).message;
			return;
		}
		busy = true;
		clearTimeout(timer);
		try {
			await library.setDraft(entity.id, submittedBody, submittedBase);
			const result = await library.save({
				type: 'note.replace',
				id: entity.id,
				expectedRevision: submittedBase,
				bodyMarkdown: submittedBody
			});
			if (destroyed) return;
			if (result.status === 'rejected') {
				error = result.message ?? 'The note could not be saved.';
				return;
			}
			queued = result.status === 'queued';
			queuedBody = queued ? submittedBody : null;
			if (!queued) base = library.get<NoteProjection>('notes', entity.id)?.revision ?? base;
			if (body === submittedBody) {
				dirty = false;
				if (!queued) await library.clearDraft(entity.id);
			} else {
				dirty = true;
				await library.setDraft(entity.id, body, base);
			}
			feedback(result.message ?? (queued ? 'Saved on this device.' : 'Note saved.'));
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	function previewLinks(node: HTMLElement) {
		node.addEventListener('click', followReference);
		return { destroy: () => node.removeEventListener('click', followReference) };
	}
	function followReference(event: MouseEvent) {
		const anchor = (event.target as HTMLElement).closest('a');
		const ref = parseReference(anchor?.getAttribute('href') ?? '');
		if (ref) {
			event.preventDefault();
			navigate(ref);
		}
	}

	function useCurrent() {
		body = current?.bodyMarkdown ?? '';
		base = current?.revision ?? '0';
		dirty = false;
		queued = false;
		void library.clearDraft(entity.id);
	}
	async function rebase() {
		for (const conflict of library.state.conflicts) {
			const command = conflict.envelope.command;
			if (command.type === 'note.replace' && command.id === entity.id)
				await library.resolveConflict(conflict.operationId, 'remote');
		}
		base = current?.revision ?? '0';
		dirty = true;
		queued = false;
		persistDraft();
		feedback('Draft kept. Review it and save to replace the current note.');
	}
	function insertReference() {
		const chosen = choices.find((r) => `${r.entityKind}/${r.id}` === referenceId);
		if (!chosen) return;
		const text = `[${entityLabel(chosen).replace(/[[\]]/g, '')}](prism:${chosen.entityKind}/${chosen.id})`;
		const position = editor?.selectionStart ?? body.length;
		body = body.slice(0, position) + text + body.slice(editor?.selectionEnd ?? position);
		edited();
		referenceId = '';
		editor?.focus();
	}
	async function loadHistory(more = false) {
		try {
			const response = await fetch(
				`/api/v1/${entity.kind === 'bookmark' ? 'bookmarks' : 'people'}/${entity.id}/note-history${more && historyBefore ? `?before=${historyBefore}` : ''}`,
				{ cache: 'no-store' }
			);
			if (!response.ok) throw new Error('History is available when signed in and online.');
			const data = await response.json();
			history = more ? [...history, ...data.items] : data.items;
			historyBefore = data.nextBefore;
			if (!history.length) feedback('No previous note versions yet.');
		} catch (e) {
			error = (e as Error).message;
		}
	}
	function restoreBody(value: string) {
		body = value;
		base = current?.revision ?? '0';
		dirty = true;
		queued = false;
		persistDraft();
		feedback('Previous version loaded as a draft. Review and save it.');
	}
	function downloadDraft() {
		const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'prism-note-draft.md';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<section class="inspector-section note-section" aria-labelledby="note-heading">
	<div class="section-heading">
		<h3 id="note-heading">Note</h3>
		<button class="text-button" onclick={() => (preview = !preview)}
			>{preview ? 'Edit' : 'Preview'}</button
		>
	</div>
	{#if (dirty || queued) && current && current.revision !== base}<p class="notice">
			A newer note is available. Your draft is preserved.
		</p>
		<div class="button-row">
			<button onclick={rebase}>Keep draft against current version</button><button
				onclick={useCurrent}>Use current note</button
			><button onclick={downloadDraft}>Export draft</button>
		</div>{/if}
	{#if preview}
		<div class="markdown-preview" use:previewLinks role="document">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderNote strips raw HTML and unsafe URLs before rendering. -->
			{@html rendered}
		</div>{:else}<label class="sr-only" for="note-body">Markdown note</label><textarea
			id="note-body"
			bind:this={editor}
			bind:value={body}
			oninput={edited}
			onkeydown={(event) => {
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					void save();
				}
			}}
			placeholder="Write a thought. Connect it to another item with a reference."
			rows="10"></textarea>
		<div class="reference-insert">
			<select aria-label="Reference target" bind:value={referenceId}
				><option value="">Link content, a person or a persona…</option
				>{#each choices as choice (choice.id)}<option value={`${choice.entityKind}/${choice.id}`}
						>{choice.entityKind} · {entityLabel(choice)}</option
					>{/each}</select
			><button onclick={insertReference} disabled={!referenceId}>Insert</button>
		</div>{/if}
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
	<div class="button-row">
		<button class="primary-button" onclick={save} disabled={busy || queued || !dirty}
			>{busy ? 'Saving…' : queued ? 'Waiting for sync' : 'Save note'}</button
		><span class="muted"
			>{dirty ? 'Draft saved on this device' : queued ? 'Pending sync' : 'Markdown'}</span
		>{#if entity.kind !== 'persona'}<button class="text-button" onclick={() => loadHistory()}
				>History</button
			>{/if}
	</div>
	{#if history.length}<details open>
			<summary>Previous versions</summary>{#each history as item (item.revision)}<div
					class="history-entry"
				>
					<span>{new Date(item.acceptedAt).toLocaleString()}</span><button
						onclick={() => restoreBody(item.bodyMarkdown)}>Load as draft</button
					>
				</div>{/each}{#if historyBefore}<button onclick={() => loadHistory(true)}
					>Older versions</button
				>{/if}
		</details>{/if}
</section>
