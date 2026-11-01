import { B2_APP_KEY, B2_BUCKET, B2_ENDPOINT, B2_KEY_ID, B2_REGION } from '$app/env/private';
import { AwsClient } from 'aws4fetch';

// Backblaze B2 through its S3-compatible API, signed with SigV4. The bucket is private: objects
// are only ever read back by the server and streamed to the signed-in owner.

let client: AwsClient | undefined;

/** A failure talking to the bucket. Its message names the step and status, never a secret. */
export class MediaError extends Error {
	override name = 'MediaError';
}

export function storageConfigured(): boolean {
	return !!(B2_BUCKET && B2_ENDPOINT && B2_REGION && B2_KEY_ID && B2_APP_KEY);
}

function storage(): AwsClient {
	if (!storageConfigured()) throw new MediaError('Object storage is not configured.');
	return (client ??= new AwsClient({
		accessKeyId: B2_KEY_ID!,
		secretAccessKey: B2_APP_KEY!,
		service: 's3',
		region: B2_REGION!
	}));
}

// Path-style addressing: https://s3.<region>.backblazeb2.com/<bucket>/<key>.
function objectUrl(key: string): string {
	const endpoint = /^https?:\/\//.test(B2_ENDPOINT!) ? B2_ENDPOINT! : `https://${B2_ENDPOINT}`;
	const path = key.split('/').map(encodeURIComponent).join('/');
	return `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(B2_BUCKET!)}/${path}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
	const response = await storage().fetch(objectUrl(key), {
		method: 'PUT',
		body: body as BodyInit,
		headers: { 'Content-Type': contentType, 'Content-Length': String(body.byteLength) },
		signal: AbortSignal.timeout(15_000)
	});
	if (!response.ok) throw new MediaError(`Object storage refused the upload (${response.status}).`);
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Uint8Array | null> {
	const response = await storage().fetch(objectUrl(key), {
		signal: AbortSignal.timeout(15_000)
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new MediaError(`Object storage read failed (${response.status}).`);
	return new Uint8Array(await response.arrayBuffer());
}
