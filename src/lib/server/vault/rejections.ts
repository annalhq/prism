import type { CommandResult } from '#lib/domain/contracts.js';

type Rejection = Extract<CommandResult, { status: 'rejected' }>['error'];
export class Rejected extends Error {
	constructor(readonly detail: Rejection) {
		super(detail.message);
	}
}
export function reject(
	code: Rejection['code'],
	message: string,
	detail: Omit<Rejection, 'code' | 'message'> = {}
): never {
	throw new Rejected({ code, message, ...detail });
}
