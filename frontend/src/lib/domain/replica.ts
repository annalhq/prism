import type { ChangeFrame, Sequence } from './contracts.js';

export type VaultIdentity = Readonly<{ subject: string; vaultId: string }>;

export const REPLICA_TABLES = [
	'bookmarks',
	'entities',
	'people',
	'personas',
	'notes',
	'tags',
	'collections',
	'links',
	'identities',
	'relationships',
	'memberships',
	'savedSearches',
	'activity'
] as const;
export type ReplicaTable = (typeof REPLICA_TABLES)[number];
export type ReplicaRecord = {
	table: ReplicaTable;
	key: string;
	lastSeq: Sequence;
	value: Record<string, unknown>;
};
export type BootstrapStart = {
	token: string;
	epoch: string;
	startSeq: Sequence;
	cursor: string;
	tables: readonly ReplicaTable[];
	expiresAt: string;
};
export type BootstrapPage = { records: ReplicaRecord[]; nextAfter: string | null };
export type ChangesPage = {
	frames: ChangeFrame[];
	cursor: string;
	hasMore: boolean;
	epoch: string;
};
