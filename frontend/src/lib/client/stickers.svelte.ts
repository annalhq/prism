// Space icons: hand-drawn trazo stickers. The full catalog is large, so it loads only when
// browsing icons or when a space uses one not yet cached; used stickers are cached per device.
import { SvelteMap } from 'svelte/reactivity';
import type { StickerDef } from 'trazo-stickers/svg';

export type Sticker = Pick<
	StickerDef,
	'id' | 'name' | 'category' | 'tags' | 'viewBox' | 'd' | 'layers'
>;

const CACHE_KEY = 'prism:stickers';

/** Stickers known on this device, by id. Rendering reads from here. */
export const stickers = new SvelteMap<string, Sticker>();

let catalog: Promise<Sticker[]> | undefined;
/** Every offered sticker, loaded on first use. */
export function loadCatalog(): Promise<Sticker[]> {
	catalog ??= import('trazo-stickers/svg').then(({ trazoCatalog }) =>
		trazoCatalog.map(({ id, name, category, tags, viewBox, d, layers }) => ({
			id,
			name,
			category,
			tags,
			viewBox,
			d,
			layers
		}))
	);
	return catalog;
}

function readCache(): Record<string, Sticker> {
	try {
		return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

/** Makes the given stickers available, from the device cache or else the catalog. */
export async function ensureStickers(ids: string[]) {
	const cached = readCache();
	for (const id of ids) if (!stickers.has(id) && cached[id]) stickers.set(id, cached[id]);
	const missing = ids.filter((id) => !stickers.has(id));
	if (!missing.length) return;
	const all = await loadCatalog().catch(() => []);
	for (const sticker of all) if (missing.includes(sticker.id)) stickers.set(sticker.id, sticker);
	try {
		const kept = Object.fromEntries(
			ids.filter((id) => stickers.has(id)).map((id) => [id, stickers.get(id)!])
		);
		localStorage.setItem(CACHE_KEY, JSON.stringify(kept));
	} catch {
		/* Device storage is optional. */
	}
}
