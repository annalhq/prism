import { renderNote } from '#lib/domain/notes.js';

// Text items' Markdown as HTML: rendered by the server with Sätteri, and cached, so reopening a
// note shows it at once. Offline, or if the server can't answer, the local note renderer (same
// safety policy: no raw HTML, safe links only) takes over so the note still reads well.
const cache = new Map<string, Promise<string>>();

export function renderMarkdown(markdown: string): Promise<string> {
	let html = cache.get(markdown);
	if (!html) {
		html = fetch('/api/v1/markdown', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ markdown })
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('render failed');
				const body = (await response.json()) as { html?: unknown };
				if (typeof body.html !== 'string') throw new Error('render failed');
				return body.html;
			})
			.catch(() => {
				cache.delete(markdown);
				return renderNote(markdown);
			});
		if (cache.size >= 100) cache.delete(cache.keys().next().value!);
		cache.set(markdown, html);
	}
	return html;
}
