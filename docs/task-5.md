# Task 5 implementation and contracts

Task 5 adds organization commands to the existing owner-only `POST /api/v1/commands` transaction. Tags, collections, saved searches and activity reuse the Task 2 schema; offline schema generation found no changes and no migration was applied. This is backend/domain work. Frontend organization controls remain Task 11.

## Command surface

Every command uses the existing `{ protocolVersion: 1, operationId, command }` envelope. Reuse the identical envelope after an uncertain response. Accepted changes, vault sequence, frame and receipt commit together; terminal errors roll back all tentative changes before recording their receipt.

| Command                           | Fields beyond `type`                               | Revision semantics                                                               |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tag.create`, `collection.create` | `id`, `name`                                       | Start at revision 1; existing IDs remain reserved after deletion.                |
| `tag.rename`, `collection.rename` | `id`, `name`, `expectedRevision`                   | Require the current entry revision.                                              |
| `tag.delete`, `collection.delete` | `id`, `expectedRevision`                           | Require the current revision and no remaining memberships.                       |
| `tag.add`, `tag.remove`           | `id` (source entity), `tagId`                      | Intent operations; no expected revision. Advance source metadata revision.       |
| `bookmark.organize`               | `id`, `expectedRevision`, `patch`                  | Require the current bookmark metadata revision.                                  |
| `saved-search.create`             | `id`, `name`, `filter`, `sort`                     | Start at revision 1.                                                             |
| `saved-search.update`             | `id`, `expectedRevision`, `name`, `filter`, `sort` | Replace the saved definition against its current revision.                       |
| `saved-search.delete`             | `id`, `expectedRevision`                           | Revisioned deletion; ID remains reserved.                                        |
| `activity.open`                   | `id` (bookmark)                                    | Independent count/revision; the receipt prevents duplicate increments on replay. |

Unknown fields, invalid IDs/revisions and unsupported enum values reject. `bookmark.organize.patch` is nonempty and permits only `collectionId` (UUID or null), `readingStatus` (`unread`, `reading`, `read`), `isPinned` and `isArchived` (booleans). No command takes a caller-supplied owner ID, timestamp or open count.

## Names, memberships and lifecycle

Tag/collection names normalize to NFC, collapse whitespace runs to one space and trim. Display casing is preserved; the normalized uniqueness key uses locale-independent full Unicode case folding followed by NFC, through pinned `unicode-case-folding@1.1.2`. Thus decomposed/composed accents, case variants, Greek sigma forms and `Straße`/`STRASSE` resolve consistently. The normalized display name is at most 64 Unicode code points; raw input is bounded at 1,024 code points. Empty, malformed Unicode and NUL names reject. The key remains within the existing 256-code-point database constraint.

Uniqueness is among active entries of the same kind in the same vault. Rename preserves IDs and relationships. A duplicate returns `duplicate_name` and the existing ID, without merging. Deletion marks the entry deleted and emits its revisioned projection; creating another active entry with that name is allowed, reusing its ID is not.

The vault lock serializes membership, assignment and final-delete checks. Tag additions compose without expected revisions, enforce at most 50 tags per entity and emit the complete current metadata/tag projection. Existing-tag additions and absent-edge removals are set operations that still advance metadata revision. Bookmark/person/persona sources share tags. They never modify note revision, body or history.

Deleting an in-use tag or collection returns `in_use`; references from trashed items count too. Remove tags or clear/move collection assignments in bounded commands before retrying deletion. A concurrent newly accepted membership is visible to the final delete under the same vault lock. There is no unbounded cascade. Tag removal is allowed on trashed sources for cleanup. A trashed bookmark permits only a revision-checked organization patch containing exactly `{ collectionId: null }`; other edits require restore. Purged sources reject. Additions and assignments require an active same-vault tag/collection.

Pinning, archive and reading status are independent. Setting archive true preserves an existing archive timestamp; false clears it. Inbox means no collection, with ordinary archive/trash exclusions. Read Later means non-archived, non-trashed bookmarks whose status is unread or reading. Shared domain predicates define both views.

## Saved-search contract

The AST is structured data, separate from the query-string parser planned for Task 10. Its required fields are shown below; `collection` and `site` are optional.

```json
{
	"version": 1,
	"scope": "active",
	"text": [{ "value": "distributed systems", "phrase": true }],
	"tags": [{ "id": "019a0000-0000-7000-8000-000000000001", "label": "Systems" }],
	"kinds": ["page", "social"],
	"people": [],
	"personas": [],
	"statuses": ["unread", "reading"],
	"has": ["note"],
	"pinned": false
}
```

`scope` is `active`, `archived` or `trash`. Collection omission means any collection; null means Inbox; otherwise use `{ id, label }`. People use `{ id, label, role: "any" | "author" }`; persona/tag references use `{ id, label }`. People labels permit 200 code points; other labels permit 64. Labels are display hints, never identity or inferred authorship. `kinds` permits page/social/image/person/persona; `has` permits note/media/backlinks. `site` is a hostname without path, port or credentials, canonicalized through the URL parser. Task 10 must match the hostname or its dot-delimited subdomains.

Text terms, tags, people and persona requirements compose with AND. Kinds and statuses select alternatives within their respective facets; multiple `has` requirements compose with AND. Phrase terms match contiguous normalized text in a field. `pinned: false` imposes no pin constraint; true requires pinned. Archive/trash scope replaces ordinary lifecycle exclusions. Normalized text uses NFC, full case folding, collapsed whitespace and trim. The future evaluator must preserve these semantics and must not mix profile results into a content-only view.

Filters allow at most 64 combined terms and 16 KiB serialized data. Both wire size and PostgreSQL's actual JSONB text size are checked before saving. Version, fields, booleans, reference IDs, duplicate references and enum values are strict. Sort is `newest`, `title` or `recently_opened`; the future evaluator uses descending creation/open time (unopened last), ascending normalized title, and ascending ID as its deterministic tie-breaker.

Create/update validates active same-vault reference identities and registry kinds with bounded queries. Missing/deleted targets return `invalid_reference`; repairing or removing the broken filter permits a new command. Deleting a referenced entity later leaves the saved definition intact. Consumers must call `inspectSearchReferences` against their current catalog/replica and show “Needs attention” plus its missing-reference list. They must not silently drop unresolved constraints or execute a weakened filter. Repairs preserve the saved-search ID and use its current expected revision. Task 10 owns parser/evaluator/UI integration; this task does not execute search queries.

## Activity and bulk behavior

`activity.open` records server receipt time as approximate last-opened time and increments a decimal-string bigint count. The row has its own revision/sequence, independent of bookmark metadata and notes. Trashed/purged or non-bookmark sources reject. Future UI must open the URL immediately and submit activity separately; an activity failure must never prevent navigation.

`bookmark.bulk` now accepts bookmark commands (including `bookmark.organize`) and tag membership intents, with 1–100 distinct bookmark IDs per chunk. Profile tag changes cannot enter bookmark bulk. A mixed-validity chunk rolls back entirely, including any earlier valid changes. Note commands, taxonomy creation/deletion, saved searches and activity remain outside this bulk contract.

`prepareBookmarkChunks` constructs and validates retained envelopes for larger independent jobs. It rejects duplicate source IDs, duplicate operation IDs and over-budget chunk requests before sending. `submitBookmarkChunks` reports each chunk as accepted, rejected, uncertain or not sent. Terminal rejection does not undo earlier accepted chunks and does not hide subsequent independent results. A transport/response ambiguity stops further sends and marks the remaining chunks not sent; retry the uncertain chunk with its retained original envelope. The helper provides no automatic retries or storage durability; the later outbox/UI must persist these envelopes and surface outcomes. A too-large chunk requires explicit smaller preparation before any send.

## Replica changes and verification

New changes are `tag.upsert`, `collection.upsert`, `saved-search.upsert` and `activity.upsert`. Deletion projections retain ID, deletion timestamp and sequence so replicas remove active state without reusing identity. All revisions, counts and sequences serialize as decimal strings. Tag membership emits `bookmark.upsert` or shared `entity.upsert`; the shared entity projection now also carries sorted `tagIds`. Related-link metadata uses that same projection helper. Notes and link projections retain their Task 4 contracts.

`bun run check` passed with zero errors/warnings and `bun run lint` passed. Offline `bun run db:generate` reported “No schema changes, nothing to migrate.” Focused ephemeral domain assertions passed for whitespace/NFC/full case-fold equivalence, Unicode name boundaries, strict organization command fields, stable-ID/versioned filters, missing-reference inspection, Inbox/Read Later predicates, 100-item chunking and accepted/rejected/uncertain/not-sent outcomes. The Task 4 focused domain checks also passed after shared validation primitives were extracted. Independent static review found no unresolved correctness/security issues. `bun run build`, final formatting/lint and `git diff --check` also passed. The build emitted environment-color/plugin-timing notices without failures.

Broader functional/database/browser tests remain deferred under the user's existing preference. No live content write, migration or B2 operation was performed. Keep these quality gates pending:

| Pending case          | Required database/API/browser evidence                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name identity         | Concurrent case/Unicode-equivalent creates and renames reject duplicates; deleted names can be reused with new IDs.                                   |
| Tag intent            | Concurrent unrelated additions compose; 50/51 boundary is atomic; duplicate additions and absent removals preserve set semantics and stable receipts. |
| Independent revisions | Tagging/organization never change note revision; activity changes neither metadata nor note revision.                                                 |
| Safe deletion         | In-use checks include trash; bounded cleanup permits deletion; a new membership before final delete prevents deletion.                                |
| Organization          | Collection ownership/lifecycle, stale revision, trash cleanup, independent pin/archive/status, restore and defaults.                                  |
| Saved search          | Cross-vault/wrong-kind/missing refs, deletion followed by repair, all sort modes, wire/JSONB limits and version rejection.                            |
| Activity              | Lost-response replay increments once, distinct opens increment independently, server time/count projections and nonblocking browser navigation.       |
| Bulk transactions     | One invalid command rolls back the whole chunk, mixed organize/tag chunks, profile exclusion, frame overflow, and partial multi-chunk UI reporting.   |
| Replication           | Full tag metadata/tombstones and independent activity projections bootstrap and converge without stale resurrection.                                  |

Intended deferred suites: `tests/domain/organization.test.ts` and `tests/integration/organization.test.ts`. Wire the domain path into Vitest's unit project when adding the suite; it currently includes `tests/unit`. Successful tooling checks are not proof of PostgreSQL concurrency, live authorization, convergence or browser behavior.
