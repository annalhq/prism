export function normalizeUrl(input: string): { url: string; canonicalUrl: string; domain: string } {
	if (input.length > 8192 || /[\s\\]|\p{Cc}/u.test(input)) {
		throw new Error(
			'Use an HTTP or HTTPS URL without whitespace, controls or backslashes (maximum 8192 characters).'
		);
	}
	if (!/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(input))
		throw new Error('Use an absolute HTTP or HTTPS URL without credentials.');
	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw new Error('Enter a valid HTTP or HTTPS URL.');
	}
	if (!parsed.hostname || parsed.username || parsed.password || parsed.href.length > 8192) {
		throw new Error('URLs must have a host and cannot contain credentials.');
	}
	// URL normalizes scheme, host and default port. Never sort queries, strip fragments,
	// remove tracking parameters, or lowercase a path: these can identify different content.
	return { url: input, canonicalUrl: parsed.href, domain: parsed.hostname };
}
