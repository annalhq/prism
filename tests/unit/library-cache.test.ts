import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryClient, type LibraryClient } from '../../src/lib/client/vault/library.js';
import { VaultStorage, type StoredRecord } from '../../src/lib/client/vault/storage.js';
import type { BookmarkProjection, ChangeFrame } from '../../src/lib/domain/contracts.js';

const origin = 'https://prism.example';
let identity: { subject: string; vaultId: string };
let clients: LibraryClient[];
let work: Promise<unknown>[];
let releases: (() => void)[];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

function bookmark(id = 'cached', title = 'Cached bookmark'): BookmarkProjection {
	return {
		id,
		title,
		kind: 'page',
		description: '',
		url: null,
		canonicalUrl: null,
		domain: null,
		collectionId: null,
		readingStatus: 'unread',
		isPinned: false,
		archivedAt: null,
		tagIds: [],
		revision: '1',
		lastSeq: '1',
		deletedAt: null,
		createdAt: '2026-10-18T00:00:00.000Z',
		updatedAt: '2026-10-18T00:00:00.000Z'
	};
}
function record(value = bookmark()): StoredRecord {
	return {
		storageKey: `bookmarks:${value.id}`,
		table: 'bookmarks',
		key: value.id,
		lastSeq: value.lastSeq,
		value
	};
}
function storage(owner = identity) {
	return new VaultStorage(encodeURIComponent(`${origin}:${owner.vaultId}:${owner.subject}`));
}
async function seed(rows = [record()], position: string | null = 'cursor-1', owner = identity) {
	const db = storage(owner);
	await db.records.bulkPut(rows);
	if (position) await db.meta.put({ key: 'cursor', value: position });
	await db.drafts.put({ id: 'cached', body: 'Unsynced draft', baseRevision: '1' });
	db.close();
}
function deferredResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((done) => (resolve = done));
	releases.push(() => resolve(Response.json({ frames: [], cursor: 'cursor-1', hasMore: false })));
	return { promise, resolve };
}
function client() {
	const result = createLibraryClient(() => {});
	clients.push(result);
	return result;
}
function start(value: LibraryClient) {
	const promise = value.start();
	work.push(promise);
	return promise;
}
function changes(frames: ChangeFrame[] = [], cursor = 'cursor-1') {
	return Response.json({ frames, cursor, hasMore: false });
}
function paths() {
	return fetcher.mock.calls.map(([path]) => String(path).split('?')[0]);
}
function observeRecordWrites() {
	const put = vi.spyOn(IDBObjectStore.prototype, 'put');
	const clear = vi.spyOn(IDBObjectStore.prototype, 'clear');
	const remove = vi.spyOn(IDBObjectStore.prototype, 'delete');
	return () => ({
		puts: put.mock.contexts.filter(
			(store) => store instanceof IDBObjectStore && store.name === 'records'
		).length,
		clears: clear.mock.contexts.filter(
			(store) => store instanceof IDBObjectStore && store.name === 'records'
		).length,
		deletes: remove.mock.contexts.filter(
			(store) => store instanceof IDBObjectStore && store.name === 'records'
		).length
	});
}

