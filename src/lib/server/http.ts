export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message);
	}
}

function safeErrorDetails(error: unknown) {
	if (!error || typeof error !== 'object') return { errorName: typeof error };
	const value = error as { name?: unknown; code?: unknown; cause?: unknown };
	const cause = value.cause && typeof value.cause === 'object'
		? (value.cause as { name?: unknown; code?: unknown })
		: undefined;
	const safeCode = (code: unknown) =>
		typeof code === 'string' && /^[A-Z0-9_]{3,32}$/.test(code) ? code : undefined;
	return {
		errorName: typeof value.name === 'string' ? value.name : 'Error',
		...(safeCode(value.code) ? { errorCode: safeCode(value.code) } : {}),
		...(cause && typeof cause.name === 'string' ? { causeName: cause.name } : {}),
		...(cause && safeCode(cause.code) ? { causeCode: safeCode(cause.code) } : {})
	};
}

export { safeErrorDetails };

export function apiErrorResponse(error: unknown, requestId: string): Response {
	const known = error instanceof ApiError;
	return Response.json(
		{
			code: known ? error.code : 'internal_error',
			message: known ? error.message : 'The request could not be completed.',
			requestId
		},
		{ status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } }
	);
}
