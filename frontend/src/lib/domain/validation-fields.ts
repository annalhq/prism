import type { Revision } from './contracts.js';

export class ValidationError extends Error {}
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ValidationError('Expected an object.');
	return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new ValidationError('Unknown field.');
}
export function uuid(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
	)
		throw new ValidationError('Expected a UUID.');
	return value.toLowerCase();
}
export function text(value: unknown, max: number, required = false): string {
	if (
		typeof value !== 'string' ||
		!value.isWellFormed() ||
		value.includes('\0') ||
		[...value].length > max ||
		(required && !value.trim())
	)
		throw new ValidationError(
			`Expected ${required ? 'nonempty ' : ''}text of at most ${max} characters.`
		);
	return value;
}
export function revision(value: unknown): Revision {
	if (
		typeof value !== 'string' ||
		!/^[1-9]\d{0,18}$/.test(value) ||
		BigInt(value) > 9223372036854775807n
	)
		throw new ValidationError('Expected a positive decimal revision within signed bigint range.');
	return value as Revision;
}
