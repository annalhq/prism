<script lang="ts">
	import { Check, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from '@lucide/svelte';
	import { ContextMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { APPEARANCE_ID } from '#lib/domain/appearance.js';
	import type { Revision } from '#lib/domain/contracts.js';
	import { normalizeOrganizationName } from '#lib/domain/organization.js';
	import {
		BUILTIN_THEMES,
		builtinTheme,
		themeSwatch,
		type BuiltinThemeId,
		type ThemeDocument
	} from '#lib/domain/theme.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import {
		activeThemeId,
		installedThemes,
		type InstalledTheme
	} from '#lib/client/appearance.svelte.js';
	import {
		exportTheme,
		loadGallery,
		loadGalleryTheme,
		readThemeFile,
		type GalleryEntry
	} from '#lib/client/theme-files.js';
	import { moveTag } from '#lib/client/workflows.js';

	let {
		library,
		changed,
		feedback,
		page = $bindable('main')
	}: {
		library: LibraryClient | null;
		/** Any value that changes with the library, to refresh the lists. */
		changed: unknown;
		feedback: (message: string) => void;
		/** `themes` is the full-pane theme browser. */
		page?: 'main' | 'themes';
	} = $props();

	type Swatch = { canvas: string; ink: string; accent: string };
	const installed = $derived.by(() => {
		void changed;
		return library ? installedThemes(library) : { themes: [], modules: [] };
	});
	const active = $derived.by(() => {
		void changed;
		return library ? activeThemeId(library) : 'zen-dark';
	});
	const activeInstalled = $derived(installed.themes.find((entry) => entry.row.id === active));
	const activeName = $derived(
		activeInstalled?.document.name ?? builtinTheme(active)?.name ?? 'Zen dark'
	);
	const activeSwatch = $derived(
		themeSwatch(
			activeInstalled?.document ?? ((builtinTheme(active)?.id ?? 'zen-dark') as BuiltinThemeId)
		)
	);

	let tab = $state<'installed' | 'explore'>('installed'),
		error = $state(''),
		busy = $state(false),
		input = $state<HTMLInputElement>(),
		gallery = $state<GalleryEntry[] | null>(null),
		galleryError = $state('');

	const keyOf = (document: Pick<ThemeDocument, 'kind' | 'name'>) =>
		`${document.kind}:${normalizeOrganizationName(document.name).normalizedName}`;
	const installedKeys = $derived(
		new Set([...installed.themes, ...installed.modules].map((entry) => keyOf(entry.document)))
	);

	async function run(task: () => Promise<void>) {
		if (!library || busy) return;
		busy = true;
		error = '';
		try {
			await task();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	async function save(command: Parameters<LibraryClient['save']>[0]) {
		const result = await library!.save(command);
		if (result.status === 'rejected') throw new Error(result.message ?? 'Could not save.');
	}
	const activate = (id: string) =>
		run(() => save({ type: 'appearance.set', id: APPEARANCE_ID, activeTheme: id }));

	/** Installs a document, replacing one of the same kind and name; themes become active. */
	async function install(document: ThemeDocument) {
		const existing = [...installed.themes, ...installed.modules].find(
			(entry) => keyOf(entry.document) === keyOf(document)
		);
		const id = existing ? String(existing.row.id) : crypto.randomUUID();
		await save(
			existing
				? {
						type: 'theme.update',
						id,
						expectedRevision: String(existing.row.revision) as Revision,
						document
					}
				: { type: 'theme.create', id, document }
		);
		if (document.kind === 'theme')
			await save({ type: 'appearance.set', id: APPEARANCE_ID, activeTheme: id });
		feedback(`${document.name} ${existing ? 'updated' : 'installed'}.`);
	}
	const installFiles = (files: FileList | null | undefined) =>
		run(async () => {
			for (const file of files ?? []) await install(await readThemeFile(file));
		});
	const remove = (entry: InstalledTheme) =>
		run(() =>
			save({
				type: 'theme.delete',
				id: String(entry.row.id),
				expectedRevision: String(entry.row.revision) as Revision
			})
		);
	const toggle = (entry: InstalledTheme) =>
		run(() =>
			save({ type: 'theme.toggle', id: String(entry.row.id), enabled: entry.row.enabled === false })
		);
	const move = (entry: InstalledTheme, step: number) =>
		run(async () => {
			const rows = installed.modules.map((module) => module.row);
			const index = rows.findIndex((row) => row.id === entry.row.id);
			if (rows[index + step])
				await moveTag(library!, rows, String(entry.row.id), index + step, 'themes');
		});

	async function showTab(next: 'installed' | 'explore') {
		tab = next;
		if (next !== 'explore' || gallery) return;
		galleryError = '';
		try {
			gallery = await loadGallery();
		} catch (e) {
			galleryError = (e as Error).message;
		}
	}
	const installFromGallery = (entry: GalleryEntry) =>
		run(async () => {
			await install(await loadGalleryTheme(entry));
		});
	const schemeLabel = (scheme: string | undefined) => (scheme === 'light' ? 'Light' : 'Dark');
</script>

{#snippet menu(
	trigger: Snippet,
	document: ThemeDocument | BuiltinThemeId,
	entry?: InstalledTheme,
	index = -1
)}
	<ContextMenu.Root
		><ContextMenu.Trigger>{@render trigger()}</ContextMenu.Trigger><ContextMenu.Portal
			><ContextMenu.Content class="menu-content" collisionPadding={12}>
				{#if entry && index >= 0}<ContextMenu.Item
						class="menu-item"
						disabled={index === 0}
						onSelect={() => move(entry, -1)}><span>Move up</span></ContextMenu.Item
					><ContextMenu.Item
						class="menu-item"
						disabled={index === installed.modules.length - 1}
						onSelect={() => move(entry, 1)}><span>Move down</span></ContextMenu.Item
					><ContextMenu.Separator class="menu-separator" />{/if}
				<ContextMenu.Item class="menu-item" onSelect={() => exportTheme(document)}
					><Download /><span>Export</span></ContextMenu.Item
				>
				{#if entry}<ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
						class="menu-item danger-text"
						onSelect={() => remove(entry)}><Trash2 /><span>Remove</span></ContextMenu.Item
					>{/if}
			</ContextMenu.Content></ContextMenu.Portal
		></ContextMenu.Root
	>
{/snippet}

{#snippet swatch(colors: Swatch)}
	<span
		class="theme-swatch"
		aria-hidden="true"
		style:--swatch-canvas={colors.canvas}
		style:--swatch-ink={colors.ink}
		style:--swatch-accent={colors.accent}><span></span><span></span></span
	>
{/snippet}

{#snippet themeRow(
	id: string,
	name: string,
	detail: string,
	document: ThemeDocument | BuiltinThemeId,
	entry?: InstalledTheme
)}
	{#snippet row()}<button
			class="settings-row"
			role="radio"
			aria-checked={active === id}
			disabled={busy}
			onclick={() => activate(id)}
			>{@render swatch(themeSwatch(document))}<span class="settings-text"
				><strong>{name}</strong><small>{detail}</small></span
			>{#if active === id}<Check class="settings-glyph" />{/if}</button
		>{/snippet}
	{@render menu(row, document, entry)}
{/snippet}

<div
	class="theme-settings"
	role="presentation"
	ondragover={(event) => {
		if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
	}}
	ondrop={(event) => {
		if (!event.dataTransfer?.files.length) return;
		event.preventDefault();
		void installFiles(event.dataTransfer.files);
	}}
>
	{#if page === 'main'}
		<section class="settings-group">
			<h3>Theme</h3>
			<div class="settings-card">
				<button class="settings-row" onclick={() => (page = 'themes')}
					>{@render swatch(activeSwatch)}<span class="settings-text"
						><strong>{activeName}</strong><small>Browse, install and manage themes</small></span
					><ChevronRight class="settings-glyph" /></button
				>
			</div>
		</section>

		{#if installed.modules.length}<section class="settings-group">
				<h3>Modules</h3>
				<div class="settings-card">
					{#each installed.modules as entry, index (String(entry.row.id))}
						{#snippet row()}<button
								class="settings-row"
								role="switch"
								aria-checked={entry.row.enabled !== false}
								disabled={busy}
								onclick={() => toggle(entry)}
								><span class="settings-text"
									><strong>{entry.document.name}</strong>{#if entry.document.description}<small
											>{entry.document.description}</small
										>{/if}</span
								><span class="preference-switch" class:enabled={entry.row.enabled !== false}
									><span></span></span
								></button
							>{/snippet}
						{@render menu(row, entry.document, entry, index)}
					{/each}
				</div>
			</section>{/if}
	{:else}
		<section class="settings-group theme-page">
			<div class="theme-page-head">
				<button class="theme-page-back" onclick={() => (page = 'main')}
					><ChevronLeft />Appearance</button
				>
				<div class="settings-segmented" role="tablist" aria-label="Themes">
					<span class="settings-segmented-thumb" aria-hidden="true"></span>
					<button
						role="tab"
						aria-selected={tab === 'installed'}
						onclick={() => void showTab('installed')}>Installed</button
					><button
						role="tab"
						aria-selected={tab === 'explore'}
						onclick={() => void showTab('explore')}>Explore</button
					>
				</div>
			</div>

			{#if tab === 'installed'}
				<div class="settings-card" role="radiogroup" aria-label="Theme">
					{#each BUILTIN_THEMES as theme (theme.id)}{@render themeRow(
							theme.id,
							theme.name,
							schemeLabel(theme.scheme),
							theme.id
						)}{/each}
					{#each installed.themes as entry (String(entry.row.id))}{@render themeRow(
							String(entry.row.id),
							entry.document.name,
							[schemeLabel(entry.document.scheme), entry.document.author]
								.filter(Boolean)
								.join(' · '),
							entry.document,
							entry
						)}{/each}
					<button class="settings-row" disabled={busy || !library} onclick={() => input?.click()}
						><span class="settings-text"
							><strong>Add from file</strong><small>Choose or drop a theme or module .json</small
							></span
						><Plus class="settings-glyph" /></button
					>
				</div>
			{:else}
				<div class="settings-card">
					{#if gallery}{#each gallery as entry (entry.file)}
							{@const done = installedKeys.has(keyOf(entry))}<button
								class="settings-row"
								disabled={busy || done || !library}
								onclick={() => installFromGallery(entry)}
								>{#if entry.swatch}{@render swatch(entry.swatch)}{/if}<span class="settings-text"
									><strong>{entry.name}</strong><small
										>{entry.kind === 'module'
											? (entry.description ?? 'Module')
											: schemeLabel(entry.scheme)}</small
									></span
								><span class="theme-install">{done ? 'Installed' : 'Install'}</span></button
							>{/each}{:else}<p class="settings-note">{galleryError || 'Loading…'}</p>{/if}
				</div>
			{/if}
		</section>
	{/if}
	{#if error}<p class="settings-note settings-error" role="alert">{error}</p>{/if}
	<input
		bind:this={input}
		type="file"
		accept="application/json,.json"
		multiple
		hidden
		onchange={(event) => {
			void installFiles(event.currentTarget.files);
			event.currentTarget.value = '';
		}}
	/>
</div>
