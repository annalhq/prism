<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import TokenInput from './ui/TokenInput.svelte';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { NoteProjection, Revision } from '#lib/domain/contracts.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { extractReferences, validateNoteBody } from '#lib/domain/notes.js';
	import { entityLabel } from '#lib/client/search.js';
	import {
		addNoteLink,
		splitLinkedNote,
		joinLinkedNote,
		removeLinkedNoteReference
	} from '#lib/client/reference-edits.js';
	let {
		library,
		entity,
		version,
		feedback
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
		busy = $state(false);
	let queuedBody = $state<string | null>(null);
	let error = $state('');
	let autoSave: ReturnType<typeof setTimeout> | undefined;
	let editor = $state<HTMLTextAreaElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	const current = $derived.by(() => {
		void version;
		return library.get<NoteProjection>('notes', entity.id);
	});
	const confirmed = $derived.by(() => {
		void version;
		return library.getConfirmed<NoteProjection>('notes', entity.id);
	});
	const choices = $derived.by(() => {
		void version;
		const rows: (Record<string, unknown> & { entityKind: string })[] = [
			...library
				.list<Record<string, unknown>>('bookmarks')
				.map((r) => ({ ...r, entityKind: 'bookmark' })),
			...library
				.list<Record<string, unknown>>('people')
				.map((r) => ({ ...r, entityKind: 'person' }))
		];
		return rows.filter((r) => !r.deletedAt && !r.purgedAt);
	});
	const noteText = $derived(splitLinkedNote(body).text);
	const references = $derived(
		extractReferences(body)
			.filter((r) => r.kind !== 'persona')
			.map((r) => `${r.kind}/${r.id}`)
	);
	const referenceChoices = $derived(
		choices
			.filter((c) => c.id !== entity.id)
			.map((c) => ({
				value: `${c.entityKind}/${c.id}`,
				label: entityLabel(c),
				search:
					String(c.description ?? c.bio ?? '') +
					' ' +
					String(library.get<NoteProjection>('notes', String(c.id))?.bodyMarkdown ?? '')
			}))
	);
	$effect(() => {
		void version;
		if (!initialized) {
			const draft = library.getDraft(entity.id);
			body =
				draft?.body ??
				current?.bodyMarkdown ??
				String(library.get<Record<string, unknown>>('bookmarks', entity.id)?.description ?? '');
			base =
				draft && draft.body !== current?.bodyMarkdown
					? draft.baseRevision
					: (current?.revision ?? draft?.baseRevision ?? '0');
			dirty = !!draft && draft.body !== current?.bodyMarkdown;
			initialized = true;
		} else if (!dirty && !queued && current) {
			body = current.bodyMarkdown;
			base = current.revision;
		}
		if (queued && confirmed?.bodyMarkdown === queuedBody) {
			base = confirmed.revision;
			queued = false;
			queuedBody = null;
			untrack(() => {
				if (dirty) scheduleSave();
			});
			if (body === confirmed.bodyMarkdown) {
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
		clearTimeout(autoSave);
		clearTimeout(timer);
		if (dirty || queued) void library.setDraft(entity.id, body, base).catch(() => {});
	});
	function scheduleSave() {
		clearTimeout(autoSave);
		autoSave = setTimeout(() => {
			if (!busy && dirty && !destroyed) void save();
		}, 700);
	}
	function edited() {
		dirty = true;
		error = '';
		persistDraft();
		scheduleSave();
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
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
			if (dirty && !error && !destroyed) scheduleSave();
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
		error = '';
		scheduleSave();
		feedback('Your draft will replace the current note.');
	}
	function insertReference(value: string) {
		const chosen = choices.find((r) => `${r.entityKind}/${r.id}` === value);
		if (!chosen || references.includes(value)) return;
		body = addNoteLink(
			body,
			{ kind: chosen.entityKind as EntityRef['kind'], id: String(chosen.id) },
			entityLabel(chosen)
		);
		edited();
	}
	function removeReference(value: string) {
		body = removeLinkedNoteReference(body, value);
		edited();
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
		<span class="muted" role="status"
			>{busy
				? 'Saving…'
				: queued
					? 'Saved on this device · pending sync'
					: dirty
						? 'Saving draft…'
						: 'Saved'}</span
		>
	</div>
	{#if (dirty || queued) && current && current.revision !== base}<p class="notice">
			A newer note is available. Your draft is preserved.
		</p>
		<div class="button-row">
			<button onclick={rebase}>Keep my draft</button><button onclick={useCurrent}
				>Use current note</button
			><button onclick={downloadDraft}>Export draft</button>
		</div>{/if}
	<label class="sr-only" for="note-body">Note</label><textarea
		id="note-body"
		bind:this={editor}
		value={noteText}
		oninput={(event) => {
			body = joinLinkedNote(event.currentTarget.value, splitLinkedNote(body).links);
			edited();
		}}
		onblur={() => {
			if (dirty && !busy) void save();
		}}
		onkeydown={(event) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				void save();
			}
		}}
		placeholder="Your thoughts, in your own words…"
		rows="4"></textarea>
	<div class="linked-content-field">
		<span class="field-label">Linked content</span>
		<TokenInput
			label="Link saved content"
			placeholder="Link content or people…"
			items={referenceChoices}
			selected={references}
			onAdd={(value) => insertReference(value)}
			onRemove={removeReference}
		/>
	</div>
	{#if error}<p class="form-error" role="alert">{error}</p>
		<button class="text-button" onclick={save}>Try saving again</button>{/if}
</section>
