// Which source worked for each hostname, so revisits try it first. Misses are never stored.
// v3: Google URLs moved to `domain_url`, so earlier entries are dropped.
const STORE_KEY = 'prism:favicons:v3';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const PERSIST_DELAY_MS = 500;

type Entry = { src: string; at: number };

export class FaviconCache {
	#entries: Map<string, Entry> | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly isValid: (host: string, src: string) => boolean) {}

	get(host: string): string | undefined {
		const entries = this.#load();
		const entry = entries.get(host);
		if (!entry) return undefined;
		if (fresh(entry)) return entry.src;
		entries.delete(host);
		return undefined;
	}

	set(host: string, src: string) {
		const entries = this.#load();
		entries.delete(host);
		if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
		entries.set(host, { src, at: Date.now() });
		this.#persist();
	}

	/** Forgets `src` for `host` if it is the remembered one. */
	forget(host: string, src: string) {
		if (this.#load().get(host)?.src !== src) return;
		this.#entries!.delete(host);
		this.#persist();
	}

	#load(): Map<string, Entry> {
		if (this.#entries) return this.#entries;
		this.#entries = new Map();
		try {
			const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
			if (!raw || typeof raw !== 'object') return this.#entries;
			for (const [host, value] of Object.entries(raw)) {
				const entry = value as Partial<Entry> | null;
				if (
					typeof entry?.src === 'string' &&
					typeof entry.at === 'number' &&
					fresh(entry as Entry) &&
					this.isValid(host, entry.src)
				)
					this.#entries.set(host, { src: entry.src, at: entry.at });
				if (this.#entries.size >= MAX_ENTRIES) break;
			}
		} catch {
			// Storage is optional (private browsing, blocked storage).
		}
		return this.#entries;
	}

	#persist() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			try {
				localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(this.#load())));
			} catch {
				// The HTTP image cache still applies without it.
			}
		}, PERSIST_DELAY_MS);
	}
}

function fresh(entry: Entry): boolean {
	const age = Date.now() - entry.at;
	return age >= 0 && age < TTL_MS;
}
