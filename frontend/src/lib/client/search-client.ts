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
export function createSearchClient() {
	let worker: Worker | undefined;
	let sequence = 0;
	let failed = false;
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
		for (const id of waiting.keys()) settleFallback(id);
	}
	function ensureWorker() {
		if (worker || failed || typeof Worker === 'undefined') return;
		try {
			worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
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
	return {
		query(reader: LibraryReader, view: string, input: string, sort = 'newest'): Promise<Result> {
			const startedAt = performance.now();
			const snapshot: SearchSnapshot = {};
			for (const table of REPLICA_TABLES)
				snapshot[table] = structuredClone(reader.list<Record<string, unknown>>(table));
			const fallback = () => searchLibrary(snapshotReader(snapshot), view, input, sort);
			ensureWorker();
			// Includes snapshot cloning and worker transfer; `worker` 0 means the inline fallback.
			const settled = (result: Result, viaWorker: number) => {
				perfSearch(startedAt, { worker: viaWorker });
				return result;
			};
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
				try {
					worker!.postMessage({ id, snapshot, view, input, sort } satisfies SearchRequest);
				} catch {
					failWorker();
				}
			});
		},
		stop() {
			worker?.terminate();
			worker = undefined;
			for (const id of waiting.keys()) settleFallback(id);
		}
	};
}
