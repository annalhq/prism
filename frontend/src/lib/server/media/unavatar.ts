// A person's X photo from unavatar.io. Its free tier allows a small number of lookups a day,
// so every photo it returns is stored in object storage and never asked for again.

export const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_BYTES = 2 * 1024 * 1024;
// When unavatar gives no hint of when the limit resets, wait this long before asking again.
const DEFAULT_WAIT = 60 * 60 * 1000;

export type Mime = 'image/jpeg' | 'image/png' | 'image/webp';
export type UnavatarResult =
	| { kind: 'photo'; bytes: Uint8Array; mime: Mime }
	| { kind: 'missing' }
	| { kind: 'limited'; retryAt: number };

function sniff(bytes: Uint8Array): Mime | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
		return 'image/png';
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

/** When the daily limit lifts: Retry-After, else the reset header, else an hour from now. */
function retryAt(headers: Headers): number {
	const now = Date.now();
	const after = Number(headers.get('retry-after'));
	if (Number.isFinite(after) && after > 0) return now + after * 1000;
	const reset = Number(headers.get('x-rate-limit-reset'));
	if (Number.isFinite(reset) && reset > 0) {
		// Seen as epoch milliseconds, epoch seconds or seconds remaining; accept any of them.
		const at = reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : now + reset * 1000;
		if (at > now) return at;
	}
	return now + DEFAULT_WAIT;
}

export async function fetchXPhoto(handle: string): Promise<UnavatarResult> {
	if (!X_HANDLE.test(handle)) return { kind: 'missing' };
	// `fallback=false` answers 404 instead of a generic placeholder when there is no photo.
	const response = await fetch(
		`https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false`,
		{ headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(10_000) }
	);
	if (response.status === 429) return { kind: 'limited', retryAt: retryAt(response.headers) };
	if (response.status === 404) return { kind: 'missing' };
	if (!response.ok) throw new Error(`unavatar answered ${response.status}.`);
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > MAX_BYTES) return { kind: 'missing' };
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return { kind: 'missing' };
	// Only a real JPEG, PNG or WebP is kept; anything else is treated as no photo.
	const mime = sniff(bytes);
	return mime ? { kind: 'photo', bytes, mime } : { kind: 'missing' };
}
