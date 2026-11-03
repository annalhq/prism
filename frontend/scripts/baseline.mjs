// Static payload baseline for the production client build. Browser timing, API counts and
// bootstrap bytes come from scripts/performance-library.mjs; this script only reads build output.
import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const CLIENT = '.svelte-kit/output/client';
const GENERATED = '.svelte-kit/generated/build/client-optimized';

/** @param {string} directory @returns {Promise<string[]>} */
async function filesIn(directory) {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	const paths = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? filesIn(path) : [path];
		})
	);
	return paths.flat();
}

/** @param {string} file */
async function measure(file) {
	const contents = await readFile(file);
	return {
		file: relative(CLIENT, file),
		bytes: contents.byteLength,
		gzipBytes: gzipSync(contents).byteLength
	};
}

/** @param {{ file: string; bytes: number; gzipBytes: number }[]} assets */
function totals(assets) {
	/** @param {RegExp} pattern */
	const sum = (pattern) => {
		const selected = assets.filter((asset) => pattern.test(asset.file));
		return {
			files: selected.length,
			bytes: selected.reduce((total, asset) => total + asset.bytes, 0),
			gzipBytes: selected.reduce((total, asset) => total + asset.gzipBytes, 0)
		};
	};
	return {
		javascript: sum(/\.js$/),
		css: sum(/\.css$/),
		wasm: sum(/\.wasm$/),
		fonts: sum(/\.woff2?$/),
		other: sum(/^(?!.*\.(?:js|css|wasm|woff2?)$)/)
	};
}

/** @param {string[]} args */
function git(...args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

const manifest = JSON.parse(
	await readFile(join(CLIENT, '.vite/manifest.json'), 'utf8').catch(() => {
		throw new Error('No production build found. Run bun run build before bun run bench.');
	})
);
const byKey = new Map(Object.entries(manifest));
/** @param {string} suffix */
const entryKey = (suffix) => [...byKey.keys()].find((key) => key.endsWith(suffix));

/**
 * Files a browser requests for a route before running it: the static-import closure (what
 * SvelteKit modulepreloads) plus CSS and assets such as fonts. Dynamic imports are listed
 * separately because they load only when a feature asks for them.
 * @param {string[]} roots
 */
function closure(roots) {
	const files = new Set();
	const lazy = new Set();
	const seen = new Set();
	/** @param {string} key */
	const visit = (key) => {
		if (!key || seen.has(key)) return;
		seen.add(key);
		const chunk = manifest[key];
		if (!chunk) return;
		files.add(chunk.file);
		for (const css of chunk.css ?? []) files.add(css);
		for (const asset of chunk.assets ?? []) files.add(asset);
		for (const child of chunk.imports ?? []) visit(child);
		for (const child of chunk.dynamicImports ?? []) lazy.add(child);
	};
	roots.forEach(visit);
	const lazyFiles = [...lazy]
		.filter((key) => !seen.has(key))
		.map((key) => manifest[key]?.file)
		.filter((file) => file && !files.has(file));
	return { files: [...files], lazyFiles: [...new Set(lazyFiles)] };
}

// Route → node indices from the generated client dictionary ("/": [~2] means layout 0 + node 2).
const app = await readFile(join(GENERATED, 'app.js'), 'utf8');
const dictionary = [...app.matchAll(/"([^"]+)":\s*\[([^\]]*)\]/g)].map(([, route, nodes]) => ({
	route,
	nodes: [0, ...[...nodes.matchAll(/~?(\d+)/g)].map((match) => Number(match[1]))]
}));
const baseEntries = [
	entryKey('runtime/client/entry.js'),
	entryKey('client-optimized/app.js')
].filter((key) => key !== undefined);

/** @type {Record<string, { requested: ReturnType<typeof totals>; lazy: ReturnType<typeof totals>; requestedFiles: { file: string; gzipBytes: number }[] }>} */
const routes = {};
for (const { route, nodes } of dictionary) {
	const roots = [
		...baseEntries,
		...nodes.map((node) => entryKey(`client-optimized/nodes/${node}.js`))
	].filter((key) => key !== undefined);
	const { files, lazyFiles } = closure(roots);
	const requested = await Promise.all(files.map((file) => measure(join(CLIENT, file))));
	const deferred = await Promise.all(lazyFiles.map((file) => measure(join(CLIENT, file))));
	routes[route] = {
		requested: totals(requested),
		lazy: totals(deferred),
		requestedFiles: requested.map(({ file, gzipBytes }) => ({ file, gzipBytes }))
	};
}

// The service worker precaches every immutable build file plus every static asset at install.
const allFiles = await filesIn(CLIENT);
const buildAssets = await Promise.all(
	allFiles.filter((file) => !file.includes('/.vite/')).map((file) => measure(file))
);
const staticFiles = new Set(
	(await filesIn('static')).map((file) => relative('static', file).split('\\').join('/'))
);
const precached = buildAssets.filter(
	(asset) => asset.file.startsWith('_app/immutable/') || staticFiles.has(asset.file)
);

const report = {
	measuredAt: new Date().toISOString(),
	commit: git('rev-parse', 'HEAD'),
	workingTreeDirty: git('status', '--porcelain') !== '',
	node: process.version,
	method: {
		bytes: 'Uncompressed emitted file size.',
		gzipBytes:
			'Each file gzipped separately at default level: an estimate, not negotiated transfer bytes (the host may use Brotli, and HTTP caching is ignored).',
		routes:
			'Static-import closure of the SvelteKit start/app entries plus the route nodes (layout + page), with their CSS and referenced assets. `lazy` lists dynamic imports reachable from that closure, loaded only on demand.',
		serviceWorker:
			'Files the service worker precaches on install (_app/immutable plus static/), downloaded in the background after the first visit. The root HTML shell is fetched in addition and is not counted.'
	},
	routes,
	serviceWorkerPrecache: totals(precached),
	wholeBuild: {
		note: 'Every emitted client file; not what any one page downloads.',
		...totals(buildAssets)
	}
};

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/baseline.json', `${JSON.stringify(report, null, 2)}\n`);
/** @param {number} value */
const kb = (value) => `${(value / 1024).toFixed(1)} KiB`;
console.log(`commit ${report.commit}${report.workingTreeDirty ? ' (dirty)' : ''}`);
for (const [route, value] of Object.entries(routes)) {
	const r = value.requested;
	console.log(
		`${route.padEnd(24)} JS ${kb(r.javascript.gzipBytes)} gz · CSS ${kb(r.css.gzipBytes)} gz · WASM ${kb(r.wasm.bytes)} · fonts ${kb(r.fonts.bytes)} · lazy JS ${kb(value.lazy.javascript.gzipBytes)} gz`
	);
}
const sw = report.serviceWorkerPrecache;
console.log(
	`service worker precache  ${sw.javascript.files + sw.css.files + sw.wasm.files + sw.fonts.files + sw.other.files} files · ${kb(Object.values(sw).reduce((total, part) => total + part.gzipBytes, 0))} gz`
);
console.log('Full report: artifacts/baseline.json');
