# Task 3 — Transactional bookmark commands

The owner-only `POST /api/v1/commands` endpoint now implements bookmark create, update, trash, restore, purge and bounded bulk commands. This is a backend slice; the application shell does not yet save or read bookmarks. No new dependency, migration or provider setup is required.

## Request contract

Send `Content-Type: application/json`, the application session cookie and the exact application `Origin`. The existing hook enforces the configured owner and rejects foreign/opaque origins. Command requests and emitted responses/frames are bounded to 1 MiB of serialized UTF-8 JSON, including streamed request bodies. The stored PostgreSQL JSONB representation is checked separately against its 1 MiB constraint.

```json
{
	"protocolVersion": 1,
	"operationId": "c8fca804-f957-43b6-b738-b2f478d824c0",
	"command": {
		"type": "bookmark.create",
		"id": "bf92e80f-06e8-4309-a671-808f116984dc",
		"kind": "page",
		"title": "A useful resource",
		"url": "https://example.com/Article?b=2&a=1#section",
		"description": "Why I saved this"
	}
}
```

Use fresh client UUIDs for new entities and operations. Reuse the original operation ID and identical payload after a timeout or transient failure. Object property order and JSON whitespace do not affect payload identity; array order and supplied fields do. A terminal rejection is recorded too: correcting a rejected command requires a **new operation ID**.

| Type               | Required fields                            | Behavior                                                                                          |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `bookmark.create`  | `id`, `kind`, `title`; URL for page/social | Optional description; image bookmarks may omit URL. Creates revision `"1"`.                       |
| `bookmark.update`  | `id`, `expectedRevision`, `patch`          | Patch contains only title, description and/or URL. Kind is immutable.                             |
| `bookmark.trash`   | `id`, `expectedRevision`                   | Requires an active bookmark; preserves recoverable content.                                       |
| `bookmark.restore` | `id`, `expectedRevision`                   | Requires trash; rejects an active URL duplicate with both IDs.                                    |
| `bookmark.purge`   | `id`, `expectedRevision`                   | Requires trash; removes content and retains minimal identity.                                     |
| `bookmark.bulk`    | `commands`                                 | 1–100 distinct bookmark IDs; nested bulk and note bodies are rejected. One chunk is fully atomic. |

Revisions and sequences are positive decimal **strings**, never JSON numbers. Title is nonblank and at most 500 Unicode code points; description at most 10,000. Null characters and malformed Unicode are rejected. Unknown fields are rejected. HTTP/S URLs require a host, contain no credentials, controls, whitespace or backslashes, and fit 8,192 characters before and after parsing. Normalization uses the URL parser; query order, path case and fragments are preserved. No metadata fetch occurs on this path.

```json
{
	"protocolVersion": 1,
	"operationId": "b817e1dd-3a42-47ef-a16e-5db3585378af",
	"command": {
		"type": "bookmark.update",
		"id": "bf92e80f-06e8-4309-a671-808f116984dc",
		"expectedRevision": "1",
		"patch": { "title": "Revised title" }
	}
}
```

## Outcomes and consistency

- `accepted` (200): one complete frame containing upserts/purge markers, one new vault sequence and a durable receipt. Every changed bookmark receives that sequence and a new metadata revision. Notes retain their independent revisions.
- `already_exists` (200): single create found the same canonical URL under a different ID. Returns the existing bookmark without overwriting it or advancing sequence. A duplicate create inside bulk rejects the entire chunk instead.
- `rejected` (409; invalid command 422; oversized frame 413): typed terminal error. Revision conflicts include the current revision; duplicates include the existing ID. Nothing in the chunk changes. Reusing an operation ID for a different payload returns `operation_id_reused` and preserves the original receipt.
- Invalid envelopes/JSON (400), unsupported media type (415), oversized request (413), and authorization failures are transport errors, without receipts. Unexpected database failures are generic 500 responses; the whole transaction rolls back and the same operation ID can be retried.

The service rechecks the vault's owner while obtaining its row lock, then checks receipts. Content changes run under a savepoint. Terminal rejection rolls back tentative changes but keeps the outer lock long enough to store the rejection receipt. Accepted content, transactional vault counter, frame and receipt commit together. Delayed writers acquire their sequence under that same lock. Database constraint failures are not silently converted into domain conflicts.

URL uniqueness excludes trash. A hash match must also match the canonical URL; a collision rejects rather than merging. Registry IDs remain reserved after purge. Organization fields, notes, people and persona commands remain later tasks.

## Purge and media ownership

Purge deletes current note/history, outgoing links, tags, activity, content-person relations, persona memberships, attachments and upload intents before removing the bookmark subtype. Incoming links retain their target identity for deleted-target display. The frame's `bookmark.purge` marker instructs replicas to perform the same owned-data removal atomically, without an unbounded list of child deletes. Subsequent bootstrap queries must exclude relationships owned by a purged entity.

Before removing media ownership, SQL `INSERT SELECT` copies object/version information into deduplicated `media.delete` maintenance jobs. Upload intent keys become `media.delete-upload` jobs scheduled after expiry plus a one-hour grace period, because an issued upload URL may still be usable. That worker must enumerate/remove all versions of the intent's exclusive key and handle late completion/retries. **The B2 worker is deferred; this slice does not delete remote bytes.** Retained frames, receipts and backups may contain old content until their retention expires.

## Evidence and deferred verification

Focused local domain checks exercised URL preservation and unsafe-input rejection, strict kind validation, decimal revisions, the bulk bound and UTF-8 size accounting. Focused envelope checks verified property-order-independent hashing, changed-payload hashing and protocol rejection. `bun run check` passed with zero errors/warnings; `bun run lint`, `bun run build` and `git diff --check` passed. No live bookmark mutation, B2 request or migration was performed for this slice.

Per the user's instruction, PostgreSQL replay/conflict/rollback/concurrency and purge-ownership scenarios, full API/browser suites and performance profiling remain deferred to the final quality pass. Those guarantees are implementation intent, not verified live behavior. `Server-Timing: command;dur=...` exposes execution duration for later endpoint measurements; lock duration and representative single/bulk latency remain unmeasured. Bulk currently executes its items sequentially under one transaction; profile round trips before setting a latency budget or optimizing batching.

Rulings: extend the existing Task 2 schema without a migration; keep writable metadata limited to this task's title/description/URL contract; use a cascading purge marker rather than enumerating unbounded child removals. The upcoming replica and maintenance tasks must implement those marker/job contracts before claiming end-to-end purge or cleanup.
