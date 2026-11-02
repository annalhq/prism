import type { RequestHandler } from './$types';
import { MAX_NOTE_BYTES, NoteValidationError, validateNoteBody } from '#lib/domain/notes.js';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { renderMarkdown } from '#lib/server/markdown.js';
import { boundedRequest } from '#lib/server/request-policy.js';

// Renders a text item's Markdown to sanitised HTML with Sätteri. The owner-only API guard in
// hooks applies; the body is held to the same limits as a note.
export const POST: RequestHandler = async (event) => {
	try {
		await requireOwner(event);
		if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			throw new ApiError(415, 'json_required', 'Use application/json.');
		const request = await boundedRequest(event.request, MAX_NOTE_BYTES * 2);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Send the Markdown as JSON.');
		}
		const markdown = (input as { markdown?: unknown } | null)?.markdown;
		try {
			validateNoteBody(markdown);
		} catch (error) {
			if (error instanceof NoteValidationError)
				throw new ApiError(400, 'invalid_markdown', error.message);
			throw error;
		}
		return Response.json({ html: renderMarkdown(markdown as string) });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
