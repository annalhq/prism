import { REPLICA_TABLES } from '#lib/domain/replica.js';
import { perfSearch } from './perf.js';
import { searchLibrary, type LibraryReader } from './search.js';
import {
	snapshotReader,
	type SearchRequest,
	type SearchResponse,
	type SearchSnapshot
} from './search-worker.js';

type Result = ReturnType<typeof searchLibrary>;
type Waiting = {
	resolve: (result: Result, viaWorker: number) => void;
	fallback: () => Result;
	timer: ReturnType<typeof setTimeout>;
};
type Current = { contentVersion: number; reader: LibraryReader; local: LibraryReader };

export function createSearchClient() {
	let worker: Worker | undefined;
	let sequence = 0;
	let failed = false;
	let current: Current | undefined;
	// Whether the worker holds `current` (it is re-sent after a worker restart).
	let sent = false;
	const waiting = new Map<number, Waiting>();
	function settleFallback(id: number) {
		const item = waiting.get(id);
		if (!item) return;
		waiting.delete(id);
		clearTimeout(item.timer);
		item.resolve(item.fallback(), 0);
	}
	function failWorker() {
		failed = true;
		worker?.terminate();
		worker = undefined;
		sent = false;
		for (const id of waiting.keys()) settleFallback(id);
	}
	function post(message: SearchRequest) {
		try {
			worker!.postMessage(message);
			return true;
		} catch {
			failWorker();
			return false;
		}
	}
	function ensureWorker() {
		if (worker || failed || typeof Worker === 'undefined') return;
		try {
			worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
			sent = false;
			worker.onmessage = (event: MessageEvent<SearchResponse>) => {
				const item = waiting.get(event.data.id);
				if (!item) return;
				if (event.data.error || !event.data.result) {
					settleFallback(event.data.id);
					return;
				}
				waiting.delete(event.data.id);
				clearTimeout(item.timer);
				item.resolve(event.data.result, 1);
			};
			worker.onerror = failWorker;
			worker.onmessageerror = failWorker;
		} catch {
			failWorker();
		}
	}
	function sendSnapshot() {
		if (!worker || !current || sent) return;
		const snapshot: SearchSnapshot = {};
		for (const table of REPLICA_TABLES) snapshot[table] = current.local.list(table);
		// postMessage copies the snapshot; the arrays kept here stay the fallback's own.
		sent = post({ type: 'snapshot', contentVersion: current.contentVersion, snapshot });
	}
	return {
		/**
		 * Makes `reader` at `contentVersion` the data searched. The library is copied once per
		 * content version, not per keystroke or sort change; repeat calls are free.
		 */
		setSnapshot(reader: LibraryReader, contentVersion: number): void {
			if (current?.reader === reader && current.contentVersion === contentVersion) return;
			// The reader's lists are fresh arrays of immutable rows: an owned snapshot.
			const snapshot: SearchSnapshot = {};
			for (const table of REPLICA_TABLES)
				snapshot[table] = reader.list<Record<string, unknown>>(table);
			current = { contentVersion, reader, local: snapshotReader(snapshot) };
			sent = false;
			ensureWorker();
			sendSnapshot();
		},
		query(view: string, input: string, sort = 'newest'): Promise<Result> {
			if (!current) return Promise.reject(new Error('Search has no library snapshot yet.'));
			const startedAt = performance.now();
			const { contentVersion, local } = current;
			const fallback = () => searchLibrary(local, view, input, sort);
			// Includes worker transfer; `worker` 0 means the inline fallback.
			const settled = (result: Result, viaWorker: number) => {
				perfSearch(startedAt, { worker: viaWorker });
				return result;
			};
			ensureWorker();
			sendSnapshot();
			if (!worker) return Promise.resolve(settled(fallback(), 0));
			const id = ++sequence;
			return new Promise<Result>((resolve) => {
				waiting.set(id, {
					resolve: (result, viaWorker) => resolve(settled(result, viaWorker)),
					fallback,
					timer: setTimeout(() => {
						failWorker();
					}, 15_000)
				});
				if (!post({ type: 'query', id, contentVersion, view, input, sort })) settleFallback(id);
			});
		},
		stop() {
			worker?.terminate();
			worker = undefined;
			sent = false;
			for (const id of waiting.keys()) settleFallback(id);
		}
	};
}
