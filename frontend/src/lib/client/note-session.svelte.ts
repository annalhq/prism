import { untrack } from 'svelte';
import type { LibraryClient } from '#lib/client/vault/library.js';
import type { NoteProjection, Revision } from '#lib/domain/contracts.js';
import { validateNoteBody } from '#lib/domain/notes.js';

/**
 * One entity's note being edited: the same draft, autosave and conflict handling NoteEditor
 * uses, for editors that build the note's Markdown themselves (a rabbit hole's tree). Call
 * `sync(version)` from an effect so remote changes and confirmations flow in, and `destroy()`
 * on unmount so an unsaved draft is kept.
 */
export class NoteSession {
	body = $state('');
	base = $state<Revision>('0');
	dirty = $state(false);
	queued = $state(false);
	busy = $state(false);
	error = $state('');
	initialized = false;
	#queuedBody: string | null = null;
	#autoSave: ReturnType<typeof setTimeout> | undefined;
	#draftTimer: ReturnType<typeof setTimeout> | undefined;
	#destroyed = false;

	constructor(
		private library: LibraryClient,
		private id: string
	) {}

	get current() {
		return this.library.get<NoteProjection>('notes', this.id);
	}
	/** A newer note arrived from another device while this one has unsaved edits. */
	get conflicted() {
		return (this.dirty || this.queued) && !!this.current && this.current.revision !== this.base;
	}
	get status() {
		return this.error
			? 'Not saved'
			: this.busy
				? 'Saving…'
				: this.queued
					? 'Saved on this device'
					: this.dirty
						? 'Editing'
						: 'Saved';
	}

	/** Pulls in the stored note, remote changes and save confirmations. */
	sync(version: number) {
		void version;
		const current = this.current;
		const confirmed = this.library.getConfirmed<NoteProjection>('notes', this.id);
		if (!this.initialized) {
			const draft = this.library.getDraft(this.id);
			this.body = draft?.body ?? current?.bodyMarkdown ?? '';
			this.base =
				draft && draft.body !== current?.bodyMarkdown
					? draft.baseRevision
					: (current?.revision ?? draft?.baseRevision ?? '0');
			this.dirty = !!draft && draft.body !== current?.bodyMarkdown;
			this.initialized = true;
		} else if (!this.dirty && !this.queued && current) {
			this.body = current.bodyMarkdown;
			this.base = current.revision;
		}
		if (this.queued && confirmed?.bodyMarkdown === this.#queuedBody) {
			this.base = confirmed.revision;
			this.queued = false;
			this.#queuedBody = null;
			untrack(() => {
				if (this.dirty) this.#schedule();
			});
			if (this.body === confirmed.bodyMarkdown) {
				this.dirty = false;
				untrack(() => void this.library.clearDraft(this.id));
			} else {
				this.dirty = true;
				untrack(() => void this.library.setDraft(this.id, this.body, this.base));
			}
		}
	}

	/** Replaces the body; it is kept as a draft at once and saved shortly after. */
	edit(body: string) {
		this.body = body;
		this.dirty = true;
		this.error = '';
		clearTimeout(this.#draftTimer);
		const draftBody = body,
			draftBase = this.base;
		this.#draftTimer = setTimeout(() => {
			void this.library.setDraft(this.id, draftBody, draftBase).catch((e: Error) => {
				this.error = e.message;
			});
		}, 300);
		this.#schedule();
	}

	#schedule() {
		clearTimeout(this.#autoSave);
		this.#autoSave = setTimeout(() => {
			if (!this.busy && this.dirty && !this.#destroyed) void this.save();
		}, 700);
	}

	async save() {
		if (this.busy) return;
		this.error = '';
		const submittedBody = this.body,
			submittedBase = this.base;
		try {
			validateNoteBody(submittedBody);
		} catch (e) {
			this.error = (e as Error).message;
			return;
		}
		this.busy = true;
		clearTimeout(this.#draftTimer);
		try {
			await this.library.setDraft(this.id, submittedBody, submittedBase);
			const result = await this.library.save({
				type: 'note.replace',
				id: this.id,
				expectedRevision: submittedBase,
				bodyMarkdown: submittedBody
			});
			if (this.#destroyed) return;
			if (result.status === 'rejected') {
				this.error = result.message ?? 'The changes could not be saved.';
				return;
			}
			this.queued = result.status === 'queued';
			this.#queuedBody = this.queued ? submittedBody : null;
			if (!this.queued) this.base = this.current?.revision ?? this.base;
			if (this.body === submittedBody) {
				this.dirty = false;
				if (!this.queued) await this.library.clearDraft(this.id);
			} else {
				this.dirty = true;
				await this.library.setDraft(this.id, this.body, this.base);
			}
		} catch (e) {
			this.error = (e as Error).message;
		} finally {
			this.busy = false;
			if (this.dirty && !this.error && !this.#destroyed) this.#schedule();
		}
	}

	/** Drops local edits for the newer note from another device. */
	useCurrent() {
		this.body = this.current?.bodyMarkdown ?? '';
		this.base = this.current?.revision ?? '0';
		this.dirty = false;
		this.queued = false;
		void this.library.clearDraft(this.id);
	}

	/** Keeps local edits, to replace the newer note. */
	async keepMine() {
		for (const conflict of this.library.state.conflicts) {
			const command = conflict.envelope.command;
			if (command.type === 'note.replace' && command.id === this.id)
				await this.library.resolveConflict(conflict.operationId, 'remote');
		}
		this.base = this.current?.revision ?? '0';
		this.edit(this.body);
	}

	destroy() {
		this.#destroyed = true;
		clearTimeout(this.#autoSave);
		clearTimeout(this.#draftTimer);
		if (this.dirty || this.queued)
			void this.library.setDraft(this.id, this.body, this.base).catch(() => {});
	}
}
