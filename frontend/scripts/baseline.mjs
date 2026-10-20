import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** @param {string} directory @returns {Promise<string[]>} */
async function filesIn(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const paths = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? filesIn(path) : [path];
		})
	);
	return paths.flat();
}

const files = await filesIn('.svelte-kit/output/client').catch(() => {
	throw new Error('No production build found. Run bun run build before bun run bench.');
});
const assets = await Promise.all(
	files
		.filter((file) => /\.(js|css|woff2)$/.test(file))
		.map(async (file) => {
			const contents = await readFile(file);
			return { file, bytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
		})
);
const report = {
	measuredAt: new Date().toISOString(),
	node: process.version,
	javascriptGzipBytes: assets
		.filter((asset) => asset.file.endsWith('.js'))
		.reduce((sum, asset) => sum + asset.gzipBytes, 0),
	cssGzipBytes: assets
		.filter((asset) => asset.file.endsWith('.css'))
		.reduce((sum, asset) => sum + asset.gzipBytes, 0),
	fontBytes: assets
		.filter((asset) => asset.file.endsWith('.woff2'))
		.reduce((sum, asset) => sum + asset.bytes, 0),
	method:
		'Sum of separately gzipped emitted client files; upper bound on JS/CSS payload, not negotiated network transfer bytes. Fonts reported separately.',
	scope:
		'Task 1 empty shell only. Browser timing and real-library performance deferred to final quality pass.',
	assets
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/baseline.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
