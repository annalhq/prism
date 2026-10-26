<script lang="ts">
	import { Collapsible, Dialog, Tabs } from 'bits-ui';
	import { soundPreference, setSounds, cue } from '#lib/client/sounds.svelte.js';
	import { themePreference, setTheme } from '#lib/client/theme.svelte.js';
	import { Volume2, VolumeX, Sun, Moon } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import {
		RefreshCw,
		Cloud,
		CloudOff,
		ChevronRight,
		ChevronDown,
		Download,
		Upload,
		LogOut,
		LockKeyhole,
		Plus,
		Search,
		X,
		Folder,
		Check,
		AlertCircle
	} from '@lucide/svelte';
	import type { LibraryClient, LibraryState } from '#lib/client/vault/library.js';
	type Row = Record<string, unknown>;
	type Entry = { table: 'tags'; row: Row };
	type ExtensionConnection = {
		id: string;
		name: string;
		createdAt: string;
		lastUsedAt: string | null;
	};
	let {
		open = $bindable(false),
		library,
		status,
		tags,
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
	let resolving = $state<string[]>([]),
		conflictError = $state('');
	let extensionConnections = $state<ExtensionConnection[]>([]),
		extensionBusy = $state(false),
		extensionError = $state(''),
		pairingCopied = $state(false),
		pairingCode = $state(''),
		pairingExpiresAt = $state(''),
		pairingLifetime = $state(15);
	async function loadExtensionConnections() {
		try {
			const response = await fetch('/api/v1/account/extensions', { cache: 'no-store' });
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'Could not load extension connections.');
			extensionConnections = result.connections;
		} catch (error) {
			extensionError = (error as Error).message;
		}
	}
	async function generatePairing() {
		extensionBusy = true;
		extensionError = '';
		pairingCopied = false;
		pairingCode = '';
		try {
			const response = await fetch('/api/v1/account/extensions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expiresInMinutes: pairingLifetime })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'Could not create a pairing code.');
			pairingCode = result.code;
			pairingExpiresAt = result.expiresAt;
		} catch (error) {
			extensionError = (error as Error).message;
		} finally {
			extensionBusy = false;
		}
	}
	async function copyPairingCode() {
		try {
			await navigator.clipboard.writeText(pairingCode);
			pairingCopied = true;
			setTimeout(() => (pairingCopied = false), 1800);
		} catch {
			extensionError = 'Clipboard access was unavailable. Select and copy the code manually.';
		}
	}
	async function revokeExtension(id: string) {
		extensionBusy = true;
		extensionError = '';
		try {
			const response = await fetch(`/api/v1/account/extensions?id=${encodeURIComponent(id)}`, {
				method: 'DELETE'
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'Could not revoke the connection.');
			extensionConnections = extensionConnections.filter((connection) => connection.id !== id);
		} catch (error) {
			extensionError = (error as Error).message;
		} finally {
			extensionBusy = false;
		}
	}
	function changeLabel(type: string) {
		if (type.startsWith('person-identity.')) return 'Profile connection';
		if (type.startsWith('bookmark.')) return 'Bookmark change';
		if (type.startsWith('note.')) return 'Note change';
		if (type.startsWith('person.')) return 'Person change';
		return 'Library change';
	}
	async function keepSaved(operationId: string) {
		if (!library || resolving.includes(operationId)) return;
		resolving = [...resolving, operationId];
		conflictError = '';
		try {
			await library.resolveConflict(operationId, 'remote');
			feedback('Kept the saved version. Note drafts are preserved.');
		} catch (error) {
			conflictError = (error as Error).message;
		} finally {
			resolving = resolving.filter((id) => id !== operationId);
		}
	}
	const entries = $derived(
		tags
			.map((row) => ({ table: 'tags' as const, row }))
			.filter((entry) =>
				String(entry.row.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
			)
	);

	$effect(() => {
		if (open) {
			void loadExtensionConnections();
		} else {
			query = '';
			tab = 'account';
			conflictError = '';
			pairingCode = '';
			pairingCopied = false;
			extensionError = '';
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
				// The sidebar and the mobile navbar both render one; only the visible one can take focus.
				[...document.querySelectorAll<HTMLButtonElement>('.account-button')]
					.find((button) => button.offsetParent)
					?.focus();
			}}
		>
			<header class="account-panel-header">
				<div>
					<Dialog.Title class="dialog-title">Account & settings</Dialog.Title><Dialog.Description
						class="sr-only">Manage your account, sync, and library.</Dialog.Description
					>
				</div>
				<Dialog.Close class="icon-button" aria-label="Close library settings"><X /></Dialog.Close>
			</header>
			<Tabs.Root bind:value={tab} class="account-body">
				<Tabs.List class="account-tabs" aria-label="Account sections"
					><Tabs.Trigger value="account">Account</Tabs.Trigger><Tabs.Trigger value="library"
						>Library</Tabs.Trigger
					></Tabs.List
				>
				<div class="account-scroll">
					<Tabs.Content value="account">
						<section class="settings-group">
							<h3>Preferences</h3>
							<div class="settings-card">
								<button
									class="setting-row"
									role="switch"
									aria-checked={soundPreference.enabled}
									onclick={() => {
										setSounds(!soundPreference.enabled);
										if (soundPreference.enabled) cue('success');
									}}
									><span class="setting-icon"
										>{#if soundPreference.enabled}<Volume2 />{:else}<VolumeX />{/if}</span
									><span
										><strong>Subtle sounds</strong><small
											>Quiet feedback for meaningful moments</small
										></span
									><span class="preference-switch" class:enabled={soundPreference.enabled}
										><span></span></span
									></button
								>
								<button
									class="setting-row"
									role="switch"
									aria-checked={themePreference.value === 'light'}
									onclick={() => setTheme(themePreference.value === 'light' ? 'dark' : 'light')}
									><span class="setting-icon"
										>{#if themePreference.value === 'light'}<Sun />{:else}<Moon />{/if}</span
									><span
										><strong>Light appearance</strong><small>Warm paper tones instead of dark</small
										></span
									><span class="preference-switch" class:enabled={themePreference.value === 'light'}
										><span></span></span
									></button
								>
							</div>
						</section>
						<section class="settings-group">
							<h3>Connection & sync</h3>
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
													? 'Sync needs review'
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
													? 'Connected · Your library stays in sync across devices.'
													: 'Your changes will sync when you reconnect.'}
										</p>
									</div>
								</div>
								<button
									class="text-button sync-button"
									disabled={!status?.online || status?.loading}
									onclick={() => library?.sync()}
									><RefreshCw class={status?.loading ? 'spinning' : ''} />{status?.loading
										? 'Syncing…'
										: 'Sync now'}</button
								>
								{#if status?.error}<p class="sync-error"><AlertCircle />{status.error}</p>{/if}
							</div>
						</section>
						{#if status?.conflicts.length}<Collapsible.Root class="settings-group conflict-review">
								<Collapsible.Trigger class="conflict-trigger">
									<AlertCircle /><span
										>{status.conflicts.length}
										{status.conflicts.length === 1 ? 'change needs' : 'changes need'} review</span
									><ChevronDown />
								</Collapsible.Trigger>
								<Collapsible.Content class="conflict-content">
									<ul class="conflict-list">
										{#each status.conflicts as conflict (conflict.operationId)}<li
												class="conflict-entry"
											>
												<strong>{changeLabel(conflict.envelope.command.type)}</strong>
												<p>{conflict.error?.message ?? 'This change could not be synced.'}</p>
												<button
													class="text-button"
													disabled={resolving.includes(conflict.operationId)}
													onclick={() => keepSaved(conflict.operationId)}
													>{resolving.includes(conflict.operationId)
														? 'Updating…'
														: 'Keep saved version'}</button
												>
											</li>{/each}
									</ul>
									<p class="conflict-help">
										Keeping the saved version discards that pending change. Note drafts are kept.
									</p>
									{#if conflictError}<p class="form-error" role="alert">{conflictError}</p>{/if}
								</Collapsible.Content>
							</Collapsible.Root>{/if}
						<section class="settings-group">
							<h3>Firefox extension</h3>
							<div class="settings-card extension-connections">
								<p class="muted">
									Create a one-time code to connect Firefox. The extension can read tag and person
									names and save bookmarks; revoke access here at any time.
								</p>
								<div class="button-row extension-pairing-controls">
									<label>
										<span class="sr-only">Pairing code lifetime</span>
										<select aria-label="Pairing code lifetime" bind:value={pairingLifetime}>
											<option value={5}>5 minutes</option>
											<option value={15}>15 minutes</option>
											<option value={60}>60 minutes</option>
										</select>
									</label>
									<button
										class="text-button"
										onclick={generatePairing}
										disabled={extensionBusy || !status?.online}
									>
										{extensionBusy ? 'Working…' : 'Generate pairing code'}
									</button>
								</div>
								{#if pairingCode}
									<div class="extension-pairing-code">
										<strong>Enter this code in Firefox</strong>
										<code>{pairingCode}</code>
										<button class="text-button" onclick={copyPairingCode}
											>{pairingCopied ? 'Copied' : 'Copy code'}</button
										>
										<small>Expires {new Date(pairingExpiresAt).toLocaleTimeString()}</small>
										<p class="muted">
											It works once. Close this panel after pairing to hide the code.
										</p>
									</div>
								{/if}
								{#if extensionConnections.length}
									<div class="extension-connection-list" aria-label="Connected extensions">
										{#each extensionConnections as connection (connection.id)}
											<div class="extension-connection-row">
												<span
													><strong>{connection.name}</strong><small
														>Connected {new Date(connection.createdAt).toLocaleDateString()}</small
													></span
												>
												<button
													class="text-button"
													onclick={() => revokeExtension(connection.id)}
													disabled={extensionBusy}>Revoke</button
												>
											</div>
										{/each}
									</div>
								{:else}<p class="picker-empty">No Firefox extension connections.</p>{/if}
								{#if extensionError}<p class="form-error" role="alert">{extensionError}</p>{/if}
							</div>
						</section>
						<section class="settings-group">
							<h3>Personal account</h3>
							<div class="settings-card">
								<a class="setting-row" href={resolve('/auth/sign-in')}
									><span class="setting-icon"><LockKeyhole /></span><span
										><strong>Sign-in & password</strong></span
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
									>
								</div>
							</div>
							<div class="settings-card">
								<div class="filter-search">
									<Search /><input
										aria-label="Find tags"
										placeholder="Find tags…"
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
											><span class="setting-icon"><Folder /></span><span>{entry.row.name}</span
											><ChevronRight /></button
										>{:else}<p class="picker-empty">
											{query ? 'No matching names.' : 'Create a tag to organize your links.'}
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
						<Collapsible.Root class="settings-advanced">
							<Collapsible.Trigger class="advanced-trigger"
								>Advanced <ChevronDown /></Collapsible.Trigger
							><Collapsible.Content class="stack"
								><button
									class="secondary-button"
									disabled={!status?.online || !status?.ready}
									onclick={onMaintenance}>Run pending profile cleanup</button
								>
								<p class="muted">
									Exports contain metadata, not media files. Cached library data is not end-to-end
									encrypted.
								</p>
							</Collapsible.Content></Collapsible.Root
						>
					</Tabs.Content>
				</div>
			</Tabs.Root>
			{#if toast}<p class="account-message" role="status"><Check />{toast}</p>{/if}
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
