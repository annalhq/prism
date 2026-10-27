import type { LibraryState } from './vault/library.js';

export type SyncTone = 'ok' | 'busy' | 'warn' | 'off';
/** One short line and a colour for the library's sync state, shared by every surface. */
export function syncSummary(status: LibraryState | null): { title: string; tone: SyncTone } {
	const title = status?.loading
		? 'Syncing'
		: status?.conflicts.length
			? 'Needs review'
			: !status?.online
				? 'Offline'
				: status?.pending
					? 'Waiting to sync'
					: status?.ready
						? 'Up to date'
						: 'Not connected';
	const tone: SyncTone =
		status?.conflicts.length || status?.error
			? 'warn'
			: !status?.online || !status?.ready
				? 'off'
				: status?.pending || status?.loading
					? 'busy'
					: 'ok';
	return { title, tone };
}