beforeEach(() => {
	Dexie.dependencies.indexedDB = new IDBFactory();
	identity = { subject: 'owner', vaultId: 'vault' };
	clients = [];
	work = [];
	releases = [];
	vi.stubGlobal('location', { origin });
	vi.stubGlobal('window', new EventTarget());
	vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
	vi.stubGlobal('navigator', {
		onLine: true,
		locks: {
			request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
				callback({})
		}
	});
	const hints = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => hints.get(key) ?? null,
		setItem: (key: string, value: string) => hints.set(key, value)
	});
	fetcher = vi.fn<typeof fetch>(async (path) => {
		if (path === '/api/v1/session') return Response.json(identity);
		if (String(path).startsWith('/api/v1/sync/changes?')) return changes();
		throw new Error(`Unexpected request: ${path}`);
	});
	vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => {
	for (const value of clients) value.stop();
	for (const release of releases) release();
	await Promise.allSettled(work);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('authenticated local cache', () => {
	it('reuses the server-verified identity for initial hydration and checks the session on later syncs', async () => {
		await seed();
		const value = client();
		await value.start(identity);
		expect(value.state.ready).toBe(true);
		expect(paths()).toEqual(['/api/v1/sync/changes']);
		await value.sync();
		expect(paths().filter((path) => path === '/api/v1/session')).toHaveLength(1);
	});
	it('publishes cached bookmarks before background sync completes, including after a refresh', async () => {
		await seed();
		const remote = deferredResponse();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : remote.promise
		);
		const first = client();
		const syncing = start(first);
		await vi.waitFor(() => expect(paths()).toContain('/api/v1/sync/changes'));
		expect(first.list('bookmarks')).toHaveLength(1);
		expect(first.state.ready).toBe(true);
		expect(first.state.loading).toBe(true);
		remote.resolve(changes());
		await syncing;
		first.stop();
		const nextRemote = deferredResponse();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : nextRemote.promise
		);
		const refreshed = client();
		start(refreshed);
		await vi.waitFor(() => expect(refreshed.state.ready).toBe(true));
		expect(refreshed.list('bookmarks')).toHaveLength(1);
		expect(refreshed.state.loading).toBe(true);
		expect(paths()).not.toContain('/api/v1/sync/bootstrap');
	});
	it('waits for owner verification instead of trusting a localStorage hint', async () => {
		await seed();
		localStorage.setItem(`prism-v0:last-owner:${origin}`, JSON.stringify(identity));
		const session = deferredResponse();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? session.promise : changes()
		);
		const value = client();
		const syncing = start(value);
		expect(value.state.ready).toBe(false);
		expect(value.list('bookmarks')).toEqual([]);
		session.resolve(new Response('', { status: 401 }));
		await syncing;
		expect(value.state.ready).toBe(false);
		expect(value.getDraft('cached')).toBeUndefined();
	});
	it('treats a successfully synced empty library as a usable cache', async () => {
		await seed([]);
		const remote = deferredResponse();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : remote.promise
		);
		const value = client();
		start(value);
		await vi.waitFor(() => expect(paths()).toContain('/api/v1/sync/changes'));
		expect(value.state.ready).toBe(true);
		expect(value.list('bookmarks')).toEqual([]);
	});
	it('waits for the complete bootstrap when no committed cursor exists', async () => {
		await seed([record()], null);
		const download = deferredResponse();
		fetcher.mockImplementation(async (path, init) => {
			if (path === '/api/v1/session') return Response.json(identity);
			if (path === '/api/v1/sync/bootstrap')
				return Response.json({ token: 'snapshot', tables: ['bookmarks'], cursor: 'cursor-1' });
			if (String(path).startsWith('/api/v1/sync/bootstrap/snapshot')) {
				return init?.method === 'DELETE' ? new Response('', { status: 200 }) : download.promise;
			}
			return changes();
		});
		const value = client();
		const syncing = start(value);
		await vi.waitFor(() => expect(paths()).toContain('/api/v1/sync/bootstrap/snapshot'));
		expect(value.state.ready).toBe(false);
		download.resolve(Response.json({ records: [record(bookmark('downloaded'))], nextAfter: null }));
		await syncing;
		expect(value.state.ready).toBe(true);
		expect(value.list<BookmarkProjection>('bookmarks').map((row) => row.id)).toEqual([
			'downloaded'
		]);
		expect(value.getDraft('cached')?.body).toBe('Unsynced draft');
	});
	it('does not mark an uninitialized replica ready when another tab owns the sync lock', async () => {
		await seed([], null);
		vi.stubGlobal('navigator', {
			onLine: true,
			locks: {
				request: async (_name: string, _options: unknown, callback: (lock: null) => unknown) =>
					callback(null)
			}
		});
		const value = client();
		await start(value);
		expect(value.state.ready).toBe(false);
		expect(value.state.status).toBe('Waiting for library sync in another tab');
	});
	it('keeps the usable cache and drafts when the sync endpoint is temporarily unavailable', async () => {
		await seed();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session'
				? Response.json(identity)
				: new Response('Unavailable', { status: 503 })
		);
		const value = client();
		await start(value);
		expect(value.state.ready).toBe(true);
		expect(value.list('bookmarks')).toHaveLength(1);
		expect(value.getDraft('cached')?.body).toBe('Unsynced draft');
		expect(value.state.status).toBe('Sync paused');
	});
	it('hides private content after a sync authorization failure, including on later network errors', async () => {
		await seed();
		const value = client();
		await start(value);
		fetcher.mockImplementation(async () => new Response('', { status: 403 }));
		await value.sync();
		expect(value.state.ready).toBe(false);
		expect(value.list('bookmarks')).toEqual([]);
		fetcher.mockRejectedValue(new Error('Network unavailable'));
		await value.sync();
		expect(value.state.ready).toBe(false);
		expect(value.list('bookmarks')).toEqual([]);
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : changes()
		);
		await value.sync();
		expect(value.state.ready).toBe(true);
		expect(value.list('bookmarks')).toHaveLength(1);
	});
	it('switches cache scope when the verified owner changes', async () => {
		await seed();
		const other = { subject: 'other-owner', vaultId: 'other-vault' };
		await seed([record(bookmark('other', 'Other owner bookmark'))], 'cursor-1', other);
		const value = client();
		await start(value);
		identity = other;
		const remote = deferredResponse();
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : remote.promise
		);
		work.push(value.sync());
		await vi.waitFor(() => expect(value.state.identity).toEqual(other));
		await vi.waitFor(() =>
			expect(value.list<BookmarkProjection>('bookmarks').map((row) => row.id)).toEqual(['other'])
		);
		expect(value.state.ready).toBe(true);
	});
});

