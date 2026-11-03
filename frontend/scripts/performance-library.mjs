// Browser load-path measurements against a production build with deterministic, mocked APIs.
//
//   bun run build && node scripts/performance-library.mjs [options]
//
//   --size empty|medium|large   fixture library (default medium: ~500 bookmarks)
//   --samples N                 samples per scenario (default 10)
//   --scenarios a,b             cold,cold-backend,warm,search,offline (default all)
//   --latency MS                added to every mocked API response (default 40)
//   --cold-start MS             extra delay on the first API response of a cold-backend sample
//                               (default 1500); simulated, not a measured Neon/Vercel cold start
//   --base URL                  use an already running server instead of starting vite preview
//   --transport batch|per-table bootstrap transport the mocked server offers (default batch);
//                               per-table reproduces a server without bootstrap-batch-v1
//
// No real database, auth or storage is touched: the preview server runs with those settings
// blanked (as in playwright.config.ts) and every /api/v1 request is answered by this script.
// The signed-in page state is produced by rewriting the SSR payload of the root document, so
// server-side session verification is NOT part of these numbers. Use the Server-Timing header
// (session, vault, auth, sync, command, queries, total) on a real deployment for backend stages.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

/** @typedef {import('@playwright/test').Browser} Browser */
/** @typedef {import('@playwright/test').BrowserContext} BrowserContext */
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Route} Route */
/** @typedef {import('../src/lib/domain/replica.js').ReplicaRecord} ReplicaRecord */
/**
 * @typedef {{
 *   navigation: { responseEnd: number; domContentLoaded: number; load: number; documentBytes: number } | null;
 *   marks: Record<string, number>;
 *   details: Record<string, unknown>;
 *   search: { duration: number } | null;
 *   resources: { js: number; css: number; wasm: number; font: number; jsFiles: number };
 * }} Collected
 */
/** @typedef {Collected & { markOrigin: string; api: { requests: number; byEndpoint: Record<string, number>; bootstrapBytes: number } }} Sample */

const { values: options } = parseArgs({
	options: {
		size: { type: 'string', default: 'medium' },
		samples: { type: 'string', default: '10' },
		scenarios: { type: 'string', default: 'cold,cold-backend,warm,search,offline' },
		latency: { type: 'string', default: '40' },
		transport: { type: 'string', default: 'batch' },
		'cold-start': { type: 'string', default: '1500' },
		base: { type: 'string' }
	}
});
const samples = Math.max(1, Number(options.samples));
const latency = Math.max(0, Number(options.latency));
if (!['batch', 'per-table'].includes(options.transport))
	throw new Error('Unknown transport; use batch or per-table.');
const batched = options.transport === 'batch';
const coldStart = Math.max(0, Number(options['cold-start']));
const scenarios = options.scenarios.split(',').map((name) => name.trim());
const known = ['cold', 'cold-backend', 'warm', 'search', 'offline'];
for (const name of scenarios)
	if (!known.includes(name)) throw new Error(`Unknown scenario ${name}; use ${known.join(', ')}.`);

// Node strips the fixture's type-only imports natively (Node 22.18+).
const { performanceLibrary, performanceSequence, PERFORMANCE_IDENTITY, PERFORMANCE_SIZES } =
	await import('../tests/fixtures/performance-library.ts');
if (!(options.size in PERFORMANCE_SIZES))
	throw new Error(
		`Unknown size ${options.size}; use ${Object.keys(PERFORMANCE_SIZES).join(', ')}.`
	);
const size = /** @type {keyof typeof PERFORMANCE_SIZES} */ (options.size);
const records = performanceLibrary(size);
const sequence = performanceSequence(records);
/** @type {Map<string, ReplicaRecord[]>} */
const byTable = new Map();
for (const record of records) {
	const rows = byTable.get(record.table) ?? [];
	rows.push(record);
	byTable.set(record.table, rows);
}
for (const rows of byTable.values())
	rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const TABLES = [
	'bookmarks',
	'entities',
	'people',
	'personas',
	'notes',
	'tags',
	'collections',
	'links',
	'identities',
	'relationships',
	'memberships',
	'savedSearches',
	'activity'
];
const PAGE_RECORDS = 200;
const cursor = `perf.${sequence}`;
const token = `00000000-0000-4000-8000-000000000000.${'a'.repeat(64)}`;

