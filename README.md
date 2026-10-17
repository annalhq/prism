# Prism

A private personal knowledge library for saved content, people and connections across devices.

The browser workspace now supports saving content, notes, organization, people and personas as named knowledge contexts. It includes a durable local replica/outbox, basic synchronization and search, metadata import/export and manual profile cleanup. See [Prism v0](docs/v0.md) for what to try and the remaining gaps. B2 media, full backups and broader functional/browser/performance verification remain pending. The public welcome shell requires no credentials; private library features require the configured owner vault.

## Develop

Use Node 22.17+ (or a newer supported LTS) and Bun 1.4.0. Exact dependency versions are pinned in `package.json` and `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

Open the local URL printed by Vite. Copy `.env.example` to `.env` when configuring services; empty values allow only the public welcome shell. Database/B2 keys must remain server-only, never `PUBLIC_` variables.

SvelteKit 3 configuration lives in `vite.config.ts`, local imports use `#lib`, and TypeScript extends `$app/tsconfig`. Application state uses Svelte 5 runes. Server-only implementation belongs under `src/lib/server/`; shared domain code must not import it.

## Commands

| Command                    | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun run dev`              | Development server                                                                             |
| `bun run check`            | Framework synchronization and strict Svelte/TypeScript checks                                  |
| `bun run lint`             | Prettier check and ESLint                                                                      |
| `bun run format`           | Apply formatting                                                                               |
| `bun run build`            | Production Node-adapter build                                                                  |
| `bun run start`            | Run the existing production build                                                              |
| `bun run preview`          | Local Vite production preview                                                                  |
| `bun run bench`            | Record emitted asset sizes in `artifacts/baseline.json`; build first                           |
| `bun run test`             | Unit/SSR tests, isolated from integration and browser tests                                    |
| `bun run test:integration` | Integration suite; currently empty and intentionally fails rather than reporting false success |
| `bun run test:e2e`         | Production browser smoke tests; deferred until the final quality pass                          |
| `bun run db:generate`      | Generate SQL offline from the Drizzle schema                                                   |
| `bun run db:inventory`     | Read-only metadata and row counts from the direct database                                     |
| `bun run db:migrate`       | Apply reviewed SQL to an explicitly isolated target after inventory                            |
| `bun run db:init-owner`    | Explicitly initialize the configured owner vault after migration                               |
| `bun run maintenance`      | CLI placeholder; use library settings for bounded profile cleanup                              |

The browser suite builds and starts the actual Node-adapter output with empty service credentials. When browser testing resumes, install its matching browser with `bunx playwright install chromium`. It includes desktop/mobile viewport, landmarks, keyboard skip navigation, dialog focus restoration and absence of external requests. It is configured but has not passed in this environment. Do not run builds concurrently: they share generated output.

Per the current development preference, defer further functional/browser/performance test execution to the final quality pass. Keep basic type, lint and build checks during foundation work. See [baseline evidence](docs/baseline.md) for exactly what has been verified.

## Hosting and services

Deploy `build/` and the runtime dependencies on a maintained Node host behind HTTPS. Build with development dependencies available; use `bun run start` for the resulting server. Set `HOST`, `PORT` and the Node adapter's `ORIGIN` to match the deployment. `APP_ORIGIN` documents the app's intended public origin for future integrations and is not a replacement for `ORIGIN`.

Later milestones require outbound access to NeonDB, Neon Auth and the correct B2 regional endpoint; bounded database pool concurrency; and a scheduled runner for the maintenance command. The host must support bounded image verification outside SQL transactions within its memory/request time limits. Database migrations use a separate direct connection and a reviewed deployment step. No infrastructure has been provisioned by the foundation.

Offline access is for trusted devices. The v0 stores owner-scoped library data, drafts and pending commands in IndexedDB and caches the public shell separately. It does not end-to-end encrypt local content. Private API responses are excluded from shell caching. Sync requires Web Locks; see [v0 limits](docs/v0.md#limits-and-remaining-work).

After the server verifies the owner, an initialized browser opens its cached library without waiting for background synchronization. Refreshes and subsequent sign-ins reuse that owner's replica; first-device setup and expired sync history still require a complete download. A committed sync cursor identifies a complete cache, including an empty library. Delta sync updates only changed records and leaves drafts and pending work intact. Unchanged syncs do not rewrite records or invalidate list/search results. Authorization failures hide cached private content until the owner is verified again; explicit offline access remains available on trusted devices.

## Design and progress

[Architecture](ARCHITECTURE.md) describes the intended system. [Implementation plan](plan.md) tracks completed work and deferred verification. Web clipper design/research remains deferred at the user's request.

## Connect the private vault

Follow [Task 2 setup and evidence](docs/task-2.md). The public shell remains credential-free; `/auth/sign-in` uses Neon Auth and `/api/v1/session` requires the configured owner and initialized vault. Configure `NEON_AUTH_COOKIE_SECRET` locally in addition to the existing environment keys. No public signup or first-visitor ownership is exposed.

The owner-only `POST /api/v1/commands` supports bookmark create/update/trash/restore/purge and atomic bulk chunks. See [Task 3 contracts and pending verification](docs/task-3.md) for request examples, retry rules and the deferred media-cleanup worker. Task 4 extends the endpoint with `note.replace` and `related-link.add/remove`, plus owner-only history and backlink GET endpoints. See [Task 4 contracts and pending verification](docs/task-4.md). Task 5 adds organization and activity commands and extends bookmark bulk to organization/tag intents; see [Task 5 contracts and pending verification](docs/task-5.md). Task 20 adds person lifecycle, identity and role commands plus profile/feed/history GET endpoints; see [Task 20 contracts and pending verification](docs/task-20.md). The v0 also adds persona commands, bootstrap/change feeds, a local facade and their browser workflow; see [v0 scope and evidence](docs/v0.md). No additional migration is needed for these slices.

## Environment loading

Application server modules use SvelteKit 3's private runtime variables declared in `src/env.ts` and imported from `$app/env/private`. Vite reads local `.env` files through this framework mechanism; do not use direct `process.env` reads in application auth/database code. The standalone Bun database scripts load their environment independently and share only the pure connection-URL validator.

`bun run start` uses Node's `--env-file-if-exists=.env` for a local production build. Deployment-provided environment variables retain precedence. Restart the development/production server after changing environment settings. To diagnose only the local sign-in page without submitting credentials, run `node scripts/check-auth-page.mjs http://localhost:5173` (adjust the port if necessary).

### Set the owner's password

If your Neon Auth user exists but has no password, open `/auth/sign-in` → **Set or reset password** → enter that account's email → **Email password setup link**. Open the email link, choose a password and sign in. Enable email authentication in Neon Auth and register the app origin as a trusted domain. This uses the application account, not the Neon Console login or PostgreSQL role password.
