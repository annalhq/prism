# Task 1 foundation baseline

Date: 2026-10-16. Scope: runnable foundation and empty shell, not a connected vault.

## Starting inventory

The workspace initially contained architecture/plan documents, a skill lockfile, local skill definitions and `.gitignore`. It had no application source, package manifest, application lockfile, environment file, database migrations or runnable tests. Git metadata was unavailable at the initial inspection. No live database/object-storage inspection or migration was performed.

Available runtimes: Bun 1.4.0, Node 26.8.1, npm 12.0.2. The application declares Node ≥ 22.17. The installed stack pins SvelteKit 3.1.0, Svelte 5.57.2, Vite 8.3.4, TypeScript 6.0.3, Node adapter 6.0.0, Bits UI 2.19.5 and Phosphor Icons Svelte 2.1.0. Versions were checked against registry peer requirements; the lockfile records transitive dependencies. A maintained Node LTS should be used for deployment.

## Implemented surface

- Server-rendered shell with header, library navigation, main content, desktop inspector and explicit disconnected status.
- Responsive small-screen navigation, skip-to-main link, labeled controls, system light/dark tokens and one self-hosted Inter Latin font with system fallbacks.
- Bits UI about dialog and per-icon Phosphor imports. The icon package supplies `aria-hidden` itself; labels live on the surrounding controls.
- SvelteKit 3 configuration, strict TypeScript, isolated Vitest projects and production Node-adapter Playwright configuration.
- Documented environment names and operational commands. Database/maintenance commands fail clearly until their owning tasks are implemented.
- Asset-size reporting through `bun run bench` after a production build; no browser or remote services required.

No service credentials are required to build/render this shell. There is no authentication, database access, local content storage, sync, search, capture or working People/Persona view yet. Unavailable navigation controls are disabled rather than pretending those capabilities work. Clipper research remains deferred.

## Verification policy and evidence

The user requested deferring excess tests until the project-end quality pass. Final verification: `bun run check` passed with 0 errors and 0 warnings; `bun run lint` passed; `bun run build` completed with the Node adapter; `bun run bench` produced the asset report. Further browser runs, browser installation and timing benchmarks were stopped. Type, lint and production-build checks remain the basic foundation verification.

The SSR smoke test was observed failing against the placeholder shell, then passing against the implemented shell. The latest unit run completed before the user's deferral: 1 test passed. No new functional test execution was started after that instruction.

The attempted browser run did not execute application assertions: the pinned Playwright release required Chromium headless shell revision 1248, while the environment had revision 1243. Browser installation was interrupted by the user's request to defer testing. Desktop/mobile rendering, dialog hydration/focus, no-external-request assertions and accessibility behavior in a real browser therefore remain unverified. The suite is kept for the final pass.

An overlapping-build mistake initially caused a missing generated module; subsequent build verification is sequential. Local server binding also requires sandbox permission in this environment. Neither is recorded as an application defect or a successful browser check.

## Measurements

Production asset measurements from the verified build: **53,593 bytes JS gzip (52.34 KiB)**, **1,893 bytes CSS gzip (1.85 KiB)** and **48,256 bytes self-hosted font (47.12 KiB)**. Measured at `2026-10-15T19:25:43.463Z`. The reproducible raw report is `artifacts/baseline.json` (gitignored); generate it with `bun run build` followed by `bun run bench`.

The report sums separately gzipped emitted JavaScript and CSS files, with font bytes separate. This is an upper bound across emitted client chunks, not a measured initial network payload or negotiated transfer compression. The empty-shell result cannot establish the future populated-vault performance budgets.

Browser shell-ready instrumentation exists, but startup/usable-content timing, CPU/memory traces, cold database latency, request waterfalls, search and large-library rendering are deferred. There is no claim that these have met the architecture's targets.

## Implementation rulings

- Scope is Task 1 only; later plan tasks remain unstarted.
- Use the current SvelteKit 3/TypeScript 6 configuration rather than the historical incompatible TypeScript 5 note.
- Use plain token-based CSS for the baseline; Tailwind remains optional and adds no value to this small shell yet.
- Install database/auth/media libraries when their implementation tasks need them. Reserved commands exit nonzero instead of claiming a successful no-op or contacting services prematurely.
- No worktree was created because Git metadata was initially unavailable. Work proceeded in the user-designated workspace.
- Generated adapter output is excluded from TypeScript input; otherwise JavaScript checking recursively checks bundled framework code after the first build. Source/config/scripts remain checked.
- Browser/functional verification is deferred by user instruction; leave its checklist items open rather than implying Task 1's original full verification gate passed.