// ---------------------------------------------------------------------------------------------
// Server

const PORT = 4173;
/** @type {import('node:child_process').ChildProcess | undefined} */
let server;
const base = options.base ?? `http://127.0.0.1:${PORT}`;
async function startServer() {
	if (options.base) return;
	if (!existsSync('.svelte-kit/output/server'))
		throw new Error('No production build found. Run bun run build first.');
	const blank = Object.fromEntries(
		[
			'DATABASE_URL',
			'DATABASE_URL_DIRECT',
			'OWNER_SUBJECT',
			'NEON_AUTH_BASE_URL',
			'NEON_AUTH_COOKIE_SECRET',
			'NEON_STORAGE_ENDPOINT',
			'NEON_STORAGE_ACCESS_KEY_ID',
			'NEON_STORAGE_SECRET_ACCESS_KEY',
			'AWS_ENDPOINT_URL_S3',
			'AWS_ACCESS_KEY_ID',
			'AWS_SECRET_ACCESS_KEY'
		].map((name) => [name, ''])
	);
	server = spawn(
		process.execPath,
		[
			'node_modules/vite/bin/vite.js',
			'preview',
			'--host',
			'127.0.0.1',
			'--port',
			String(PORT),
			'--strictPort'
		],
		{
			env: { ...process.env, ...blank, NODE_ENV: 'production', ORIGIN: base, APP_ORIGIN: base },
			stdio: ['ignore', 'ignore', 'inherit']
		}
	);
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(base)).ok) return;
		} catch {
			/* not listening yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Preview server did not start at ${base}.`);
}
function stopServer() {
	server?.kill();
}

// ---------------------------------------------------------------------------------------------
// Mocked API

/** @param {{ cold: boolean }} settings */
function createApi({ cold }) {
	/** @type {Record<string, number>} */
	const counts = {};
	let bootstrapBytes = 0;
	let first = true;
	/** @param {string} name */
	const count = (name) => (counts[name] = (counts[name] ?? 0) + 1);
	async function delay() {
		const extra = cold && first ? coldStart : 0;
		first = false;
		if (latency + extra) await new Promise((resolve) => setTimeout(resolve, latency + extra));
	}
	/** @param {Route} route @param {unknown} value */
	const json = (route, value, status = 200) => {
		const body = JSON.stringify(value);
		return { body, fulfil: () => route.fulfill({ status, contentType: 'application/json', body }) };
	};
	/** @param {Route} route */
	async function handle(route) {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const method = request.method();
		await delay();
		if (path === '/api/v1/session' && method === 'GET') {
			count('session');
			return json(route, PERFORMANCE_IDENTITY).fulfil();
		}
		if (path === '/api/v1/sync/bootstrap' && method === 'POST') {
			count('bootstrapStart');
			const response = json(route, {
				token,
				epoch: '1',
				startSeq: sequence,
				cursor,
				tables: TABLES,
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
				...(batched ? { capabilities: ['bootstrap-batch-v1'] } : {})
			});
			bootstrapBytes += response.body.length;
			return response.fulfil();
		}
		if (batched && path.endsWith('/batch') && method === 'GET') {
			// Same page shape as the server: up to 200 records across consecutive tables.
			count('bootstrapBatch');
			const after = url.searchParams.get('after');
			let { table, key } = after ? JSON.parse(after) : { table: 0, key: '' };
			/** @type {ReplicaRecord[]} */
			const records = [];
			while (table < TABLES.length && records.length < PAGE_RECORDS) {
				const remaining = (byTable.get(TABLES[table]) ?? []).filter((row) => row.key > key);
				const page = remaining.slice(0, PAGE_RECORDS - records.length);
				records.push(...page);
				if (remaining.length > page.length) key = page[page.length - 1].key;
				else [table, key] = [table + 1, ''];
			}
			const response = json(route, {
				records,
				nextAfter: table < TABLES.length ? JSON.stringify({ table, key }) : null
			});
			bootstrapBytes += response.body.length;
			return response.fulfil();
		}
		if (path.startsWith('/api/v1/sync/bootstrap/') && method === 'GET') {
			count('bootstrapPage');
			const rows = byTable.get(url.searchParams.get('table') ?? '') ?? [];
			const after = url.searchParams.get('after') ?? '';
			const remaining = rows.filter((row) => row.key > after);
			const page = remaining.slice(0, PAGE_RECORDS);
			const response = json(route, {
				records: page,
				nextAfter: remaining.length > page.length ? page[page.length - 1].key : null
			});
			bootstrapBytes += response.body.length;
			return response.fulfil();
		}
		if (path.startsWith('/api/v1/sync/bootstrap/') && method === 'DELETE') {
			count('bootstrapRelease');
			return route.fulfill({ status: 204 });
		}
		if (path === '/api/v1/sync/changes' && method === 'GET') {
			count('changes');
			const response = json(route, { frames: [], cursor, hasMore: false, epoch: '1' });
			bootstrapBytes += response.body.length;
			return response.fulfil();
		}
		if (path === '/api/v1/markdown' && method === 'POST') {
			count('markdown');
			// Placeholder HTML: this measures request volume, not server rendering cost.
			return json(route, { html: '<p>rendered</p>' }).fulfil();
		}
		count(`other ${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
		return json(route, { error: { code: 'not_mocked', message: 'Not mocked.' } }, 404).fulfil();
	}
	return {
		handle,
		result: () => ({
			requests: Object.values(counts).reduce((total, value) => total + value, 0),
			byEndpoint: { ...counts },
			bootstrapBytes
		})
	};
}

/** Serves the root document with a signed-in SSR payload; nothing else in the HTML changes. */
/** @param {Route} route */
async function signedInDocument(route) {
	const response = await route.fetch();
	const html = await response.text();
	const identity = JSON.stringify(PERFORMANCE_IDENTITY);
	const rewritten = html.replace(
		/data:\{configured:(?:true|false),signedIn:false,identity:null,message:null\}/,
		`data:{configured:true,signedIn:true,identity:${identity},message:null}`
	);
	if (rewritten === html)
		throw new Error('Could not find the signed-out SSR payload to rewrite; update the harness.');
	return route.fulfill({ response, body: rewritten });
}

// ---------------------------------------------------------------------------------------------
// Browser

// Playwright's own Chromium by default; PRISM_CHROMIUM points at another build.
function launchOptions() {
	return process.env.PRISM_CHROMIUM ? { executablePath: process.env.PRISM_CHROMIUM } : {};
}

/** @param {Browser} browser */
async function newContext(browser) {
	// Service workers would bypass request interception; precache cost is in bench (baseline.mjs).
	return browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
}

/** @param {string} url */
const isRoot = (url) => new URL(url).pathname === '/';
const MILESTONES = [
	'identity-available',
	'dexie-open',
	'replica-read',
	'bootstrap-start',
	'bootstrap-complete',
	'replica-ready',
	'first-bookmark-rendered',
	'search-first-complete',
	'sync-complete'
];

/** @param {Page} page @returns {Promise<Collected>} */
async function collect(page) {
	return page.evaluate(() => {
		const nav = /** @type {PerformanceNavigationTiming | undefined} */ (
			performance.getEntriesByType('navigation')[0]
		);
		/** @type {Record<string, number>} */
		const marks = {};
		/** @type {Record<string, unknown>} */
		const details = {};
		for (const mark of /** @type {PerformanceMark[]} */ (performance.getEntriesByType('mark')))
			if (mark.name.startsWith('prism:')) {
				marks[mark.name.slice(6)] = mark.startTime;
				if (mark.detail) details[mark.name.slice(6)] = mark.detail;
			}
		// The first query is the initial list (or the ?q= search); later ones re-run on sync.
		const search = /** @type {PerformanceMeasure | undefined} */ (
			performance.getEntriesByName('prism:search', 'measure')[0]
		);
		const resources = { js: 0, css: 0, wasm: 0, font: 0, jsFiles: 0 };
		for (const entry of /** @type {PerformanceResourceTiming[]} */ (
			performance.getEntriesByType('resource')
		)) {
			const path = new URL(entry.name).pathname;
			const size = entry.transferSize || entry.encodedBodySize;
			if (path.endsWith('.js')) {
				resources.js += size;
				resources.jsFiles++;
			} else if (path.endsWith('.css')) resources.css += size;
			else if (path.endsWith('.wasm')) resources.wasm += size;
			else if (/\.woff2?$/.test(path)) resources.font += size;
		}
		return {
			navigation: nav
				? {
						responseEnd: nav.responseEnd,
						domContentLoaded: nav.domContentLoadedEventEnd,
						load: nav.loadEventEnd,
						documentBytes: nav.transferSize || nav.encodedBodySize
					}
				: null,
			marks,
			details,
			search: search ? { duration: search.duration, ...search.detail } : null,
			resources
		};
	});
}

/** @param {Page} page @param {{ empty: boolean; offline: boolean }} settings */
async function waitForLibrary(page, { empty, offline }) {
	const marks = [empty ? 'prism:replica-ready' : 'prism:first-bookmark-rendered'];
	// Offline never syncs; online samples also wait for the first background sync to finish.
	if (!offline) marks.push('prism:sync-complete');
	await page.waitForFunction(
		(/** @type {string[]} */ names) =>
			names.every((name) => performance.getEntriesByName(name, 'mark').length > 0),
		marks,
		{ timeout: 60_000 }
	);
	// Let the initial query settle so its search measure is recorded.
	await page.waitForTimeout(150);
}

/** @typedef {{ path?: string; cold?: boolean; offline?: boolean }} SampleSettings */
/** @param {BrowserContext} context @param {SampleSettings} settings @returns {Promise<Sample>} */
async function sample(context, { path = '/', cold = false, offline = false } = {}) {
	const api = createApi({ cold });
	const page = await context.newPage();
	await page.route('**/api/v1/**', api.handle);
	if (offline) {
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
		});
	} else await page.route((url) => isRoot(url.href), signedInDocument);
	try {
		await page.goto(base + path, { waitUntil: 'domcontentloaded' });
		let origin = 0;
		if (offline)
			// The landing animation keeps the button moving; a DOM click avoids waiting for it.
			// Offline milestones are measured from this click, not from navigation start.
			origin = await page.getByRole('button', { name: /Open cached library/ }).evaluate(
				(button) => {
					const now = performance.now();
					/** @type {HTMLElement} */ (button).click();
					return now;
				},
				undefined,
				{ timeout: 30_000 }
			);
		await waitForLibrary(page, { empty: size === 'empty', offline });
		const result = await collect(page);
		for (const name of Object.keys(result.marks)) result.marks[name] -= origin;
		return {
			...result,
			markOrigin: offline ? 'offline-open-click' : 'navigation',
			api: api.result()
		};
	} finally {
		await page.close();
	}
}

/** @param {number[]} values */
const median = (values) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
/** @param {number | null} value */
const round = (value) => (value == null ? null : Math.round(value * 10) / 10);
/** @param {Sample[]} runs */
function summarize(runs) {
	/** @type {Record<string, number[]>} */
	const series = {};
	/** @param {string} name @param {number | undefined} value */
	const add = (name, value) => {
		if (typeof value === 'number') (series[name] ??= []).push(value);
	};
	for (const run of runs) {
		for (const name of MILESTONES) add(`mark:${name}`, run.marks[name]);
		add('navigation:responseEnd', run.navigation?.responseEnd);
		add('navigation:domContentLoaded', run.navigation?.domContentLoaded);
		add('search:duration', run.search?.duration);
		add('api:requests', run.api.requests);
		add('api:bootstrapBytes', run.api.bootstrapBytes);
		add('resources:jsBytes', run.resources.js);
		add('resources:cssBytes', run.resources.css);
		add('resources:wasmBytes', run.resources.wasm);
	}
	return Object.fromEntries(
		Object.entries(series).map(([name, values]) => [
			name,
			{
				median: round(median(values)),
				min: round(Math.min(...values)),
				max: round(Math.max(...values)),
				n: values.length
			}
		])
	);
}

// ---------------------------------------------------------------------------------------------
// Run

/** @param {string[]} args */
function git(...args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

await startServer();
const browser = await chromium.launch(launchOptions());
const browserVersion = browser.version();
/** @type {Record<string, { summary: ReturnType<typeof summarize>; runs: Sample[] }>} */
const results = {};
try {
	/** @param {string} name @param {() => Promise<Sample>} take */
	const run = async (name, take) => {
		const runs = [];
		for (let index = 0; index < samples; index++) {
			runs.push(await take());
			process.stdout.write(`\r${name}: ${index + 1}/${samples}`);
		}
		process.stdout.write('\n');
		results[name] = { summary: summarize(runs), runs };
	};
	/** @param {SampleSettings} settings */
	const fresh = (settings) => async () => {
		const context = await newContext(browser);
		try {
			return await sample(context, settings);
		} finally {
			await context.close();
		}
	};
	if (scenarios.includes('cold')) await run('cold', fresh({}));
	if (scenarios.includes('cold-backend')) await run('cold-backend', fresh({ cold: true }));
	const needsWarm = ['warm', 'search', 'offline'].filter((name) => scenarios.includes(name));
	if (needsWarm.length) {
		// One cold load fills IndexedDB, the owner hint and the HTTP cache; samples reuse them.
		const context = await newContext(browser);
		try {
			await sample(context, {});
			if (scenarios.includes('warm')) await run('warm', () => sample(context, {}));
			if (scenarios.includes('search'))
				await run('search', () => sample(context, { path: '/?q=signal' }));
			if (scenarios.includes('offline'))
				await run('offline', () => sample(context, { offline: true }));
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
	stopServer();
}

const report = {
	measuredAt: new Date().toISOString(),
	commit: git('rev-parse', 'HEAD'),
	workingTreeDirty: git('status', '--porcelain') !== '',
	environment: {
		browser: `chromium ${browserVersion}`,
		node: process.version,
		os: `${platform()} ${release()}`,
		cpu: cpus()[0]?.model ?? 'unknown',
		cpuCount: cpus().length,
		memoryGiB: Math.round(totalmem() / 2 ** 30),
		viewport: '1280x800',
		server: options.base ?? 'vite preview of the local production build (auth/database blanked)',
		network: `Loopback, no throttling. Mocked API responses delayed ${latency} ms; cold-backend adds ${coldStart} ms to the first API response (simulated).`,
		bootstrapTransport: options.transport
	},
	fixture: {
		size: options.size,
		bookmarks: PERFORMANCE_SIZES[size],
		records: records.length,
		tables: Object.fromEntries([...byTable].map(([table, rows]) => [table, rows.length]))
	},
	samplesPerScenario: samples,
	cacheReset: {
		cold: 'New browser context per sample: empty IndexedDB, localStorage and HTTP cache.',
		'cold-backend': 'As cold, with the simulated first-response delay.',
		warm: 'One context primed by an unmeasured cold load; each sample opens a new page in it (warm IndexedDB and HTTP cache).',
		search: 'As warm, loading /?q=signal so the first list query is a text search.',
		offline:
			'As warm, with navigator.onLine forced false, the signed-out shell, and "Open cached library".'
	},
	notes: [
		'Times are milliseconds from navigation start, except offline: from the "Open cached library" click.',
		'Online samples end once the first row is rendered and the first background sync completed.',
		'The offline scenario runs on the landing page, whose WebGL shader competes for the main thread.',
		'Server session verification is excluded: identity comes from a rewritten SSR payload.',
		'Service workers are blocked so requests can be intercepted; see bench for precache bytes.',
		'resources:*Bytes use transferSize (0 when served from HTTP cache) with encodedBodySize fallback.',
		'A small local sample is a comparison aid, not a production latency objective.'
	],
	scenarios: Object.fromEntries(
		Object.entries(results).map(([name, value]) => [name, value.summary])
	),
	runs: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, value.runs]))
};
await mkdir('artifacts', { recursive: true });
const file = `artifacts/performance-library-${options.size}${batched ? '' : '-per-table'}.json`;
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
for (const [name, summary] of Object.entries(report.scenarios)) {
	/** @param {string} key */
	const pick = (key) => summary[key]?.median ?? '–';
	console.log(
		`${name.padEnd(13)} ready ${pick('mark:replica-ready')} ms · first row ${pick('mark:first-bookmark-rendered')} ms · search ${pick('search:duration')} ms · API ${pick('api:requests')} req / ${pick('api:bootstrapBytes')} B`
	);
}
console.log(`Full report: ${file}`);
