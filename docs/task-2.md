# Task 2 — Owner boundary and relational foundation

## Implemented

- Server-only lazy PostgreSQL pool (maximum five connections), Drizzle schema and transaction helper. Importing the shell never requires a live database.
- 23 tables covering the knowledge registry, content, people/personas, shared notes/tags/links, media and operational sync/recovery state. Relationships use vault-scoped composite foreign keys; notes have independent revisions.
- Active URL hash and persona-name uniqueness live on the authoritative lifecycle registry. Subtype queries join registry state; they do not own competing deletion state. Canonical URL hashes are verified against actual bookmark URLs by deferred SQL triggers.
- Immutable registry identity/kind and subtype consistency checks in reviewed custom SQL. Raw SQL functions/triggers belong to migrations and must not be replaced with schema push.
- Bounded URL/text/byte limits, image metadata checks, typed non-nested persona memberships, revision/sequence constraints, reverse-link and organization lookup indexes.
- Offline migration generation and guarded direct-connection migration runner. Migration application requires a recent matching inventory and an explicit isolated-target setting; existing public tables require matching migration history.
- Read-only database inventory command. The configured Neon connection was inspected successfully: **zero public tables**. Inventory/column/row-count metadata is local in `artifacts/database-inventory.json`; no content or credentials are printed.
- Neon Auth server-toolkit adapter for email/password sign-in, sign-out and session reads, with framework cookie forwarding. No public signup or arbitrary OAuth callback/proxy route is exposed in this slice. Provider account creation is a setup step.
- Explicit `OWNER_SUBJECT` comparison before database access. `requireOwner` resolves a preinitialized vault; no request can become owner by being the first visitor. `/api/v1/session` and future versioned API routes require that boundary.
- Same-origin write checks, bounded streamed sign-in bodies, per-process sign-in throttle, private-response no-store headers and generic request-ID errors. Host-level limits are still required across processes. Future JSON command handlers must consume the bounded body helper; a Content-Length check alone is insufficient for streamed requests.
- Public shell remains accessible while no content is exposed; Account opens the setup-aware sign-in page.

## Setup

1. Configure the existing project's pooled `DATABASE_URL`, direct `DATABASE_URL_DIRECT`, `APP_ORIGIN`, and `NEON_AUTH_BASE_URL` in `.env`. Use the exact auth service URL, including any documented base path. Do not paste credentials into chat or commits.
2. Enable/configure Neon Auth on a compatible isolated development branch, create the owner's account through the provider's supported setup flow, and copy the immutable user ID into `OWNER_SUBJECT`. Register the application origin in Neon Auth trusted domains. Do not remove existing project network protections to enable auth.
3. Generate a random signing secret locally (for example `openssl rand -base64 32`) and save it as `NEON_AUTH_COOKIE_SECRET`. Do not share the output. Existing auth credentials are preserved; no provider provisioning has been performed automatically.
4. Verify the database URLs target an isolated development/test branch, then set `DB_MIGRATION_TARGET=isolated`. This flag is an explicit target assertion, not automatic detection or permission to migrate production.
5. Run `bun run db:inventory`; review the local metadata. Run `bun run db:migrate` only against that confirmed target. If legacy tables or differing migration history are detected, stop for migration review instead of overwriting them.
6. Run `bun run db:init-owner` once the reviewed schema exists. It initializes only the explicitly configured owner vault, idempotently; it creates no saved content. Reconfiguring the owner does not transfer the old vault.
7. Run `bun run dev`, visit `/auth/sign-in`, then access `/api/v1/session`. Sign-in uses server actions; there is no browser provider token store. Sign-out revokes the upstream session; unavailable provider errors do not claim success.

The installed SDK's framework-independent server surface is beta and pinned at `@neondatabase/auth@0.6.0-beta`. Use the pinned server exports rather than the Next.js adapter or a replacement auth implementation. The toolkit's signed session-data cache is excluded from authorization reads so the owner boundary checks the upstream session, including expiry/revocation. Live behavior is not considered proven until the configured provider flow is exercised.

## Evidence and pending work

Read-only inventory and migration generation succeeded. Previously completed basic checks: `bun run check` (0 errors/0 warnings), `bun run lint`, and the Node-adapter production build. Those checks are implementation evidence, not proof of live authentication behavior.

With the user-confirmed `DB_MIGRATION_TARGET=isolated`, all four reviewed migration files were applied successfully to the configured isolated Neon database. `bun run db:init-owner` initialized the explicitly configured owner vault. A fresh read-only inventory verified **23 public tables, one vault, and zero rows in every other public table**. No saved content or B2 objects were created.

