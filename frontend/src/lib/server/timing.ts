import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestEvent } from '@sveltejs/kit';

// Per-request stage timings for the Server-Timing header. Names are fixed stage labels;
// never put identifiers, URLs, subjects or record content into a timing name.
export type RequestTimings = { stages: Map<string, number>; queries: number };

const current = new AsyncLocalStorage<RequestTimings>();

export function createTimings(): RequestTimings {
	return { stages: new Map(), queries: 0 };
}

export function withTimings<T>(timings: RequestTimings, work: () => T): T {
	return current.run(timings, work);
}

/** Counts a database statement against the request it runs in, if any. */
export function countQuery() {
	const timings = current.getStore();
	if (timings) timings.queries++;
}

export function recordStage(timings: RequestTimings | undefined, name: string, duration: number) {
	if (!timings) return;
	timings.stages.set(name, (timings.stages.get(name) ?? 0) + duration);
}

export async function timed<T>(
	event: Pick<RequestEvent, 'locals'>,
	name: string,
	work: () => Promise<T>
): Promise<T> {
	const started = performance.now();
	try {
		return await work();
	} finally {
		recordStage(event.locals.timings, name, performance.now() - started);
	}
}

/** Appends stage timings, statement count and total request time to an existing header. */
export function serverTimingHeader(
	timings: RequestTimings,
	total: number,
	existing: string | null
): string {
	const parts = existing ? [existing] : [];
	for (const [name, duration] of timings.stages) parts.push(`${name};dur=${duration.toFixed(1)}`);
	parts.push(`queries;desc="${timings.queries}"`);
	parts.push(`total;dur=${total.toFixed(1)}`);
	return parts.join(', ');
}
