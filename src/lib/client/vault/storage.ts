import Dexie, { type Table } from 'dexie';
import type { CommandEnvelope, Revision } from '#lib/domain/contracts.js';
import type { ReplicaRecord } from '#lib/domain/replica.js';

export type PendingOperation = {
	operationId: string;
	envelope: CommandEnvelope;
	createdAt: string;
	status: 'pending' | 'conflict';
	dependencies?: Record<string, string>;
	error?: { code: string; message: string };
	remote?: Record<string, unknown>;
};
export type Draft = { id: string; body: string; baseRevision: Revision };
export type StoredRecord = ReplicaRecord & { storageKey: string };
export class VaultStorage extends Dexie {
	records!: Table<StoredRecord, string>;
	outbox!: Table<PendingOperation, string>;
	drafts!: Table<Draft, string>;
	meta!: Table<{ key: string; value: string }, string>;
	constructor(scope: string) {
		super(`prism-v0:${scope}`);
		this.version(1).stores({
			records: 'storageKey,table',
			outbox: 'operationId,createdAt',
			drafts: 'id',
			meta: 'key'
		});
	}
}
export function recordKey(table: string, key: string): string {
	return `${table}:${key}`;
}
