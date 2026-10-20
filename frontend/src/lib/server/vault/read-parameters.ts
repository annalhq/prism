import { uuid, ValidationError } from '#lib/domain/validation.js';
import type { Revision } from '#lib/domain/contracts.js';
import { ApiError } from '../http.js';

export function entityId(value: unknown): string {
	try {
		return uuid(value);
	} catch (error) {
		if (error instanceof ValidationError) throw new ApiError(400, 'invalid_id', error.message);
		throw error;
	}
}
export function historyBefore(value: string | null): Revision | undefined {
	if (value === null) return undefined;
	if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
		throw new ApiError(400, 'invalid_cursor', 'Use a positive decimal revision for before.');
	return value as Revision;
}
