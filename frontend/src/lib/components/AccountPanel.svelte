<script lang="ts">
	import { Collapsible, Dialog, Select } from 'bits-ui';
	import { soundPreference, setSounds, cue } from '#lib/client/sounds.svelte.js';
	import {
		cornersPreference,
		listPreference,
		setMinimalList,
		setToolbarHidden,
		toolbarPreference,
		setSquareCorners
	} from '#lib/client/theme.svelte.js';
	import ThemeSettings from './settings/ThemeSettings.svelte';
	import { resolve } from '$app/paths';
	import {
		Volume2,
		VolumeX,
		ChevronLeft,
		SlidersHorizontal,
		Palette,
		Square,
		Squircle,
		Rows3,
		AlignLeft,
		PanelTop,
		PanelTopDashed,
		Library,
		RefreshCw,
		Cloud,
		CloudOff,
		ChevronRight,
		ChevronDown,
		Download,
		Upload,
		LogOut,
		LockKeyhole,
		Lock,
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
	import { syncSummary } from '#lib/client/sync-status.js';
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
		onExportBrowser,
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
		onExportBrowser: () => void;
		onImport: (event: Event) => void;
		onExportPending: () => void;
		onMaintenance: () => void;
	} = $props();
	type Section = 'general' | 'appearance' | 'extension' | 'library' | 'account';
	// On a phone the sections are a list you drill into; `drilled` is whether one is open.
	// On wider screens the rail and the open section sit side by side.
	let section = $state<Section>('general'),
		drilled = $state(false),
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
	// Private tags (hidden from the public page) are marked with a lock; edit one to change it.
	const isPrivate = (row: Row) => row.isPrivate === true;
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
			section = 'general';
			drilled = false;
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
	const sync = $derived(syncSummary(status));
	const sections = $derived([
		{ id: 'general', label: 'General', icon: SlidersHorizontal, hint: '' },
		{
			id: 'appearance',
			label: 'Appearance',
			icon: Palette,
			hint: [
				listPreference.minimal && 'Minimal list',
				toolbarPreference.hidden && 'No list header',
				cornersPreference.square && 'Square corners'
			]
				.filter(Boolean)
				.join(' · ')
		},
		{
			id: 'extension',
			label: 'Browser extension',
			icon: Puzzle,
			hint: extensionConnections.length ? `${extensionConnections.length} connected` : 'Not paired'
		},
		{
			id: 'library',
			label: 'Library',
			icon: Library,
			hint: `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`
		},
		{ id: 'account', label: 'Account', icon: LockKeyhole, hint: '' }
	] as const);
	const current = $derived(sections.find((entry) => entry.id === section)!);
	let themePage = $state<'main' | 'themes'>('main');
	function openSection(next: Section) {
		section = next;
		themePage = 'main';
		drilled = true;
	}
</script>

