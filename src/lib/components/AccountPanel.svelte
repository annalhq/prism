<script lang="ts">
	import { Dialog, Tabs } from 'bits-ui';
	import { resolve } from '$app/paths';
	import {
		UserRound,
		RefreshCw,
		Cloud,
		CloudOff,
		ChevronRight,
		Download,
		Upload,
		LogOut,
		LockKeyhole,
		Plus,
		Search,
		X,
		Keyboard,
		Folder,
		Hash,
		Check,
		AlertCircle
	} from '@lucide/svelte';
	import type { LibraryClient, LibraryState } from '#lib/client/vault/library.js';
	import KeyboardHelp from './KeyboardHelp.svelte';
	type Row = Record<string, unknown>;
	type Entry = { table: 'tags' | 'collections' | 'savedSearches'; row: Row };
	let {
		open = $bindable(false),
		library,
		status,
		tags,
		collections,
		saved,
		toast,
		feedback,
		onCreate,
		onManage,
		onExport,
		onImport,
		onExportPending,
		onMaintenance
	}: {
		open?: boolean;
		library: LibraryClient | null;
		status: LibraryState | null;
		tags: Row[];
		collections: Row[];
		saved: Row[];
		toast: string;
		feedback: (message: string) => void;
		onCreate: (type: string) => void;
		onManage: (entry: Entry) => void;
		onExport: () => void;
		onImport: (event: Event) => void;
		onExportPending: () => void;
		onMaintenance: () => void;
	} = $props();
	let tab = $state('account'),
		query = $state('');
	const entries = $derived(
		[
			...tags.map((row) => ({ table: 'tags' as const, row })),
			...collections.map((row) => ({ table: 'collections' as const, row })),
			...saved.map((row) => ({ table: 'savedSearches' as const, row }))
		].filter((e) =>
			String(e.row.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
		)
	);
	$effect(() => {
		if (!open) {
			query = '';
			tab = 'account';
		}
	});
	function create(type: string) {
		open = false;
		onCreate(type);
	}
</script>

<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content account-panel"
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				document.querySelector<HTMLButtonElement>('.account-button')?.focus();
			}}
		>
			<header class="account-panel-header">
				<div class="profile-avatar"><UserRound /></div>
				<div>
					<Dialog.Title class="dialog-title">Account & settings</Dialog.Title><Dialog.Description
						class="dialog-description">Your personal space in Prism.</Dialog.Description
					>
				</div>
				<Dialog.Close class="icon-button" aria-label="Close library settings"><X /></Dialog.Close>
			</header>
			<Tabs.Root bind:value={tab}>
				<Tabs.List class="account-tabs" aria-label="Account sections"
					><Tabs.Trigger value="account">Account</Tabs.Trigger><Tabs.Trigger value="library"
						>Library</Tabs.Trigger
					><Tabs.Trigger value="shortcuts"><Keyboard /> Shortcuts</Tabs.Trigger></Tabs.List
				>
				<div class="account-scroll">
					<Tabs.Content value="account">
						<section class="settings-group">
							<h3>Synchronization</h3>
							<div class="settings-card sync-card">
								<div class="sync-heading">
									<span class="setting-icon"
										>{#if status?.online}<Cloud />{:else}<CloudOff />{/if}</span
									>
									<div>
										<strong
											>{status?.loading
												? 'Syncing your library'
												: status?.conflicts.length
													? 'Some changes need attention'
													: !status?.online
														? 'Working offline'
														: status?.pending
															? 'Changes waiting to sync'
															: status?.ready
																? 'Everything is up to date'
																: 'Not connected'}</strong
										>
										<p>
											{status?.pending
												? `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} saved on this device`
												: status?.online
													? 'Your library stays in sync across devices.'
													: 'Your changes will sync when you reconnect.'}
										</p>
									</div>
								</div>
								{#if status?.error}<p class="sync-error"><AlertCircle />{status.error}</p>{/if}
								<div class="sync-footer">
									<span
										><span class="status-dot" class:offline={!status?.online}></span>{status?.online
											? 'Connected'
											: 'Offline'}</span
									><button
										class="secondary-button"
										disabled={!status?.online || status?.loading}
										onclick={() => library?.sync()}
										><RefreshCw class={status?.loading ? 'spinning' : ''} />{status?.loading
											? 'Syncing…'
											: 'Sync now'}</button
									>
								</div>
							</div>
						</section>
						{#if status?.conflicts.length}<section class="settings-group">
								<h3>Needs attention</h3>
								{#each status.conflicts as conflict (conflict.operationId)}<div
										class="settings-card conflict-entry"
									>
										<strong>{conflict.envelope.command.type}</strong>
										<p>{conflict.error?.message}</p>
										<p class="muted">Your original change and note draft are preserved.</p>
										<button
											onclick={() =>
												library
													?.resolveConflict(conflict.operationId, 'remote')
													.catch((error: Error) => feedback(error.message))}
											>Keep server version; preserve draft</button
										>
									</div>{/each}
							</section>{/if}
						<section class="settings-group">
							<h3>Personal account</h3>
							<div class="settings-card">
								<a class="setting-row" href={resolve('/auth/sign-in')}
									><span class="setting-icon"><LockKeyhole /></span><span
										><strong>Sign-in & password</strong><small>Manage access to your library</small
										></span
									><ChevronRight /></a
								>
								<form method="POST" action={`${resolve('/auth/sign-in')}?/signOut`}>
									<button class="setting-row" disabled={!status?.online}
										><span class="setting-icon"><LogOut /></span><span>Sign out</span><ChevronRight
										/></button
									>
								</form>
							</div>
						</section>
						<p class="account-footnote">
							<LockKeyhole /> Private library · stored on this trusted device
						</p>
					</Tabs.Content>
					<Tabs.Content value="library">
						<section class="settings-group">
							<div class="section-heading">
								<h3>Organization</h3>
								<div class="button-row">
									<button
										class="text-button"
										onclick={() => create('tag')}
										disabled={!status?.ready}><Plus /> Tag</button
									><button
										class="text-button"
										onclick={() => create('collection')}
										disabled={!status?.ready}><Plus /> Collection</button
									>
								</div>
							</div>
							<div class="settings-card">
								<div class="filter-search">
									<Search /><input
										aria-label="Find tags, collections or saved searches"
										placeholder="Find tags & collections…"
										bind:value={query}
									/>
								</div>
								<div class="account-organizations">
									{#each entries.slice(0, 12) as entry (`${entry.table}:${entry.row.id}`)}<button
											class="setting-row organization-row"
											onclick={() => {
												open = false;
												onManage(entry);
											}}
											><span class="setting-icon"
												>{#if entry.table === 'tags'}<Hash
													/>{:else if entry.table === 'collections'}<Folder />{:else}<Search
													/>{/if}</span
											><span>{entry.row.name}</span><ChevronRight /></button
										>{:else}<p class="picker-empty">
											{query
												? 'No matching names.'
												: 'Create a tag or collection to organize your links.'}
										</p>{/each}
								</div>
								{#if entries.length > 12}<p class="filter-footer">
										12 of {entries.length} · type to narrow
									</p>{/if}
							</div>
						</section>
						<section class="settings-group">
							<h3>Import & export</h3>
							<div class="settings-card">
								<button class="setting-row" onclick={onExport} disabled={!status?.ready}
									><span class="setting-icon"><Download /></span><span
										><strong>Export library</strong><small>Bookmarks, notes and connections</small
										></span
									><ChevronRight /></button
								><label class="setting-row import-row"
									><span class="setting-icon"><Upload /></span><span
										><strong>Import library</strong><small>Choose a Prism JSON export</small></span
									><ChevronRight /><input
										type="file"
										accept="application/json,.json"
										aria-label="Import library"
										onchange={(event) => {
											open = false;
											onImport(event);
										}}
										disabled={!status?.ready}
									/></label
								><button class="setting-row" onclick={onExportPending} disabled={!status?.ready}
									><span class="setting-icon"><Download /></span><span
										>Export pending work & drafts</span
									><ChevronRight /></button
								>
							</div>
						</section>
						<details class="settings-advanced">
							<summary>Advanced</summary><button
								class="secondary-button"
								disabled={!status?.online || !status?.ready}
								onclick={onMaintenance}>Run pending profile cleanup</button
							>
							<p class="muted">
								Exports contain metadata, not media files. Cached library data is not end-to-end
								encrypted.
							</p>
						</details>
					</Tabs.Content>
					<Tabs.Content value="shortcuts"><KeyboardHelp /></Tabs.Content>
				</div>
			</Tabs.Root>
			{#if toast}<p class="account-message" role="status"><Check />{toast}</p>{/if}
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
