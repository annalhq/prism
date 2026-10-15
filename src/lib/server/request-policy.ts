import { ApiError } from './http.js';

export async function boundedRequest(request: Request, limit: number): Promise<Request> {
	if (!request.body) return request;
	const reader = request.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let bytes = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > limit) {
				await reader.cancel();
				throw new ApiError(413, 'body_too_large', 'Request body exceeds the limit.');
			}
			chunks.push(new Uint8Array(part.value));
		}
	} finally {
		reader.releaseLock();
	}
	return new Request(request, { body: new Blob(chunks) });
}

// A bounded per-process guard; host-level throttling remains necessary across replicas.
const attempts = new Map<string, { count: number; until: number }>();
export function limitSignIn(address: string): void {
	const now = Date.now();
	for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
	const current = attempts.get(address);
	if (current && current.count >= 10)
		throw new ApiError(
			429,
			'sign_in_throttled',
			'Too many sign-in attempts. Try again in a few minutes.'
		);
	if (!current && attempts.size >= 1000)
		throw new ApiError(429, 'sign_in_throttled', 'Sign-in is busy. Try again in a few minutes.');
	attempts.set(address, {
		count: (current?.count ?? 0) + 1,
		until: current?.until ?? now + 300_000
	});
}
