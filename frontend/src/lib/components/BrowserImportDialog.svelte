<script lang="ts">
	import { Dialog } from 'bits-ui';
	import XIcon from '@lucide/svelte/icons/x';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import type {
		BrowserImportPlan,
		BrowserImportProgress,
		BrowserImportReport
	} from '#lib/client/vault/browser-bookmarks.js';

	let {
		open = $bindable(false),
		plan,
		library,
		online,
		pending,
		feedback,
		download
	}: {
		open?: boolean;
		plan: BrowserImportPlan;
		library: LibraryClient | null;
		online: boolean;
		pending: number;
		feedback: (message: string) => void;
		download: (value: unknown, name: string) => void;
	} = $props();

	// The parent remounts this dialog for each chosen file, so these start fresh per plan.
	// svelte-ignore state_referenced_locally
	let keepPrivate = $state(plan.keepPrivate);
	let busy = $state(false),
		controller: AbortController | null = null,
		progress = $state<BrowserImportProgress | null>(null),
		report = $state<BrowserImportReport | null>(null);

	const newCollections = $derived(plan.collections.filter((c) => !c.existing).length);
	const newTags = $derived(plan.tags.filter((t) => !t.existing).length);
	const toSave = $derived(plan.bookmarks.length - plan.previouslyImported);
	const MAPPING_ROWS = 12;

	async function run() {
		if (!library) return;
		busy = true;
		controller = new AbortController();
		try {
			const { runBrowserImport } = await import('#lib/client/vault/browser-bookmarks.js');
			report = await runBrowserImport(
				library,
				{ ...plan, keepPrivate },
				{ signal: controller.signal, onProgress: (value) => (progress = value) }
			);
			feedback(
				report.status === 'complete'
					? `Imported ${report.counts.created.toLocaleString()} bookmarks.`
					: report.status === 'cancelled'
						? 'Import cancelled. Choose the same file again to resume.'
						: 'Import stopped. Download the report, then choose the file again to resume.'
			);
		} catch (error) {
			feedback((error as Error).message);
		} finally {
			busy = false;
			controller = null;
		}
	}
	const reportName = () =>
		`prism-browser-import-${(report?.finishedAt ?? new Date().toISOString()).slice(0, 10)}.json`;
</script>