describe('incremental cache persistence', () => {
	it('keeps the content version stable across empty syncs and note-draft updates', async () => {
		await seed();
		const value = client();
		await start(value);
		const version = value.state.contentVersion;
		const cached = value.get('bookmarks', 'cached');
		await value.setDraft('cached', 'Still typing', '1');
		await value.sync();
		expect(value.state.contentVersion).toBe(version);
		expect(value.get('bookmarks', 'cached')).toBe(cached);
		const listed = value.list('bookmarks');
		listed.pop();
		expect(value.list('bookmarks')).toHaveLength(1);
	});
	it('does not rewrite an unchanged replica or issue a second pull without pending writes', async () => {
		await seed();
		const writes = observeRecordWrites();
		await start(client());
		expect(writes()).toEqual({ puts: 0, clears: 0, deletes: 0 });
		expect(paths().filter((path) => path === '/api/v1/sync/changes')).toHaveLength(1);
	});
	it('writes just the changed bookmark and persists its cursor without rewriting other records', async () => {
		await seed([record(), record(bookmark('untouched'))]);
		const changed = {
			...bookmark(),
			title: 'Updated remotely',
			lastSeq: '2' as const,
			revision: '2' as const
		};
		const frame: ChangeFrame = {
			protocolVersion: 1,
			operationId: 'remote',
			seq: '2',
			changes: [{ type: 'bookmark.upsert', bookmark: changed }]
		};
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : changes([frame], 'cursor-2')
		);
		const writes = observeRecordWrites();
		const value = client();
		await start(value);
		expect(writes()).toEqual({ puts: 1, clears: 0, deletes: 0 });
		const db = storage();
		expect((await db.records.get('bookmarks:cached'))?.value.title).toBe('Updated remotely');
		expect((await db.records.get('bookmarks:untouched'))?.value.title).toBe('Cached bookmark');
		expect((await db.meta.get('cursor'))?.value).toBe('cursor-2');
		db.close();
	});
	it('keeps both the old records and cursor if a delta transaction fails', async () => {
		await seed();
		const value = client();
		await start(value);
		const changed = { ...bookmark(), title: 'Must roll back', lastSeq: '2' as const };
		const frame: ChangeFrame = {
			protocolVersion: 1,
			operationId: 'remote',
			seq: '2',
			changes: [{ type: 'bookmark.upsert', bookmark: changed }]
		};
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : changes([frame], 'cursor-2')
		);
		const original = IDBObjectStore.prototype.put;
		vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			...args
		) {
			if (this.name === 'records') throw new Error('Storage write failed');
			return original.apply(this, args);
		});
		await value.sync();
		const db = storage();
		expect((await db.records.get('bookmarks:cached'))?.value.title).toBe('Cached bookmark');
		expect((await db.meta.get('cursor'))?.value).toBe('cursor-1');
		expect(value.get<BookmarkProjection>('bookmarks', 'cached')?.title).toBe('Cached bookmark');
		db.close();
	});
	it('removes purged content and its connections while preserving drafts and unrelated bookmarks', async () => {
		await seed([record(), record(bookmark('untouched'))]);
		const db = storage();
		await db.records.put({
			storageKey: 'relationships:edge',
			table: 'relationships',
			key: 'edge',
			lastSeq: '1',
			value: { bookmarkId: 'cached', personId: 'person' }
		});
		const tombstone = {
			kind: 'bookmark' as const,
			id: 'cached',
			revision: '2' as const,
			lastSeq: '2' as const,
			deletedAt: '2026-10-18',
			purgedAt: '2026-10-18'
		};
		const frame: ChangeFrame = {
			protocolVersion: 1,
			operationId: 'purge',
			seq: '2',
			changes: [{ type: 'bookmark.purge', tombstone }]
		};
		fetcher.mockImplementation(async (path) =>
			path === '/api/v1/session' ? Response.json(identity) : changes([frame], 'cursor-2')
		);
		await start(client());
		expect(await db.records.get('bookmarks:cached')).toBeUndefined();
		expect(await db.records.get('relationships:edge')).toBeUndefined();
		expect(await db.records.get('bookmarks:untouched')).toBeDefined();
		expect((await db.records.get('entities:cached'))?.value.purgedAt).toBe('2026-10-18');
		expect((await db.drafts.get('cached'))?.body).toBe('Unsynced draft');
		db.close();
	});
	for (const failStorage of [false, true]) {
		it(`${failStorage ? 'rolls back' : 'commits'} command acknowledgement with its confirmed records`, async () => {
			await seed([record(), record(bookmark('untouched'))]);
			const db = storage();
			await db.outbox.put({
				operationId: 'queued',
				createdAt: '2026-10-18',
				status: 'pending',
				envelope: {
					protocolVersion: 1,
					operationId: 'queued',
					command: {
						type: 'bookmark.update',
						id: 'cached',
						expectedRevision: '1',
						patch: { title: 'Edited locally' }
					}
				}
			});
			const changed = {
				...bookmark(),
				title: 'Edited locally',
				revision: '2' as const,
				lastSeq: '2' as const
			};
			const frame: ChangeFrame = {
				protocolVersion: 1,
				operationId: 'queued',
				seq: '2',
				changes: [{ type: 'bookmark.upsert', bookmark: changed }]
			};
			let sent = false;
			fetcher.mockImplementation(async (path) => {
				if (path === '/api/v1/session') return Response.json(identity);
				if (path === '/api/v1/commands') {
					sent = true;
					return Response.json({ status: 'accepted', frame });
				}
				return sent ? changes([frame], 'cursor-2') : changes();
			});
			if (failStorage) {
				const put = IDBObjectStore.prototype.put;
				vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
					this: IDBObjectStore,
					...args
				) {
					if (this.name === 'records') throw new Error('Storage write failed');
					return put.apply(this, args);
				});
			}
			const value = client();
			await start(value);
			expect((await db.records.get('bookmarks:cached'))?.value.title).toBe(
				failStorage ? 'Cached bookmark' : 'Edited locally'
			);
			expect((await db.outbox.count()) > 0).toBe(failStorage);
			expect((await db.meta.get('cursor'))?.value).toBe(failStorage ? 'cursor-1' : 'cursor-2');
			expect((await db.records.get('bookmarks:untouched'))?.value.title).toBe('Cached bookmark');
			expect(value.getDraft('cached')?.body).toBe('Unsynced draft');
			db.close();
		});
	}
});
