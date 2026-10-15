import {
	MAX_BULK_BOOKMARKS,
	MAX_COMMAND_BYTES,
	serializedBytes,
	type BulkBookmarkCommand,
	type CommandEnvelope,
	type CommandResult
} from './contracts.js';
import { parseCommand } from './validation.js';
import { uuid, ValidationError } from './validation-fields.js';

export type BookmarkBulkEnvelope = CommandEnvelope & {
	command: { type: 'bookmark.bulk'; commands: BulkBookmarkCommand[] };
};
export type ChunkOutcome = {
	index: number;
	operationId: string;
} & (
	{ status: 'accepted' | 'rejected'; result: CommandResult } | { status: 'uncertain' | 'not_sent' }
);

// Construct once and retain these envelopes for replay. A timed-out chunk must use
// the identical operation ID/payload; never rebuild it with a fresh operation ID.
export function prepareBookmarkChunks(
	commands: BulkBookmarkCommand[],
	operationId: () => string
): BookmarkBulkEnvelope[] {
	if (!commands.length) throw new ValidationError('A bulk job requires at least one bookmark.');
	if (new Set(commands.map((command) => command.id.toLowerCase())).size !== commands.length)
		throw new ValidationError('Each bookmark may occur only once in a bulk job.');
	const chunks: BookmarkBulkEnvelope[] = [];
	for (let index = 0; index < commands.length; index += MAX_BULK_BOOKMARKS) {
		const command = parseCommand({
			type: 'bookmark.bulk',
			commands: commands.slice(index, index + MAX_BULK_BOOKMARKS)
		});
		if (command.type !== 'bookmark.bulk')
			throw new ValidationError('Expected a bookmark bulk command.');
		const envelope: BookmarkBulkEnvelope = {
			protocolVersion: 1,
			operationId: uuid(operationId()),
			command
		};
		if (serializedBytes(envelope) > MAX_COMMAND_BYTES)
			throw new ValidationError('Bulk request exceeds 1 MiB; reduce the chunk size.');
		chunks.push(envelope);
	}
	if (new Set(chunks.map((chunk) => chunk.operationId)).size !== chunks.length)
		throw new ValidationError('Each chunk requires a distinct operation ID.');
	return chunks;
}
export async function submitBookmarkChunks(
	envelopes: readonly BookmarkBulkEnvelope[],
	send: (envelope: BookmarkBulkEnvelope) => Promise<CommandResult>
): Promise<ChunkOutcome[]> {
	const outcomes: ChunkOutcome[] = [];
	let uncertain = false;
	for (const [index, envelope] of envelopes.entries()) {
		const identity = { index, operationId: envelope.operationId };
		if (uncertain) {
			outcomes.push({ ...identity, status: 'not_sent' });
			continue;
		}
		try {
			const result = await send(envelope);
			if (
				result.operationId !== envelope.operationId ||
				result.protocolVersion !== 1 ||
				result.status === 'already_exists'
			)
				throw new Error('Unexpected bulk response.');
			outcomes.push({ ...identity, status: result.status, result });
		} catch {
			outcomes.push({ ...identity, status: 'uncertain' });
			uncertain = true;
		}
	}
	return outcomes;
}
