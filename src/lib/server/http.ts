export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message);
	}
}

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
