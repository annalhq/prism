// Browser User Timing marks for the library load path, read by scripts/performance-library.mjs.
// Marks carry fixed names and numeric counts only: never titles, URLs, note bodies, subjects
// or tokens. Each milestone is marked once per page load so repeat syncs do not move it.
export type PerfMilestone =
	| 'identity-available'
	| 'dexie-open'
	| 'replica-read'
	| 'bootstrap-start'
	| 'bootstrap-complete'
	| 'replica-ready'
	| 'first-bookmark-rendered'
	| 'sync-complete'
	| 'search-first-complete';

const PREFIX = 'prism:';
const marked = new Set<PerfMilestone>();
const supported = () =>
	typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function perfMark(name: PerfMilestone, detail?: Record<string, number>) {
	if (marked.has(name) || !supported()) return;
	marked.add(name);
	try {
		performance.mark(PREFIX + name, detail ? { detail } : undefined);
	} catch {
		// Timing is diagnostic only.
	}
}

/** Records a search duration as a `prism:search` measure; the buffer is capped for long sessions. */
export function perfSearch(startedAt: number, detail: Record<string, number>) {
	if (!supported()) return;
	try {
		if (performance.getEntriesByName(`${PREFIX}search`, 'measure').length >= 50)
			performance.clearMeasures(`${PREFIX}search`);
		performance.measure(`${PREFIX}search`, { start: startedAt, end: performance.now(), detail });
		perfMark('search-first-complete');
	} catch {
		// Timing is diagnostic only.
	}
}