<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay settings-overlay" /><Dialog.Content
			class="settings-sheet"
			onOpenAutoFocus={(event) => {
				// Land on the sheet itself, so opening with the mouse doesn't light a focus ring on the
				// first row; Tab still moves straight into the sections.
				event.preventDefault();
				document.querySelector<HTMLElement>('.settings-sheet')?.focus();
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				// The sidebar and the mobile navbar both render one; only the visible one can take focus.
				[...document.querySelectorAll<HTMLButtonElement>('.account-button')]
					.find((button) => button.offsetParent)
					?.focus();
			}}
		>
			<Dialog.Description class="sr-only"
				>Manage your account, sync, and library.</Dialog.Description
			>
			<span class="settings-grabber" aria-hidden="true"></span>
			<div class="settings-shell" class:drilled>
				<nav class="settings-nav" aria-label="Settings sections">
					<header class="settings-nav-head">
						<Dialog.Title class="settings-title">Settings</Dialog.Title>
						<Dialog.Close
							class="icon-button settings-close settings-close-nav"
							aria-label="Close settings"><X /></Dialog.Close
						>
					</header>
					<p class="settings-sync-pill" data-tone={sync.tone}>
						<span class="settings-dot" aria-hidden="true"></span>{sync.title}
					</p>
					<!-- One raised tab glides between sections, as in the library sidebar. -->
					<div
						class="settings-nav-rail"
						style={`--settings-index: ${sections.findIndex((entry) => entry.id === section)}`}
					>
						<span class="settings-nav-indicator" aria-hidden="true"></span>
						<ul class="settings-nav-list">
							{#each sections as entry (entry.id)}<li>
									<button
										class="settings-nav-item"
										aria-current={section === entry.id ? 'page' : undefined}
										onclick={() => openSection(entry.id)}
										><span class="settings-nav-icon"><entry.icon /></span><span
											class="settings-nav-label">{entry.label}</span
										>{#if entry.hint}<small>{entry.hint}</small>{/if}<ChevronRight
											class="settings-nav-go"
										/></button
									>
								</li>{/each}
						</ul>
					</div>
				</nav>

				<div class="settings-pane">
					<header class="settings-pane-head">
						<button class="settings-back" onclick={() => (drilled = false)}
							><ChevronLeft />Settings</button
						>
						<h2>{current.label}</h2>
						<Dialog.Close class="icon-button settings-close" aria-label="Close settings"
							><X /></Dialog.Close
						>
					</header>
					{#key section}<div class="settings-scroll">
							{#if section === 'general'}
								<section class="settings-group">
									<h3>Sync</h3>
									<div class="settings-card">
										<div class="settings-row">
											<span class="settings-status" data-tone={sync.tone} aria-hidden="true"
												>{#if status?.online}<Cloud />{:else}<CloudOff />{/if}</span
											><span class="settings-text"
												><strong>{sync.title}</strong><small
													>{status?.pending
														? `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} saved on this device`
														: status?.online
															? 'Your library stays in sync across devices'
															: 'Changes sync when you reconnect'}</small
												></span
											><button
												class="settings-action"
												disabled={!status?.online || status?.loading}
												onclick={() => library?.sync()}
												><RefreshCw class={status?.loading ? 'spinning' : ''} />{status?.loading
													? 'Syncing'
													: 'Sync'}</button
											>
										</div>
										{#if status?.error}<p class="settings-note settings-error">
												<AlertCircle />{status.error}
											</p>{/if}
										{#if status?.conflicts.length}<Collapsible.Root class="conflict-review">
												<Collapsible.Trigger class="settings-row conflict-trigger"
													><span class="settings-status" data-tone="warn" aria-hidden="true"
														><AlertCircle /></span
													><span class="settings-text"
														><strong
															>{status.conflicts.length}
															{status.conflicts.length === 1 ? 'change needs' : 'changes need'} review</strong
														><small>Keeping the saved version discards the pending change</small
														></span
													><ChevronDown
														class="settings-glyph conflict-chevron"
													/></Collapsible.Trigger
												>
												<Collapsible.Content class="conflict-content">
													<ul class="conflict-list">
														{#each status.conflicts as conflict (conflict.operationId)}<li
																class="conflict-entry"
															>
																<span class="settings-text"
																	><strong>{changeLabel(conflict.envelope.command.type)}</strong
																	><small
																		>{conflict.error?.message ??
																			'This change could not be synced.'}</small
																	></span
																>
																<button
																	class="settings-action"
																	disabled={resolving.includes(conflict.operationId)}
																	onclick={() => keepSaved(conflict.operationId)}
																	>{resolving.includes(conflict.operationId)
																		? 'Updating…'
																		: 'Keep saved'}</button
																>
															</li>{/each}
													</ul>
													<p class="settings-note">Note drafts are kept either way.</p>
													{#if conflictError}<p class="form-error" role="alert">
															{conflictError}
														</p>{/if}
												</Collapsible.Content>
											</Collapsible.Root>{/if}
									</div>
								</section>
							{:else if section === 'appearance'}
								<ThemeSettings {library} changed={status} {feedback} bind:page={themePage} />
								{#if themePage === 'main'}<section class="settings-group">
										<h3>Look and feel</h3>
										<div class="settings-card">
											<button
												class="settings-row"
												role="switch"
												aria-checked={listPreference.minimal}
												onclick={() => setMinimalList(!listPreference.minimal)}
												><span class="settings-text"
													><strong>Minimal list</strong><small
														>One centred column: title and site on a single line</small
													></span
												>{#if listPreference.minimal}<AlignLeft
														class="settings-glyph"
													/>{:else}<Rows3 class="settings-glyph" />{/if}<span
													class="preference-switch"
													class:enabled={listPreference.minimal}><span></span></span
												></button
											>
											<button
												class="settings-row"
												role="switch"
												aria-checked={!toolbarPreference.hidden}
												onclick={() => setToolbarHidden(!toolbarPreference.hidden)}
												><span class="settings-text"
													><strong>List header</strong><small
														>The sort and shortcuts bar above your bookmarks</small
													></span
												>{#if toolbarPreference.hidden}<PanelTopDashed
														class="settings-glyph"
													/>{:else}<PanelTop class="settings-glyph" />{/if}<span
													class="preference-switch"
													class:enabled={!toolbarPreference.hidden}><span></span></span
												></button
											>
											<button
												class="settings-row"
												role="switch"
												aria-checked={cornersPreference.square}
												onclick={() => setSquareCorners(!cornersPreference.square)}
												><span class="settings-text"
													><strong>Square corners</strong><small
														>A flat, squared look instead of rounded edges</small
													></span
												>{#if cornersPreference.square}<Square
														class="settings-glyph"
													/>{:else}<Squircle class="settings-glyph" />{/if}<span
													class="preference-switch"
													class:enabled={cornersPreference.square}><span></span></span
												></button
											>
											<button
												class="settings-row"
												role="switch"
												aria-checked={soundPreference.enabled}
												onclick={() => {
													setSounds(!soundPreference.enabled);
													if (soundPreference.enabled) cue('success');
												}}
												><span class="settings-text"
													><strong>Sounds</strong><small>Quiet cues for saves and errors</small
													></span
												>{#if soundPreference.enabled}<Volume2
														class="settings-glyph"
													/>{:else}<VolumeX class="settings-glyph" />{/if}<span
													class="preference-switch"
													class:enabled={soundPreference.enabled}><span></span></span
												></button
											>
										</div>
									</section>{/if}
							{:else if section === 'extension'}
								<section class="settings-group">
									<p class="settings-lede">
										Save posts and pages from Firefox or Chrome. Pair once with a short-lived code;
										revoke a browser any time.
									</p>
									<div class="settings-card">
										<div class="settings-row settings-pair">
											<span class="settings-text"><strong>New pairing code</strong></span>
											<span class="settings-pair-controls">
												<Select.Root
													type="single"
													value={String(pairingLifetime)}
													onValueChange={(value) => (pairingLifetime = Number(value))}
													items={pairingLifetimes}
													><Select.Trigger
														class="settings-select"
														aria-label="Pairing code lifetime"
														>{pairingLifetime} min<ChevronDown /></Select.Trigger
													><Select.Portal
														><Select.Content class="select-content" sideOffset={5} align="end"
															><Select.Viewport
																>{#each pairingLifetimes as option (option.value)}<Select.Item
																		class="select-item"
																		value={option.value}
																		label={option.label}
																		>{#snippet children({ selected })}<span>{option.label}</span
																			>{#if selected}<Check
																					class="select-check"
																				/>{/if}{/snippet}</Select.Item
																	>{/each}</Select.Viewport
															></Select.Content
														></Select.Portal
													></Select.Root
												>
												<button
													class="settings-action primary"
													onclick={generatePairing}
													disabled={extensionBusy || !status?.online}
													>{extensionBusy ? 'Working…' : 'Generate'}</button
												>
											</span>
										</div>
										{#if pairingCode}<div class="settings-code">
												<code>{pairingCode}</code>
												<div>
													<small
														>Works once · expires {new Date(pairingExpiresAt).toLocaleTimeString(
															[],
															{
																hour: 'numeric',
																minute: '2-digit'
															}
														)}</small
													>
													<button class="settings-action" onclick={copyPairingCode}
														>{#if pairingCopied}<Check /> Copied{:else}<Copy /> Copy{/if}</button
													>
												</div>
											</div>{/if}
									</div>
								</section>
								<section class="settings-group">
									<h3>Connected browsers</h3>
									<div class="settings-card">
										{#each extensionConnections as connection (connection.id)}<div
												class="settings-row"
											>
												<span class="settings-status" aria-hidden="true"><Globe /></span><span
													class="settings-text"
													><strong>{connection.name}</strong><small
														>Paired {new Date(connection.createdAt).toLocaleDateString()}</small
													></span
												><button
													class="settings-action danger"
													onclick={() => revokeExtension(connection.id)}
													disabled={extensionBusy}>Revoke</button
												>
											</div>{:else}<p class="settings-empty">No browsers paired yet.</p>{/each}
										{#if extensionError}<p class="settings-note settings-error" role="alert">
												<AlertCircle />{extensionError}
											</p>{/if}
									</div>
								</section>
							{:else if section === 'library'}
								<section class="settings-group">
									<div class="settings-group-head">
										<h3>Tags</h3>
										<button
											class="settings-link"
											onclick={() => create('tag')}
											disabled={!status?.ready}><Plus /> New</button
										>
									</div>
									<div class="settings-card">
										{#if tags.length > 6}<label class="settings-search"
												><Search /><input
													aria-label="Find tags"
													placeholder="Find a tag"
													bind:value={query}
												/></label
											>{/if}
										{#each entries.slice(0, 12) as entry (`${entry.table}:${entry.row.id}`)}<button
												class="settings-row"
												onclick={() => {
													open = false;
													onManage(entry);
												}}
												>{#if isPrivate(entry.row)}<Lock
														class="settings-glyph"
														aria-label="Private"
													/>{:else}<Folder class="settings-glyph" />{/if}<span class="settings-text"
													><strong>{entry.row.name}</strong></span
												><ChevronRight class="settings-glyph" /></button
											>{:else}<p class="settings-empty">
												{query ? 'No matching tags.' : 'Create a tag to organize your links.'}
											</p>{/each}
										{#if entries.length > 12}<p class="settings-note">
												12 of {entries.length} · type to narrow
											</p>{/if}
									</div>
								</section>
								<section class="settings-group">
									<h3>Data</h3>
									<div class="settings-card">
										<button class="settings-row" onclick={onExport} disabled={!status?.ready}
											><Download class="settings-glyph" /><span class="settings-text"
												><strong>Export library</strong><small
													>Prism JSON with notes, people and connections</small
												></span
											></button
										><button
											class="settings-row"
											onclick={onExportBrowser}
											disabled={!status?.ready}
											><Download class="settings-glyph" /><span class="settings-text"
												><strong>Export browser bookmarks</strong><small
													>HTML file for Chrome, Firefox, Safari or Edge</small
												></span
											></button
										><label class="settings-row import-row"
											><Upload class="settings-glyph" /><span class="settings-text"
												><strong>Import bookmarks</strong><small
													>Browser bookmarks HTML or a Prism JSON export</small
												></span
											><input
												type="file"
												accept="application/json,.json,text/html,.html,.htm"
												aria-label="Import bookmarks"
												onchange={(event) => {
													open = false;
													onImport(event);
												}}
												disabled={!status?.ready}
											/></label
										><button
											class="settings-row"
											onclick={onExportPending}
											disabled={!status?.ready}
											><Download class="settings-glyph" /><span class="settings-text"
												><strong>Export pending work</strong><small
													>Unsynced changes and drafts</small
												></span
											></button
										><button
											class="settings-row"
											disabled={!status?.online || !status?.ready}
											onclick={onMaintenance}
											><Wrench class="settings-glyph" /><span class="settings-text"
												><strong>Finish profile cleanup</strong><small
													>Completes pending person removals</small
												></span
											></button
										>
									</div>
									<p class="settings-footnote">
										Neither export is a full backup: media files and note history are not included.
										Browser HTML holds links, descriptions, dates, collections and public tags;
										Prism JSON also keeps notes, people and connections. The cached library on this
										device is not end-to-end encrypted.
									</p>
								</section>
							{:else}
								<section class="settings-group">
									<div class="settings-card">
										<a class="settings-row" href={resolve('/auth/sign-in')}
											><LockKeyhole class="settings-glyph" /><span class="settings-text"
												><strong>Sign-in & password</strong></span
											><ChevronRight class="settings-glyph" /></a
										>
									</div>
								</section>
								<section class="settings-group">
									<form method="POST" action={`${resolve('/auth/sign-in')}?/signOut`}>
										<button class="settings-signout" disabled={!status?.online}
											><LogOut />Sign out</button
										>
									</form>
								</section>
							{/if}
						</div>{/key}
					{#if toast}<p class="settings-toast" role="status"><Check />{toast}</p>{/if}
				</div>
			</div>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
