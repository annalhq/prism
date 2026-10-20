import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { CommandResult } from '#lib/domain/contracts.js';
import { keys, object, uuid, ValidationError } from '#lib/domain/validation.js';
import type { Transaction } from '../db/connection.js';
import { mutationReceipts } from '../db/schema.js';
import { ApiError } from '../http.js';

// Sorting keys makes transport whitespace and property order irrelevant, but leaves
// array order and every supplied field significant, including invalid command fields.
function canonical(value: unknown, depth = 0): string {
	if (depth > 16) throw new ValidationError('Command nesting exceeds the limit.');
	if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, depth + 1)}`)
			.join(',')}}`;
	if (
		value === undefined ||
		typeof value === 'bigint' ||
		typeof value === 'function' ||
		typeof value === 'symbol' ||
		(typeof value === 'number' && !Number.isFinite(value))
	)
		throw new ValidationError('Command must be JSON.');
	return JSON.stringify(value);
}

export function prepareEnvelope(value: unknown) {
	try {
		const envelope = object(value);
		keys(envelope, ['protocolVersion', 'operationId', 'command']);
		if (envelope.protocolVersion !== 1) throw new ValidationError('Unsupported protocol version.');
		const operationId = uuid(envelope.operationId);
		if (!('command' in envelope)) throw new ValidationError('A command is required.');
		const requestHash = createHash('sha256')
			.update(canonical({ protocolVersion: 1, command: envelope.command }))
			.digest('hex');
		return { operationId, requestHash, command: envelope.command };
	} catch (error) {
		if (error instanceof ValidationError)
			throw new ApiError(400, 'invalid_envelope', error.message);
		throw error;
	}
}

export async function readReceipt(
	tx: Transaction,
	vaultId: string,
	operationId: string,
	requestHash: string
): Promise<CommandResult | undefined> {
	const [receipt] = await tx
		.select()
		.from(mutationReceipts)
		.where(
			and(eq(mutationReceipts.vaultId, vaultId), eq(mutationReceipts.operationId, operationId))
		);
	if (!receipt) return;
	if (receipt.requestHash === requestHash) return receipt.result as CommandResult;
	return {
		protocolVersion: 1,
		operationId,
		status: 'rejected',
		error: {
			code: 'operation_id_reused',
			message: 'This operation ID already belongs to a different payload. Use a new operation ID.'
		}
	};
}

export async function writeReceipt(
	tx: Transaction,
	vaultId: string,
	operationId: string,
	requestHash: string,
	result: CommandResult
) {
	await tx.insert(mutationReceipts).values({ vaultId, operationId, requestHash, result });
}
