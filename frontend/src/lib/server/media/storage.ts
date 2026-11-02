import * as env from '$app/env/private';
import { Files, FilesError } from 'files-sdk';
import { neon } from 'files-sdk/neon';

// Neon Object Storage through the Files SDK. The bucket is private: objects are only ever read
// back by the server and streamed to the signed-in owner. Objects branch with the database, so a
// Neon branch's person_avatars rows and their photos stay in step.

/** A failure talking to the bucket. Its message names the step and code, never a secret. */
export class MediaError extends Error {
	override name = 'MediaError';
}

// Pasted settings often carry a trailing newline, spaces or quotes; read them without that.
const setting = (value: string | undefined) =>
	value
		?.trim()
		.replace(/^(['"])(.*)\1$/, '$2')
		.trim() || undefined;
// Production (Vercel) sets NEON_STORAGE_*, because Vercel reserves the AWS_* names for its own
// credentials; locally, `neon env pull` writes AWS_*. Credentials are always passed explicitly,
// so an ambient AWS credential chain can never be used by mistake.
const config = {
	bucket: setting(env.NEON_STORAGE_BUCKET) ?? 'uploads',
	endpoint: setting(env.NEON_STORAGE_ENDPOINT) ?? setting(env.AWS_ENDPOINT_URL_S3),
	region: setting(env.NEON_STORAGE_REGION) ?? setting(env.AWS_REGION),
	accessKeyId: setting(env.NEON_STORAGE_ACCESS_KEY_ID) ?? setting(env.AWS_ACCESS_KEY_ID),
	secretAccessKey: setting(env.NEON_STORAGE_SECRET_ACCESS_KEY) ?? setting(env.AWS_SECRET_ACCESS_KEY)
};

let client: Files | undefined;

export function storageConfigured(): boolean {
	return !!(config.endpoint && config.accessKeyId && config.secretAccessKey);
}

function storage(): Files {
	if (!storageConfigured()) throw new MediaError('Object storage is not configured.');
	return (client ??= new Files({
		adapter: neon({
			bucket: config.bucket,
			endpoint: config.endpoint,
			region: config.region,
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		})
	}));
}

/** Rewords a storage failure as the step plus Files SDK's code (NotFound, Unauthorized, …). */
function failed(step: string, error: unknown): MediaError {
	const code =
		error instanceof FilesError ? ` ${error.code}${error.aborted ? ', timed out' : ''}` : '';
	return new MediaError(`Object storage ${step} failed (${code.trim() || 'unknown'}).`);
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
	try {
		await storage().upload(key, body, { contentType });
	} catch (error) {
		if (error instanceof MediaError) throw error;
		throw failed('upload', error);
	}
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Uint8Array | null> {
	try {
		const file = await storage().download(key);
		return new Uint8Array(await file.arrayBuffer());
	} catch (error) {
		if (error instanceof FilesError && error.code === 'NotFound') return null;
		if (error instanceof MediaError) throw error;
		throw failed('read', error);
	}
}
