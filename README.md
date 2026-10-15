# Prism

A private personal knowledge library for saved content, people and connections across devices.

The Task 1 foundation provides an accessible, responsive SvelteKit shell with Bits UI, Phosphor Icons Svelte, a self-hosted font and system light/dark themes. Saving, authentication, database access, people profiles and synchronization are planned in subsequent milestones. The shell requires no credentials and performs no service calls.

## Develop

Use Node 22.17+ (or a newer supported LTS) and Bun 1.4.0. Exact dependency versions are pinned in `package.json` and `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

Open the local URL printed by Vite. Copy `.env.example` to `.env` when configuring services in Task 2; all values can remain empty for the shell. Database/B2 keys must remain server-only, never `PUBLIC_` variables.

SvelteKit 3 configuration lives in `vite.config.ts`, local imports use `#lib`, and TypeScript extends `$app/tsconfig`. Application state uses Svelte 5 runes. Server-only implementation belongs under `src/lib/server/`; shared domain code must not import it.

## Commands

| Command                                      | Purpose                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun run dev`                                | Development server                                                                             |
| `bun run check`                              | Framework synchronization and strict Svelte/TypeScript checks                                  |
| `bun run lint`                               | Prettier check and ESLint                                                                      |
| `bun run format`                             | Apply formatting                                                                               |
| `bun run build`                              | Production Node-adapter build                                                                  |
| `bun run start`                              | Run the existing production build                                                              |
| `bun run preview`                            | Local Vite production preview                                                                  |
| `bun run bench`                              | Record emitted asset sizes in `artifacts/baseline.json`; build first                           |
| `bun run test`                               | Unit/SSR tests, isolated from integration and browser tests                                    |
| `bun run test:integration`                   | Integration suite; currently empty and intentionally fails rather than reporting false success |
| `bun run test:e2e`                           | Production browser smoke tests; deferred until the final quality pass                          |
| `bun run db:generate` / `bun run db:migrate` | Reserved for Task 2; currently exit nonzero with instructions and contact no service           |
| `bun run maintenance`                        | Reserved for Task 16; currently exits nonzero with instructions                                |

The browser suite builds and starts the actual Node-adapter output with empty service credentials. When browser testing resumes, install its matching browser with `bunx playwright install chromium`. It includes desktop/mobile viewport, landmarks, keyboard skip navigation, dialog focus restoration and absence of external requests. It is configured but has not passed in this environment. Do not run builds concurrently: they share generated output.

Per the current development preference, defer further functional/browser/performance test execution to the final quality pass. Keep basic type, lint and build checks during foundation work. See [baseline evidence](docs/baseline.md) for exactly what has been verified.

## Hosting and services

Deploy `build/` and the runtime dependencies on a maintained Node host behind HTTPS. Build with development dependencies available; use `bun run start` for the resulting server. Set `HOST`, `PORT` and the Node adapter's `ORIGIN` to match the deployment. `APP_ORIGIN` documents the app's intended public origin for future integrations and is not a replacement for `ORIGIN`.

Later milestones require outbound access to NeonDB, Neon Auth and the correct B2 regional endpoint; bounded database pool concurrency; and a scheduled runner for the maintenance command. The host must support bounded image verification outside SQL transactions within its memory/request time limits. Database migrations use a separate direct connection and a reviewed deployment step. No infrastructure has been provisioned by the foundation.

Future offline access is for trusted devices. Pending drafts/outbox data must survive failures; private API responses must not be generically cached. The Task 1 shell does not implement offline reload, local content storage or encryption.

## Design and progress

[Architecture](ARCHITECTURE.md) describes the intended system. [Implementation plan](plan.md) tracks completed work and deferred verification. Web clipper design/research remains deferred at the user's request.