<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content browser-import"
			interactOutsideBehavior={busy ? 'ignore' : 'close'}
			escapeKeydownBehavior={busy ? 'ignore' : 'close'}
			><Dialog.Title class="dialog-title">Import browser bookmarks</Dialog.Title><Dialog.Description
				class="dialog-description"
				>Review how {plan.fileName} maps onto your library. Nothing is saved until you import.</Dialog.Description
			>

			{#if plan.resumed}<p class="resume-note">
					Resuming an earlier import of this file. {plan.previouslyImported.toLocaleString()} bookmarks
					from it are already saved and won't be duplicated.
				</p>{/if}

			<dl class="import-summary">
				<div>
					<dt>Found</dt>
					<dd>
						{plan.found.toLocaleString()} links in {plan.folders.toLocaleString()} folders
					</dd>
				</div>
				<div>
					<dt>To save</dt>
					<dd>{toSave.toLocaleString()} new bookmarks</dd>
				</div>
				<div>
					<dt>Already saved</dt>
					<dd>{plan.existing.toLocaleString()} left unchanged</dd>
				</div>
				<div>
					<dt>Collections</dt>
					<dd>{newCollections} new · {plan.collections.length - newCollections} existing</dd>
				</div>
				<div>
					<dt>Tags</dt>
					<dd>{newTags} new · {plan.tags.length - newTags} existing</dd>
				</div>
			</dl>

			{#if plan.reasons.length}<section class="import-section">
					<h3>Skipped</h3>
					<ul>
						{#each plan.reasons as entry (entry.reason)}<li>
								<span>{entry.reason}</span><strong>{entry.count.toLocaleString()}</strong>
							</li>{/each}
					</ul>
				</section>{/if}

			{#if plan.mapping.length}<section class="import-section">
					<h3>Folders</h3>
					<p class="muted">
						Top folders become collections. {plan.containers.length
							? `Browser roots (${plan.containers.join(', ')}) are not folders of their own.`
							: ''}
						Nested folders become one tag named by their path, joined with “/” (a “/” inside a folder
						name is written “\/”).
					</p>
					<table class="mapping">
						<thead><tr><th>In the file</th><th>Collection</th><th>Tag</th></tr></thead>
						<tbody>
							{#each plan.mapping.slice(0, MAPPING_ROWS) as row (row.path + row.collection + row.tag)}<tr
									><td title={row.path}>{row.path}</td><td>{row.collection ?? '—'}</td><td
										>{row.tag ?? '—'}</td
									></tr
								>{/each}
						</tbody>
					</table>
					{#if plan.mapping.length > MAPPING_ROWS}<p class="muted">
							{plan.mapping.length - MAPPING_ROWS} more folder paths are listed in the report.
						</p>{/if}
				</section>{/if}

			{#if plan.adjustments.length}<p class="muted">
					{plan.adjustments.length.toLocaleString()} names or descriptions will be shortened or merged;
					each is listed in the report.
				</p>{/if}
			{#each plan.warnings as warning (warning)}<p class="muted">{warning}</p>{/each}

			<label class="private-option"
				><input type="checkbox" bind:checked={keepPrivate} disabled={busy || !!report} /><span
					>Keep imported bookmarks private<small
						>Adds the private tag “{plan.privateTag}”, so nothing from this file appears in your
						public library.</small
					></span
				></label
			>
			<p class="muted">
				Imported links aren't fetched for titles or previews, so a large file sends no extra
				requests.
			</p>

			{#if progress && (busy || report)}<div class="import-progress" role="status">
					<progress value={progress.done} max={Math.max(progress.total, 1)}></progress>
					<span
						>{progress.phase} · {progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span
					>
				</div>{/if}

			{#if report}<section class="import-section">
					<h3>
						{report.status === 'complete'
							? 'Import finished'
							: report.status === 'cancelled'
								? 'Import cancelled'
								: 'Import stopped'}
					</h3>
					<p>
						{report.counts.created.toLocaleString()} saved · {report.counts.existing.toLocaleString()}
						already in your library · {report.counts.skipped.toLocaleString()} skipped{report.counts
							.failed
							? ` · ${report.counts.failed.toLocaleString()} failed`
							: ''}
					</p>
					{#if report.error}<p class="form-error">{report.error}</p>{/if}
				</section>{/if}

			<div class="button-row">
				{#if busy}<button class="secondary-button" onclick={() => controller?.abort()}
						>Cancel after this step</button
					>{:else if report}<button
						class="primary-button"
						onclick={() => report && download(report, reportName())}>Download report</button
					>{:else}<button
						class="primary-button"
						onclick={run}
						disabled={!online || !!pending || (!toSave && !plan.previouslyImported)}
						>{plan.resumed
							? 'Resume import'
							: `Import ${toSave.toLocaleString()} bookmarks`}</button
					><button class="secondary-button" onclick={() => download(plan, reportName())}
						>Download preview</button
					>{/if}
			</div>
			{#if !busy && !report && (!online || pending)}<p class="muted">
					{!online
						? 'Connect to the internet to import.'
						: 'Finish syncing pending changes before importing.'}
				</p>{/if}
			<Dialog.Close class="icon-button dialog-close" aria-label="Close import" disabled={busy}
				><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	:global(.browser-import) {
		width: min(560px, calc(100vw - 28px));
		display: grid;
		gap: 14px;
	}
	.resume-note {
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--field);
		font-size: var(--text-sm);
	}
	.import-summary {
		display: grid;
		gap: 6px;
		margin: 0;
		font-size: var(--text-md);
	}
	.import-summary div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.import-summary dt {
		color: var(--secondary);
	}
	.import-summary dd {
		margin: 0;
		text-align: right;
	}
	.import-section {
		display: grid;
		gap: 8px;
	}
	.import-section h3 {
		color: var(--tertiary);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.import-section ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.import-section li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.mapping {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		font-size: var(--text-sm);
	}
	.mapping th {
		color: var(--tertiary);
		font-weight: 500;
		text-align: left;
	}
	.mapping th,
	.mapping td {
		overflow: hidden;
		padding: 4px 6px 4px 0;
		border-bottom: 1px solid var(--hairline);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.private-option {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: var(--text-md);
	}
	.private-option input {
		margin-top: 3px;
	}
	.private-option small {
		display: block;
		color: var(--secondary);
		font-size: var(--text-sm);
	}
	.import-progress {
		display: grid;
		gap: 6px;
		font-size: var(--text-sm);
	}
	.import-progress progress {
		width: 100%;
		accent-color: var(--accent);
	}
</style>