`OWNER_SUBJECT`, `NEON_AUTH_COOKIE_SECRET`, the database URLs, auth URL and application origin are configured; secret values were not displayed. Local auth configuration validation passed. Raw schema/count metadata is in the private, gitignored `artifacts/database-inventory.json`.

Deferred verification: live Neon Auth sign-in/out, cookie/session restoration, expired/other-user sessions, CSRF/malformed requests, PostgreSQL constraint/rollback/concurrency scenarios, provider failures and representative query plans. Integration/browser suites remain deferred at the user's request. Visit `/auth/sign-in` when running the app to use the configured owner account. Migration success alone does not prove those flows.

No B2 media operation, clipper research or new persona behavior is included.

## Schema decisions

- Registry owns entity lifecycle and metadata revision; note revision remains separate. URL deduplication hash and normalized persona name live on that registry so active-only indexes cannot diverge from trash/restore state.
- Tags/collections and standalone relationships use their own versioned lifecycle fields. Derived relationship limits and normalized text creation belong to later command services, not unchecked direct SQL writes.
- Use SQL literal defaults for bigint columns: the pinned Drizzle generator cannot JSON-serialize native bigint defaults. Runtime values remain bigint and must be serialized as decimal strings at API boundaries.
- Verified attachments require non-null version, digest, bytes, dimensions and MIME; SQL CHECK constraints cannot rely on nullable comparisons alone.
- The schema reserves person/persona storage but does not implement persona semantics ahead of the pending product clarification in Task 21.

## Fixed: local sign-in incorrectly reported missing configuration

The CLI inherited `.env` through Bun, but the Vite/Node application read `process.env` directly. A Node-started development server without inherited auth variables reproduced the exact setup warning even though `.env` contained all required settings. The HTTP diagnostic returned status 200 with `signInFormAvailable: false`.

Declared optional server-only runtime variables in `src/env.ts` and switched authentication, the database pool, origin validation and owner comparison to SvelteKit private environment access. Kept standalone database scripts framework-independent by extracting the pure URL validator. Production start explicitly loads a local `.env` when present.

Repeating the identical HTTP diagnostic against the Node/Vite server returned status 200 with `signInFormAvailable: true`, without submitting credentials or printing settings. Strict type checking passed with zero errors/warnings. This proves configuration loading and form rendering; it does not prove successful credential authentication, which remains a separate deferred check.

## Existing owner without a password

A read-only check confirmed the configured owner exists in Neon Auth but has no credential password. The original sign-in-only UI did not provide an account setup/recovery path. Added **Set or reset password** on `/auth/sign-in` and a token-based `/auth/reset-password` page, using the pinned SDK's `requestPasswordReset` and `resetPassword` methods. The installed Better Auth reset implementation creates a credential account if the user has none; the same owner ID remains in use.

Reset-email requests are restricted to the configured owner email, resolved server-side, and return a non-enumerating confirmation. Both actions retain origin/body/rate protections. Reset tokens and passwords are never logged or returned in action errors; auth pages use no-store and same-origin referrer policies. Redirects target only the configured application origin. No email was sent and no password was changed by the agent; the owner initiates that flow in the app.

In Neon Auth settings, email authentication must be enabled and the application origin trusted. See [Neon password reset](https://neon.com/docs/auth/guides/password-reset). Delivery, token redemption and successful sign-in remain to be exercised by the owner; local type/lint/build checks do not prove email delivery.

## Fixed: native auth forms rejected with an opaque Origin

The `no-referrer` response policy on auth pages caused Chromium native form submissions to send `Origin: null`. The explicit same-origin guard correctly rejected that opaque origin, blocking even forms opened at the configured `http://localhost:5173` URL. A focused empty-form browser reproduction observed status 403 and the exact origin-denied message, while a manual POST carrying the expected Origin reached input validation.

Changed the auth response header and reset-page referrer meta tag to `same-origin`: off-origin requests still receive no referrer, but same-origin native POSTs retain their real Origin. Did not add wildcard origins, trust arbitrary headers or disable CSRF. The identical browser reproduction then observed the configured origin and reached input validation (400 for the intentionally empty form); an explicit untrusted-origin POST remained rejected with 403. No credentials were submitted and no reset email was requested by the agent.

Added `tests/e2e/auth-origin.spec.ts` for native forms on sign-in/reset pages in the deferred full browser suite. An already-open page must be reloaded to pick up the changed response policy.
