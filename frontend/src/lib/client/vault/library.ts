import {
	MAX_COMMAND_BYTES,
	serializedBytes,
	type ChangeFrame,
	type Command,
	type CommandEnvelope,
	type CommandResult,
	type Revision
} from '#lib/domain/contracts.js';
import {
	BOOTSTRAP_BATCH_CAPABILITY,
	type BootstrapPage,
	type BootstrapStart,
	type ReplicaTable,
	type VaultIdentity
} from '#lib/domain/replica.js';
import { applyFrame, overlay, putRecord, type Records } from './projections.js';
import { VaultStorage, recordKey, type Draft, type PendingOperation } from './storage.js';
import { acknowledge, dependencies } from './queue.js';
import { perfMark } from '../perf.js';

export type SaveOutcome = {
	status: 'accepted' | 'queued' | 'rejected' | 'already_exists';
	message?: string;
	existingId?: string;
};
export type LibraryState = {
	// Status and draft updates must not invalidate cached list/search results.
	contentVersion: number;
	ready: boolean;
	loading: boolean;
	online: boolean;
	status: string;
	error: string | null;
	pending: number;
	conflicts: PendingOperation[];
	identity: VaultIdentity | null;
};
class HttpFailure extends Error {
	constructor(
		public status: number,
		message: string,
		public requestId?: string
	) {
		super(message);
	}
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		credentials: 'same-origin',
		cache: 'no-store',
		signal: AbortSignal.timeout(20_000),
		...init
	});
	if (response.status === 401 || response.status === 403)
		throw new HttpFailure(
			response.status,
			'Sign in again to sync. Your pending work is preserved on this device.'
		);
	const body = await response.text();
	if (new TextEncoder().encode(body).byteLength > MAX_COMMAND_BYTES)
		throw new Error('Server response exceeded the sync page limit.');
	let value;
	try {
		value = JSON.parse(body);
	} catch {
		throw new HttpFailure(response.status, 'The server returned an unreadable response.');
	}
	if (!response.ok && !(value && typeof value === 'object' && value.status === 'rejected'))
		throw new HttpFailure(
			response.status,
			value?.error?.message ?? value?.message ?? `Request failed (${response.status}).`,
			typeof value?.requestId === 'string' ? value.requestId : undefined
		);
	return value as T;
}
export function createLibraryClient(notify: () => void) {
	const state: LibraryState = {
		contentVersion: 0,
		ready: false,
		loading: false,
		online: typeof navigator !== 'undefined' ? navigator.onLine : true,
		status: 'Starting',
		error: null,
		pending: 0,
		conflicts: [],
		identity: null
	};
	let database: VaultStorage | undefined;
	let confirmed: Records = new Map();
	let visible: Records = new Map();
	let pending: PendingOperation[] = [];
	let drafts = new Map<string, Draft>();
	let cursor: string | undefined;
	let active = false;
	let syncing: Promise<void> | undefined;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let retryDelay = 1_000;
	// Idle reads back off while nothing changes; any activity returns to the first step.
	// Command delivery has its own retry timer and never waits on these.
	const IDLE_DELAYS = [30_000, 60_000, 120_000, 300_000];
	let idleLevel = 0;
	// Set by activity (focus, visibility, reconnection, a save): the sync it causes restarts the
	// backoff at its first step instead of counting as an unchanged idle pull.
	let activity = false;
	let lastFreshness = -Infinity;
	// Bumped with every committed write of confirmed records, so a reader can tell whether its
	// in-memory replica is current without reading every record back.
	let replicaVersion: string | undefined;
	let channel: BroadcastChannel | undefined;
	let peerChanged = false;
	// Whether the last successful sync sent commands or moved the cursor (i.e. found changes).
	let changedBySync = false;
	let scope = '';
	let published: Records = new Map();
	let publishedOwner = '';
	let publishedOperations = '';
	const tables = new Map<ReplicaTable, Record<string, unknown>[]>();
	let syncRequested = false;
	const awaitedOutcomes = new Map<string, SaveOutcome>();
	async function enqueue(envelope: CommandEnvelope, supersededOperationId?: string) {
		const db = database!;
		await db.transaction('rw', db.meta, db.outbox, async () => {
			// A shared transaction gives dependent commands a durable total order across tabs.
			const last = await db.meta.get('lastEnqueuedAt');
			const queued = await db.outbox.orderBy('createdAt').toArray();
			const latest = queued.at(-1);
			const timestamp = Math.max(
				Date.now(),
				(Number(last?.value) || 0) + 1,
				(latest ? Date.parse(latest.createdAt) : 0) + 1
			);
			await db.meta.put({ key: 'lastEnqueuedAt', value: String(timestamp) });
			const waitsFor = supersededOperationId ? {} : dependencies(envelope.command, queued);
			const blocked = queued.some(
				(item) => item.status === 'conflict' && Object.values(waitsFor).includes(item.operationId)
			);
			await db.outbox.add({
				operationId: envelope.operationId,
				envelope,
				createdAt: new Date(timestamp).toISOString(),
				status: blocked ? 'conflict' : 'pending',
				dependencies: waitsFor,
				...(blocked
					? {
							error: {
								code: 'dependency_conflict',
								message: 'An earlier change needs review. This change is preserved on this device.'
							}
						}
					: {})
			});
			if (supersededOperationId) await db.outbox.delete(supersededOperationId);
		});
	}
	function refresh() {
		const operations = pending.map((item) => `${item.operationId}:${item.status}`).join('|');
		const owner = state.identity ? scope : '';
		if (
			owner !== publishedOwner ||
			operations !== publishedOperations ||
			(confirmed !== published &&
				(confirmed.size !== published.size ||
					[...confirmed].some(([key, row]) => published.get(key) !== row)))
		) {
			visible = new Map(confirmed);
			for (const item of pending)
				if (item.status === 'pending') overlay(visible, item.envelope.command);
			tables.clear();
			for (const row of visible.values()) {
				let values = tables.get(row.table);
				if (!values) tables.set(row.table, (values = []));
				values.push(row.value);
			}
			state.contentVersion++;
			published = confirmed;
			publishedOwner = owner;
			publishedOperations = operations;
		}
		state.pending = pending.filter((item) => item.status === 'pending').length;
		state.conflicts = pending.filter((item) => item.status === 'conflict');
		notify();
	}
	// Other tabs of this vault learn that IndexedDB changed: a bare signal, never record contents.
	function openChannel() {
		channel?.close();
		channel = undefined;
		if (typeof BroadcastChannel === 'undefined') return;
		channel = new BroadcastChannel(`prism-sync:${scope}`);
		channel.onmessage = () => {
			// Reload what the sibling committed; never rebroadcast. A running sync re-reads after.
			if (syncing) peerChanged = true;
			else void refreshFromStorage();
		};
	}
	function broadcast() {
		try {
			channel?.postMessage('changed');
		} catch {
			// Polling and focus still catch up when the channel is unavailable.
		}
	}
	/** Outbox and drafts only: what sibling tabs may change without the sync lock. */
	async function reloadLocal() {
		if (!database) return;
		const db = database;
		const [operations, storedDrafts] = await db.transaction('r', db.outbox, db.drafts, () =>
			Promise.all([db.outbox.orderBy('createdAt').toArray(), db.drafts.toArray()])
		);
		pending = operations;
		drafts = new Map(storedDrafts.map((row) => [row.id, row]));
		refresh();
	}
	/** Re-reads confirmed records only when another tab committed them since our last read. */
	async function refreshFromStorage() {
		if (!database) return;
		const db = database;
		const [position, version] = await db.transaction('r', db.meta, () =>
			Promise.all([db.meta.get('cursor'), db.meta.get('replicaVersion')])
		);
		if (position?.value === cursor && version?.value === replicaVersion) await reloadLocal();
		else await reload();
	}
	async function reloadOutbox() {
		if (!database) return;
		pending = await database.outbox.orderBy('createdAt').toArray();
		refresh();
	}
	async function reload() {
		if (!database) return;
		const db = database;
		const [records, operations, storedDrafts, position, version] = await db.transaction(
			'r',
			db.records,
			db.outbox,
			db.drafts,
			db.meta,
			() =>
				Promise.all([
					db.records.toArray(),
					db.outbox.orderBy('createdAt').toArray(),
					db.drafts.toArray(),
					db.meta.get('cursor'),
					db.meta.get('replicaVersion')
				])
		);
		confirmed = new Map(
			records.map((row) => {
				const prior = confirmed.get(row.storageKey);
				return [row.storageKey, prior?.lastSeq === row.lastSeq ? prior : row];
			})
		);
		pending = operations;
		drafts = new Map(storedDrafts.map((row) => [row.id, row]));
		cursor = position?.value;
		replicaVersion = version?.value;
		refresh();
	}
	async function authenticate(verifiedIdentity?: VaultIdentity) {
		// The initial identity may come from this navigation's authenticated server load.
		// Subsequent syncs always verify the session again; localStorage is never authority.
		const identity = verifiedIdentity ?? (await request<VaultIdentity>('/api/v1/session'));
		perfMark('identity-available');
		const nextScope = `${location.origin}:${identity.vaultId}:${identity.subject}`;
		if (nextScope !== scope || !database?.isOpen()) {
			database?.close();
			confirmed = new Map();
			visible = new Map();
			pending = [];
			drafts = new Map();
			cursor = undefined;
			replicaVersion = undefined;
			state.ready = false;
			scope = nextScope;
			state.identity = identity;
			refresh();
			openChannel();
			database = new VaultStorage(encodeURIComponent(scope));
			await database.open();
			perfMark('dexie-open');
			await reload();
			perfMark('replica-read', { records: confirmed.size });
		}
		state.identity = identity;
		// A committed cursor marks a complete replica, including an empty library.
		// Publish it before waiting for the sync lock, network, or queued commands.
		state.ready = !!cursor;
		if (state.ready) perfMark('replica-ready', { cached: 1 });
		refresh();
		try {
			localStorage.setItem(
				`prism-v0:last-owner:${location.origin}`,
				JSON.stringify({ subject: identity.subject, vaultId: identity.vaultId })
			);
		} catch {
			/* Cache hints are optional when browser storage is restricted. */
		}
	}
	async function persist(
		records: Records,
		nextCursor: string | undefined,
		{
			replace = false,
			operationId,
			receipt
		}: { replace?: boolean; operationId?: string; receipt?: Records } = {}
	) {
		const db = database!;
		// applyFrame replaces changed records and preserves references for untouched rows.
		const changed = [...records]
			.filter(([key, row]) => replace || confirmed.get(key) !== row)
			.map(([storageKey, row]) => ({ ...row, storageKey }));
		const removed = replace ? [] : [...confirmed.keys()].filter((key) => !records.has(key));
		const writesRecords = replace || changed.length > 0 || removed.length > 0;
		let version = replicaVersion;
		if (writesRecords || nextCursor !== cursor || operationId) {
			await db.transaction('rw', db.records, db.meta, db.outbox, async () => {
				if (replace) await db.records.clear();
				else if (removed.length) await db.records.bulkDelete(removed);
				if (changed.length) await db.records.bulkPut(changed);
				if (writesRecords) {
					const stored = Number((await db.meta.get('replicaVersion'))?.value) || 0;
					version = String(stored + 1);
					await db.meta.put({ key: 'replicaVersion', value: version });
				}
				if (nextCursor !== cursor) {
					if (nextCursor) await db.meta.put({ key: 'cursor', value: nextCursor });
					else await db.meta.delete('cursor');
				}
				// Acknowledgement and confirmed records must survive or roll back together.
				if (operationId) {
					if (receipt) {
						for (const item of await db.outbox.toArray()) {
							if (Object.values(item.dependencies ?? {}).includes(operationId))
								await db.outbox.put(acknowledge(item, operationId, receipt));
						}
					}
					await db.outbox.delete(operationId);
				}
			});
			broadcast();
		}
		confirmed = records;
		cursor = nextCursor;
		replicaVersion = version;
	}
	async function pullInto(records: Records, position: string) {
		let hasMore = true;
		while (hasMore) {
			const page = await request<{ frames: ChangeFrame[]; cursor: string; hasMore: boolean }>(
				`/api/v1/sync/changes?cursor=${encodeURIComponent(position)}`
			);
			for (const frame of page.frames) applyFrame(records, frame);
			if (page.hasMore && page.cursor === position) throw new Error('Sync cursor did not advance.');
			position = page.cursor;
			hasMore = page.hasMore;
		}
		return position;
	}
	async function bootstrap() {
		state.status = 'Downloading library';
		notify();
		perfMark('bootstrap-start');
		const start = await request<BootstrapStart>('/api/v1/sync/bootstrap', { method: 'POST' });
		let requests = 1;
		const base = `/api/v1/sync/bootstrap/${encodeURIComponent(start.token)}`;
		// Follows continuations into staging until the transport reports the end.
		const download = async (staging: Records, url: (after: string | null) => string) => {
			let after: string | null = null;
			do {
				const page: BootstrapPage = await request(url(after));
				requests++;
				for (const row of page.records) putRecord(staging, row);
				if (page.nextAfter && page.nextAfter === after)
					throw new Error('Bootstrap page did not advance.');
				after = page.nextAfter;
			} while (after);
		};
		try {
			const staging: Records = new Map();
			// Batches span tables; servers without the capability (older deployments, or after a
			// rollback) still get one request per table page. Both fill the same staging replica,
			// which is published only after catch-up from the original start cursor.
			if (start.capabilities?.includes(BOOTSTRAP_BATCH_CAPABILITY))
				await download(staging, (after) =>
					after ? `${base}/batch?${new URLSearchParams({ after })}` : `${base}/batch`
				);
			else
				for (const table of start.tables)
					await download(staging, (after) => {
						const query = new URLSearchParams({ table });
						if (after) query.set('after', after);
						return `${base}?${query}`;
					});
			await persist(staging, await pullInto(staging, start.cursor), { replace: true });
			perfMark('bootstrap-complete', { requests, records: staging.size });
		} finally {
			await fetch(base, {
				method: 'DELETE',
				credentials: 'same-origin'
			}).catch(() => undefined);
		}
	}
	async function pull() {
		if (!cursor) return bootstrap();
		try {
			const next = new Map(confirmed);
			await persist(next, await pullInto(next, cursor));
		} catch (error) {
			if (error instanceof HttpFailure && [409, 410].includes(error.status)) await bootstrap();
			else throw error;
		}
	}
	async function sendPending() {
		const db = database!;
		const operations = await db.outbox.orderBy('createdAt').toArray();
		let sent = false;
		for (const queued of operations) {
			const item = await db.outbox.get(queued.operationId);
			if (!item) continue;
			if (Object.keys(item.dependencies ?? {}).length) {
				const predecessors = await db.outbox.bulkGet(Object.values(item.dependencies!));
				if (
					item.status === 'pending' &&
					predecessors.some((prior) => !prior || prior.status === 'conflict')
				) {
					await db.outbox.put({
						...item,
						status: 'conflict',
						error: {
							code: 'dependency_conflict',
							message:
								'An earlier change needs review. This later change is preserved on this device.'
						}
					});
					broadcast();
				}
				continue;
			}
			if (!active || !navigator.onLine) break;
			if (item.status === 'conflict') continue;
			// An immutable envelope is resent after any transport failure, including a lost response.
			const result = await request<CommandResult>('/api/v1/commands', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(item.envelope)
			});
			sent = true;

			if (result.status === 'accepted') {
				const next = new Map(confirmed);
				applyFrame(next, result.frame);
				// Command receipts can arrive ahead of the contiguous feed cursor.
				const receipt: Records = new Map();
				applyFrame(receipt, result.frame);
				await persist(next, cursor, { operationId: item.operationId, receipt });
			} else if (result.status === 'already_exists') {
				await db.outbox.put({
					...item,
					status: 'conflict',
					error: {
						code: 'duplicate_url',
						message: 'This URL is already saved. Your local changes are preserved for review.'
					},
					remote: result.bookmark
				});
			} else {
				const command = item.envelope.command as unknown as { id?: string };
				const remote = command.id
					? [...confirmed.values()].find(
							(row) =>
								row.key === command.id &&
								row.table ===
									(item.envelope.command.type === 'note.replace'
										? 'notes'
										: item.envelope.command.type.startsWith('person.')
											? 'people'
											: 'bookmarks')
						)?.value
					: undefined;
				await db.outbox.put({ ...item, status: 'conflict', error: result.error, remote });
			}
			if (result.status !== 'accepted') {
				const blocked = new Set([item.operationId]);
				await db.transaction('rw', db.outbox, async () => {
					for (const dependent of await db.outbox.orderBy('createdAt').toArray()) {
						if (!Object.values(dependent.dependencies ?? {}).some((id) => blocked.has(id)))
							continue;
						blocked.add(dependent.operationId);
						await db.outbox.put({
							...dependent,
							status: 'conflict',
							error: {
								code: 'dependency_conflict',
								message:
									'An earlier change needs review. This later change is preserved on this device.'
							}
						});
					}
				});
			}
			if (result.status !== 'accepted') broadcast();
			await reloadOutbox();
			if (awaitedOutcomes.has(item.operationId)) {
				awaitedOutcomes.set(
					item.operationId,
					result.status === 'rejected'
						? { status: 'rejected', message: result.error.message }
						: result.status === 'already_exists'
							? { status: 'already_exists', existingId: result.bookmark.id }
							: { status: 'accepted' }
				);
			}
		}
		return sent;
	}
	async function performSync(verifiedIdentity?: VaultIdentity) {
		state.online = navigator.onLine;
		if (!state.online) {
			state.status = 'Offline — changes stay on this device';
			notify();
			return;
		}
		state.loading = true;
		state.error = null;
		state.status = 'Syncing';
		notify();
		try {
			await authenticate(verifiedIdentity);
			if (!navigator.locks)
				throw new Error(
					'This browser does not support Web Locks. Sync is paused to protect changes across tabs. Use a browser with Web Locks support; drafts and pending work remain on this device.'
				);
			const before = cursor;
			let sent = false;
			const work = async () => {
				// Another tab may have held the lock and committed records since our last read.
				await refreshFromStorage();
				const initialized = !!cursor;
				if (!initialized) await bootstrap();
				sent = await sendPending();
				if (initialized || sent) await pull();
				// Confirmed records and cursor are current in memory; only the outbox and drafts
				// can have changed in sibling tabs meanwhile.
				await reloadLocal();
			};
			await navigator.locks.request(`prism-sync:${scope}`, { ifAvailable: true }, async (lock) => {
				if (lock) await work();
				else await refreshFromStorage();
			});
			if (sent || cursor !== before) changedBySync = true;
			state.ready = !!cursor;
			if (state.ready) perfMark('replica-ready', { cached: 0 });
			state.status = !state.ready
				? 'Waiting for library sync in another tab'
				: state.conflicts.length
					? 'Needs attention'
					: state.pending
						? 'Changes queued'
						: 'Up to date';
			if (state.ready) perfMark('sync-complete');
		} catch (error) {
			state.error =
				error instanceof HttpFailure && error.requestId
					? `${error.message} (Request ID: ${error.requestId})`
					: error instanceof Error
						? error.message
						: String(error);
			state.status = 'Sync paused';
			if (database && state.identity && cursor) state.ready = true;
			if (error instanceof HttpFailure && [401, 403].includes(error.status)) {
				// Do not expose a cached owner's private content after the session becomes unknown.
				visible = new Map();
				tables.clear();
				publishedOwner = '';
				state.contentVersion++;
				state.identity = null;
				state.conflicts = [];
				state.pending = 0;
				state.ready = false;
			}
		} finally {
			state.loading = false;
			notify();
		}
	}
	function sync(verifiedIdentity?: VaultIdentity): Promise<void> {
		if (!syncing) {
			clearTimeout(retryTimer);
			changedBySync = false;
			syncing = (async () => {
				do {
					syncRequested = false;
					await performSync(verifiedIdentity);
					verifiedIdentity = undefined;
				} while (active && syncRequested && state.pending > 0 && !state.error && navigator.onLine);
			})().finally(() => {
				syncing = undefined;
				if (active && state.identity && navigator.onLine && state.pending) {
					retryTimer = setTimeout(() => {
						void sync();
					}, retryDelay);
					retryDelay = Math.min(retryDelay * 2, 30_000);
				} else retryDelay = 1_000;
				// Back off only after a successful pull that found nothing new.
				if (changedBySync || activity) idleLevel = 0;
				else if (!state.error && state.online)
					idleLevel = Math.min(idleLevel + 1, IDLE_DELAYS.length - 1);
				activity = false;
				schedulePoll();
				if (peerChanged) {
					peerChanged = false;
					void refreshFromStorage();
				}
			});
		}
		return syncing;
	}
	function schedulePoll() {
		clearTimeout(pollTimer);
		pollTimer = undefined;
		// Hidden tabs never poll; becoming visible syncs at once.
		if (!active || document.visibilityState !== 'visible') return;
		pollTimer = setTimeout(() => void sync(), IDLE_DELAYS[idleLevel]);
	}
	// Focus, visibility and reconnection each ask for freshness; bursts within 500 ms make one
	// request. Saves never pass through here, so coalescing cannot drop queued work.
	function freshness() {
		idleLevel = 0;
		activity = true;
		const now = performance.now();
		if (now - lastFreshness < 500) return;
		lastFreshness = now;
		void sync();
	}
	const reconnect = () => freshness();
	// Going offline only updates status; never coalesced away.
	const offline = () => void sync();
	const visibility = () => {
		if (document.visibilityState === 'visible') freshness();
		else schedulePoll(); // cancels polling while hidden
	};
	return {
		state,
		async openCached(): Promise<void> {
			if (syncing) await syncing;
			if (navigator.onLine)
				throw new Error(
					'Cached access is available only while offline. Sign in online to validate the current owner.'
				);
			let identity: { subject: string; vaultId: string };
			try {
				const stored = JSON.parse(
					localStorage.getItem(`prism-v0:last-owner:${location.origin}`) ?? 'null'
				);
				if (
					!stored ||
					typeof stored.subject !== 'string' ||
					typeof stored.vaultId !== 'string' ||
					!stored.subject ||
					!stored.vaultId
				)
					throw new Error();
				identity = { subject: stored.subject, vaultId: stored.vaultId };
			} catch {
				throw new Error('No previously validated library is cached for this browser.');
			}
			const cachedScope = `${location.origin}:${identity.vaultId}:${identity.subject}`;
			if (!(await VaultStorage.exists(`prism-v0:${encodeURIComponent(cachedScope)}`)))
				throw new Error('No library is cached on this device yet.');
			if (scope !== cachedScope || !database?.isOpen()) {
				database?.close();
				database = new VaultStorage(encodeURIComponent(cachedScope));
				await database.open();
				perfMark('dexie-open');
				scope = cachedScope;
				confirmed = new Map();
				visible = new Map();
				pending = [];
				drafts = new Map();
				cursor = undefined;
				replicaVersion = undefined;
				openChannel();
			}
			state.identity = identity;
			await reload();
			perfMark('replica-read', { records: confirmed.size });
			state.ready = true;
			perfMark('replica-ready', { cached: 1, offline: 1 });
			state.online = false;
			state.loading = false;
			state.error = null;
			state.status = 'Cached library — owner will be checked when reconnected';
			notify();
		},
		async start(verifiedIdentity?: VaultIdentity) {
			if (active) return;
			active = true;
			window.addEventListener('online', reconnect);
			window.addEventListener('offline', offline);
			document.addEventListener('visibilitychange', visibility);
			// Coming back from another window (say, after saving from the extension) is a focus
			// change without a visibility change; catch up then too.
			window.addEventListener('focus', visibility);
			lastFreshness = performance.now();
			await sync(verifiedIdentity);
		},
		stop() {
			active = false;
			clearTimeout(pollTimer);
			clearTimeout(retryTimer);
			channel?.close();
			channel = undefined;
			window.removeEventListener('online', reconnect);
			window.removeEventListener('offline', offline);
			document.removeEventListener('visibilitychange', visibility);
			window.removeEventListener('focus', visibility);
		},
		sync: () => sync(),
		list<T>(table: ReplicaTable): T[] {
			return [...(tables.get(table) ?? [])] as T[];
		},
		get<T>(table: ReplicaTable, key: string): T | undefined {
			return visible.get(recordKey(table, key))?.value as T | undefined;
		},
		getConfirmed<T>(table: ReplicaTable, key: string): T | undefined {
			return state.identity
				? (confirmed.get(recordKey(table, key))?.value as T | undefined)
				: undefined;
		},
		listConfirmed<T>(table: ReplicaTable): T[] {
			return state.identity
				? [...confirmed.values()].filter((row) => row.table === table).map((row) => row.value as T)
				: [];
		},
		async save(
			command: Command,
			{ waitForSync = false }: { waitForSync?: boolean } = {}
		): Promise<SaveOutcome> {
			if (!database || !state.identity)
				return { status: 'rejected', message: 'Sign in and load this vault before saving.' };
			const operationId = crypto.randomUUID();
			const envelope = {
				protocolVersion: 1 as const,
				operationId,
				command: structuredClone(command)
			};
			if (serializedBytes(envelope) > MAX_COMMAND_BYTES)
				return { status: 'rejected', message: 'This command exceeds 1 MiB.' };
			if (waitForSync) awaitedOutcomes.set(operationId, { status: 'queued' });
			try {
				await enqueue(envelope);
				broadcast();
				await reloadOutbox();
				syncRequested = true;
				idleLevel = 0;
				activity = true;
				if (navigator.onLine) {
					if (waitForSync) {
						await sync();
						return awaitedOutcomes.get(operationId) ?? { status: 'queued' };
					}
					void sync();
				}
				return { status: 'queued', message: 'Saved on this device; syncing in the background.' };
			} catch (error) {
				return {
					status: 'rejected',
					message: error instanceof Error ? error.message : String(error)
				};
			} finally {
				awaitedOutcomes.delete(operationId);
			}
		},
		getDraft(id: string) {
			return state.identity ? drafts.get(id) : undefined;
		},
		async setDraft(id: string, body: string, baseRevision: Revision) {
			if (!database || !state.identity) throw new Error('Load the vault before editing.');
			const draft = { id, body, baseRevision };
			await database.drafts.put(draft);
			broadcast();
			drafts.set(id, draft);
			notify();
		},
		async clearDraft(id: string) {
			await database?.drafts.delete(id);
			broadcast();
			drafts.delete(id);
			notify();
		},
		async exportPending() {
			if (!state.identity) return { identity: null, operations: [], drafts: [] };
			return {
				identity: state.identity,
				operations: (await database?.outbox.toArray()) ?? [],
				drafts: (await database?.drafts.toArray()) ?? []
			};
		},
		async resolveConflict(operationId: string, choice: 'remote' | 'retry', command?: Command) {
			if (!state.identity) throw new Error('Sign in to resolve pending work.');
			const item = await database?.outbox.get(operationId);
			if (!item || item.status !== 'conflict') return;
			if (choice === 'retry') {
				if (!command)
					throw new Error(
						'Review the current remote version and supply a new command before retrying.'
					);
				const id = crypto.randomUUID();
				const envelope = {
					protocolVersion: 1 as const,
					operationId: id,
					command: structuredClone(command)
				};
				if (serializedBytes(envelope) > MAX_COMMAND_BYTES)
					throw new Error('This command exceeds 1 MiB.');
				await enqueue(envelope, operationId);
			} else await database!.outbox.delete(operationId);
			broadcast();
			await reloadOutbox();
			if (choice === 'retry') {
				syncRequested = true;
				void sync();
			}
		}
	};
}
export type LibraryClient = ReturnType<typeof createLibraryClient>;
