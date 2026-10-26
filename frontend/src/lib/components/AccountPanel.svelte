<script lang="ts">
	import { Collapsible, Dialog, Select, Tabs } from 'bits-ui';
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
		AlertCircle,
		Copy,
		Globe,
		Puzzle,
		Wrench
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
	const pairingLifetimes = [5, 15, 60].map((m) => ({ value: String(m), label: `${m} min` }));
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
	const themes = [
		{ value: 'dark', label: 'Dark' },
		{ value: 'light', label: 'Light' }
	] as const;
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
				<Dialog.Title class="dialog-title">Settings</Dialog.Title><Dialog.Description
					class="sr-only">Manage your account, sync, and library.</Dialog.Description
				>
				<Dialog.Close class="icon-button" aria-label="Close settings"><X /></Dialog.Close>
			</header>
			<Tabs.Root bind:value={tab} class="account-body">
				<Tabs.List class="segmented account-tabs" aria-label="Settings sections"
					><Tabs.Trigger value="account">General</Tabs.Trigger><Tabs.Trigger value="library"
						>Library</Tabs.Trigger
					></Tabs.List
				>
				<div class="account-scroll">
					<Tabs.Content value="account" class="account-tab">
						<section class="settings-group">
							<h3 class="settings-label">Appearance</h3>
							<div class="settings-card">
								<div class="setting-row">
									<span class="setting-icon"
										>{#if themePreference.value === 'light'}<Sun />{:else}<Moon />{/if}</span
									><span class="setting-text"
										><strong>Theme</strong><small>Charcoal or warm paper</small></span
									>
									<div class="segmented setting-trailing" role="radiogroup" aria-label="Theme">
										{#each themes as option (option.value)}<button
												role="radio"
												aria-checked={themePreference.value === option.value}
												data-state={themePreference.value === option.value ? 'active' : undefined}
												onclick={() => setTheme(option.value)}>{option.label}</button
											>{/each}
									</div>
								</div>
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
									><span class="setting-text"
										><strong>Subtle sounds</strong><small
											>Quiet feedback for meaningful moments</small
										></span
									><span
										class="preference-switch setting-trailing"
										class:enabled={soundPreference.enabled}><span></span></span
									></button
								>
							</div>
						</section>
						<section class="settings-group">
							<h3 class="settings-label">Sync</h3>
							<div class="settings-card">
								<div class="setting-row">
									<span class="setting-icon"
										>{#if status?.online}<Cloud />{:else}<CloudOff />{/if}</span
									><span class="setting-text"
										><strong
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
										><small
											>{status?.pending
												? `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} saved on this device`
												: status?.online
													? 'Your library stays in sync across devices'
													: 'Changes sync when you reconnect'}</small
										></span
									><button
										class="secondary-button setting-trailing"
										disabled={!status?.online || status?.loading}
										onclick={() => library?.sync()}
										><RefreshCw class={status?.loading ? 'spinning' : ''} />{status?.loading
											? 'Syncing…'
											: 'Sync now'}</button
									>
								</div>
								{#if status?.error}<p class="setting-note setting-error">
										<AlertCircle />{status.error}
									</p>{/if}
								{#if status?.conflicts.length}<Collapsible.Root class="conflict-review">
										<Collapsible.Trigger class="setting-row conflict-trigger"
											><span class="setting-icon"><AlertCircle /></span><span class="setting-text"
												><strong
													>{status.conflicts.length}
													{status.conflicts.length === 1 ? 'change needs' : 'changes need'} review</strong
												><small>Keeping the saved version discards the pending change</small></span
											><ChevronDown class="setting-trailing" /></Collapsible.Trigger
										>
										<Collapsible.Content class="conflict-content">
											<ul class="conflict-list">
												{#each status.conflicts as conflict (conflict.operationId)}<li
														class="conflict-entry"
													>
														<span class="setting-text"
															><strong>{changeLabel(conflict.envelope.command.type)}</strong><small
																>{conflict.error?.message ??
																	'This change could not be synced.'}</small
															></span
														>
														<button
															class="text-button"
															disabled={resolving.includes(conflict.operationId)}
															onclick={() => keepSaved(conflict.operationId)}
															>{resolving.includes(conflict.operationId)
																? 'Updating…'
																: 'Keep saved'}</button
														>
													</li>{/each}
											</ul>
											<p class="setting-note">Note drafts are kept either way.</p>
											{#if conflictError}<p class="form-error" role="alert">{conflictError}</p>{/if}
										</Collapsible.Content>
									</Collapsible.Root>{/if}
							</div>
						</section>
						<section class="settings-group">
							<h3 class="settings-label">Firefox extension</h3>
							<div class="settings-card">
								<div class="setting-row">
									<span class="setting-icon"><Puzzle /></span><span class="setting-text"
										><strong>Pair a browser</strong><small
											>A one-time code, revocable any time</small
										></span
									>
									<span class="setting-trailing extension-pairing-controls">
										<Select.Root
											type="single"
											value={String(pairingLifetime)}
											onValueChange={(value) => (pairingLifetime = Number(value))}
											items={pairingLifetimes}
											><Select.Trigger
												class="secondary-button select-trigger"
												aria-label="Pairing code lifetime"
												>{pairingLifetime} min<ChevronDown /></Select.Trigger
											><Select.Portal
												><Select.Content class="select-content" sideOffset={5} align="end"
													><Select.Viewport
														>{#each pairingLifetimes as option (option.value)}<Select.Item
																class="select-item"
																value={option.value}
																label={option.label}
																>{#snippet children({ selected })}{option.label}{#if selected}<Check
																			class="select-check"
																		/>{/if}{/snippet}</Select.Item
															>{/each}</Select.Viewport
													></Select.Content
												></Select.Portal
											></Select.Root
										>
										<button
											class="secondary-button"
											onclick={generatePairing}
											disabled={extensionBusy || !status?.online}
											>{extensionBusy ? 'Working…' : 'Generate'}</button
										>
									</span>
								</div>
								{#if pairingCode}<div class="extension-pairing-code">
										<code>{pairingCode}</code>
										<button class="secondary-button" onclick={copyPairingCode}
											>{#if pairingCopied}<Check /> Copied{:else}<Copy /> Copy{/if}</button
										>
										<small
											>Works once · expires {new Date(pairingExpiresAt).toLocaleTimeString([], {
												hour: 'numeric',
												minute: '2-digit'
											})}</small
										>
									</div>{/if}
								{#each extensionConnections as connection (connection.id)}<div class="setting-row">
										<span class="setting-icon"><Globe /></span><span class="setting-text"
											><strong>{connection.name}</strong><small
												>Connected {new Date(connection.createdAt).toLocaleDateString()}</small
											></span
										><button
											class="text-button setting-trailing"
											onclick={() => revokeExtension(connection.id)}
											disabled={extensionBusy}>Revoke</button
										>
									</div>{:else}<p class="setting-note">No browsers connected yet.</p>{/each}
								{#if extensionError}<p class="setting-note setting-error" role="alert">
										<AlertCircle />{extensionError}
									</p>{/if}
							</div>
						</section>
						<section class="settings-group">
							<h3 class="settings-label">Account</h3>
							<div class="settings-card">
								<a class="setting-row" href={resolve('/auth/sign-in')}
									><span class="setting-icon"><LockKeyhole /></span><span class="setting-text"
										><strong>Sign-in & password</strong></span
									><ChevronRight class="setting-trailing" /></a
								>
								<form method="POST" action={`${resolve('/auth/sign-in')}?/signOut`}>
									<button class="setting-row" disabled={!status?.online}
										><span class="setting-icon"><LogOut /></span><span class="setting-text"
											><strong>Sign out</strong></span
										><ChevronRight class="setting-trailing" /></button
									>
								</form>
							</div>
						</section>
					</Tabs.Content>
					<Tabs.Content value="library" class="account-tab">
						<section class="settings-group">
							<div class="settings-label-row">
								<h3 class="settings-label">Tags</h3>
								<button class="text-button" onclick={() => create('tag')} disabled={!status?.ready}
									><Plus /> New tag</button
								>
							</div>
							<div class="settings-card">
								<label class="setting-search"
									><Search /><input
										aria-label="Find tags"
										placeholder="Find tags…"
										bind:value={query}
									/></label
								>
								{#each entries.slice(0, 12) as entry (`${entry.table}:${entry.row.id}`)}<button
										class="setting-row"
										onclick={() => {
											open = false;
											onManage(entry);
										}}
										><span class="setting-icon"><Folder /></span><span class="setting-text"
											><strong>{entry.row.name}</strong></span
										><ChevronRight class="setting-trailing" /></button
									>{:else}<p class="setting-note">
										{query ? 'No matching tags.' : 'Create a tag to organize your links.'}
									</p>{/each}
								{#if entries.length > 12}<p class="setting-note">
										12 of {entries.length} · type to narrow
									</p>{/if}
							</div>
						</section>
						<section class="settings-group">
							<h3 class="settings-label">Import & export</h3>
							<div class="settings-card">
								<button class="setting-row" onclick={onExport} disabled={!status?.ready}
									><span class="setting-icon"><Download /></span><span class="setting-text"
										><strong>Export library</strong><small>Bookmarks, notes and connections</small
										></span
									><ChevronRight class="setting-trailing" /></button
								><label class="setting-row import-row"
									><span class="setting-icon"><Upload /></span><span class="setting-text"
										><strong>Import library</strong><small>Choose a Prism JSON export</small></span
									><ChevronRight class="setting-trailing" /><input
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
									><span class="setting-icon"><Download /></span><span class="setting-text"
										><strong>Export pending work</strong><small>Unsynced changes and drafts</small
										></span
									><ChevronRight class="setting-trailing" /></button
								>
							</div>
						</section>
						<section class="settings-group">
							<h3 class="settings-label">Advanced</h3>
							<div class="settings-card">
								<div class="setting-row">
									<span class="setting-icon"><Wrench /></span><span class="setting-text"
										><strong>Profile cleanup</strong><small>Finish pending person removals</small
										></span
									><button
										class="secondary-button setting-trailing"
										disabled={!status?.online || !status?.ready}
										onclick={onMaintenance}>Run</button
									>
								</div>
								<p class="setting-note">
									Exports contain metadata, not media files. Cached library data is not end-to-end
									encrypted.
								</p>
							</div>
						</section>
					</Tabs.Content>
				</div>
			</Tabs.Root>
			{#if toast}<p class="account-message" role="status"><Check />{toast}</p>{/if}
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
