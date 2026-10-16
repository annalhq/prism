import { PROTOCOL_VERSION, type Sequence } from '#lib/domain/contracts.js';
import { ApiError } from '../http.js';

export function encodeCursor(vaultId: string, epoch: string, seq: bigint | Sequence): string {
	return Buffer.from(
		JSON.stringify({ v: PROTOCOL_VERSION, vaultId, epoch, seq: String(seq) })
	).toString('base64url');
}
export function decodeCursor(input: string, vaultId: string, epoch: string): bigint {
	if (input.length > 1024)
		throw new ApiError(400, 'invalid_cursor', 'Invalid synchronization cursor.');
	let cursor;
	try {
		cursor = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
	} catch {
		throw new ApiError(400, 'invalid_cursor', 'Invalid synchronization cursor.');
	}
	if (
		!cursor ||
		typeof cursor !== 'object' ||
		cursor.v !== PROTOCOL_VERSION ||
		cursor.vaultId !== vaultId ||
		cursor.epoch !== epoch
	)
		throw new ApiError(
			410,
			'reset_required',
			'Rebuild the confirmed local replica; preserve pending work.'
		);
	if (typeof cursor.seq !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(cursor.seq))
		throw new ApiError(400, 'invalid_cursor', 'Invalid synchronization sequence.');
	return BigInt(cursor.seq);
}
