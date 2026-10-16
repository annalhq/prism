# Task 20: People profiles and typed connections

Task 20 is the next dependency after Task 5: the plan orders Tasks 5 → 20 → 21 → 6. It adds people-domain/server functionality, using the existing registry, shared notes/tags, identities and content-role tables. Task 5 was already complete at its implementation checkpoint and was not repeated. No schema migration or live data mutation was performed. Profile UI remains Task 11.

## Commands and identity

All writes use the existing owner-only command envelope, vault lock, revision checks, savepoint rollback, 1 MiB frame budgets and retry receipts. The registry/subtype lifecycle and all accepted projections commit together.

| Command                                          | Fields beyond `type`                                                                                                 | Behavior                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `person.create`                                  | `id`, `displayName`, optional `bio`, optional nullable `website`                                                     | Create registry and subtype atomically at metadata revision 1.                 |
| `person.update`                                  | `id`, `expectedRevision`, nonempty `patch`                                                                           | Only display name, bio and website are writable.                               |
| `person.trash`, `person.restore`, `person.purge` | `id`, `expectedRevision`                                                                                             | Registry-owned lifecycle; purge requires trash and is irreversible.            |
| `person-identity.add`                            | identity `id`, `personId`, `platform`, `profileUrl`, `confirmed: true`, optional nullable `nativeAccountId`/`handle` | Add an explicitly confirmed account without inferring or merging a person.     |
| `person-identity.remove`                         | identity `id`, `personId`, identity `expectedRevision`                                                               | Emit a revisioned deletion projection; removal can clean up a trashed profile. |
| `content-person.add`                             | `bookmarkId`, `personId`, `role`, `provenance`                                                                       | Add an explicit association with its own revision.                             |
| `content-person.remove`                          | `bookmarkId`, `personId`, `role`                                                                                     | Record a manual deletion decision with its own revision.                       |

A person is a first-class registry entity, distinct from a topic tag, the owner account and a persona. Duplicate display names are valid. Display names allow 200 Unicode code points, bios 10,000; website/profile URLs use the shared HTTP/HTTPS parser and its 8,192-character/credential/unsafe-input restrictions. Identity URLs store that parser's canonical URL. Entity kind/identity cannot be changed.

Example command payload inside the existing envelope:

```json
{
	"type": "content-person.add",
	"bookmarkId": "019a0000-0000-7000-8000-000000000010",
	"personId": "019a0000-0000-7000-8000-000000000001",
	"role": "author",
	"provenance": "manual"
}
```

Each person has the same independent note revision/history model and shared topic tags as bookmarks. Notes use `note.replace`; tags use `tag.add/remove`. Metadata changes and tags emit a full bounded `person.upsert` rather than a partial profile. Notes, identities and content roles keep independent revisions/sequences, so unrelated note writing does not conflict with those changes. No profile embeds an unbounded identity/relationship array.

## Confirmed external identities

Platform keys normalize to lowercase ASCII letters/digits/underscore/hyphen, with `twitter` canonicalized to `x`. Native account IDs are opaque, case-sensitive strings of at most 256 code points; handles are nullable display strings of at most 256 code points. A handle alone never proves identity or triggers merging.

Confirmation means the owner explicitly asserted the association; no external verification or network lookup is performed. Active canonical profile URL hashes are unique across the vault, with a full URL comparison on hash matches. Active `(platform, nativeAccountId)` pairs are also unique. Duplicate/hash-collision rejection preserves both profiles and never merges their content. Identities belonging to trashed profiles remain reserved until removed or purged.

Identity rows have their own ID/revision/sequence. Add never silently rewrites an existing ID. To correct a changed handle/profile URL, explicitly remove the old identity against its revision and add a newly confirmed identity with a new ID. Renaming a person never rewrites external identities. There is a 50-active-identity limit per person, enforced under the vault lock; inactive history is not counted. This bounds active profile state and permits purge to release all active uniqueness keys in its initial cleanup pass.

## Roles, provenance and visibility

Roles are `author`, `about` and `related`; provenance is `manual` or `capture_confirmed`. Multiple authors and overlapping roles are allowed. Relationship rows synchronize independently by `(bookmarkId, personId, role)`, revision and last sequence. Relationship commands change neither bookmark/person metadata revisions nor note revisions.

Note references create backlinks only. A name, source domain, tag or Markdown mention never creates a role association. Confirmed capture additions cannot replace a manual role or its deletion tombstone. An explicit removal records manual provenance, including when the row was originally captured or absent. Only an explicit manual add can reverse that decision. Adding a new association requires active same-vault bookmark/person endpoints of the correct kinds. Removal may clean up trashed endpoints; a purged bookmark cannot be modified and a purged person can never be newly assigned.

Trash hides a person from ordinary feeds and preserves recoverable relationships. Restore makes its surviving associations visible again. Person trash/purge never modifies or deletes the associated bookmarks. Person/relationship read projections must always resolve registry lifecycle; do not expose rows owned by or assigned to a purged target just because cleanup has not physically removed them yet.

## Profile and feed reads

All routes require the owner, validate IDs/cursors, return no-store responses and exclude purged profiles. Their read transactions use a read-only repeatable-read snapshot so a concurrent purge cannot combine stale target visibility with newer child data.

| GET route                                               | Result                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/people/:id`                                    | Full bounded profile and its current shared note, or null when no note exists. Trash detail remains recoverable; purged/missing/wrong-kind IDs return 404. |
| `/api/v1/people/:id/identities?after=<uuid>`            | At most 20 active confirmed identities, ordered by ID with `nextAfter`; page serialization is capped at 1 MiB.                                             |
| `/api/v1/people/:id/content?mode=<mode>&after=<cursor>` | Distinct bookmark summaries and all visible roles/provenance for each returned bookmark; at most 50 items and 1 MiB, with `nextAfter`.                     |
| `/api/v1/people/:id/note-history?before=<revision>`     | Shared recovery history: latest 50 previous accepted bodies, at most five per bounded page.                                                                |
| `/api/v1/entities/:id/backlinks`                        | Existing cross-type note/related backlink query, with registry lifecycle filtering.                                                                        |

Feed modes are `all`, `authored`, `about`, `related` and `tweets`. All is the distinct union of explicit role relationships, not a union of backlinks or inferred authorship. Ordinary feeds exclude archived/trashed/purged bookmarks. Authored/About/Related restrict membership by role but return the visible role/provenance set. Tweets further restricts the all-role union to saved social bookmarks on `x.com`, `twitter.com` or dot-delimited subdomains, including normalized trailing-dot hosts. It never fetches a timeline.

Feed pagination orders bookmark creation time descending, then ID descending. The cursor binds person ID, mode, creation time and bookmark ID; mismatched/malformed cursors return 400. Cursor pagination is stable against ordinary renames. It is not a multi-request database snapshot: concurrent inserts/removals may change subsequent pages, and sync remains the convergence mechanism planned for Task 6.

## Purge and bounded cleanup

Purge commits a minimal `person.purge` tombstone and clears original profile text, current note/history and tags. Incoming note/related references retain only the stable target identity for deleted-target display. Every replica must atomically remove owned profile/note/tag/identity/outgoing-link state and hide content-person/persona relationships involving that person, without deleting shared bookmarks or enumerating all affected rows in the frame.

The command removes at most 100 identity/role/persona-membership/outgoing-link rows in its initial cleanup pass. Active identities are first; the 50-active limit ensures their uniqueness keys are all released in that pass. Remaining rows enqueue a durable `person.cleanup` job. A scrubbed subtype FK anchor temporarily retains the constant text “Deleted person” until all referencing subtype FKs are gone. No old profile text is kept in that anchor.

`processPersonCleanup(owner, id)` is the resumable, owner-checked handler. Each call takes the vault lock, deletes at most 100 relationship rows and marks the job pending or done. It deletes the subtype once cleanup completes; the registry tombstone persists. Repeated calls are safe. Cleanup does not emit child deletion frames because the purge marker already defines replica removal/visibility. The Task 16 scheduler must dispatch these jobs; automatic scheduling is not implemented here. Removed historical identity values can remain in protected rows pending cleanup, and old frames/receipts/backups retain their existing retention semantics. Purge is not immediate secure erasure.

Bootstrap/export/import and local queries must filter pending-cleanup rows through source/target registry lifecycle. New writes to purged profiles reject, so cleanup cannot race with new assignments into that person. The future Task 21 membership commands must preserve that invariant.

## Search and portability contracts

`EntityRef` is a shared `{ kind, id }` contract; note-reference types remain compatible aliases. `PersonSearchDocument`, `PersonSearchRelationship` and normalized `personSearchFields` define separate profile/role inputs for the future worker. Person identity, tags and note mentions never synthesize authored/about relationships. Existing stable-ID person/author saved-search filters continue to use `inspectSearchReferences` to show a repairable “Needs attention” state when a referenced profile is deleted.

`tests/fixtures/knowledge-people.ts` is a synthetic portability fixture with duplicate display names, separate confirmed identities, a multi-role bookmark, a note-only mention and a stable-ID saved filter. Task 14 must preserve/remap people, identity person IDs, role endpoints, note destinations and saved-filter IDs together. It must not merge same-name people, promote mentions into authorship or export pending-purge child rows. This fixture extends the contract; the export/import engine remains Task 14.

## Evidence and deferred quality pass

Focused ephemeral domain checks passed for person/identity/role command validation, Unicode name limits, unsafe URLs, confirmation, Twitter platform normalization, explicit provenance policy, tweet-source boundaries, same-name fixture identity, mention-only references and search repair/text fields. Basic type/lint checks passed and offline `bun run db:generate` reported no schema changes. `bun run check` passed with zero errors/warnings; `bun run lint`, `bun run build` and `git diff --check` passed. The build emitted environment-color/plugin-timing notices without failures. Self-review tightened manual-removal tombstones so capture cannot resurrect an explicitly removed association.

The user's broad functional/database/browser/performance deferral remains in force. No PostgreSQL people suite, live profile mutation, live migration, B2 operation or person-feed query-plan measurement was performed. Keep these gates pending:

| Pending scenario            | Required evidence                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle and ownership     | Atomic create/update/trash/restore/purge, wrong-kind/foreign-vault IDs, immutable IDs, duplicate names and metadata conflicts.                                 |
| External identity integrity | Concurrent URL/native-account duplicates, simulated hash collision, removed/trashed profiles, changed handles, active identity cap and stable replay.          |
| Independent revisions       | Notes/history unaffected by profile/identity/role/tag changes; concurrent note saves conflict correctly.                                                       |
| Explicit associations       | Multiple authors/roles, manual/capture precedence, absent/existing manual removal tombstones, no inferred roles from notes or names.                           |
| Feed behavior               | Distinct all-role results, every mode, X/Twitter host boundaries, pagination/tie-breaks, lifecycle exclusions, byte limits and snapshot behavior during purge. |
| High-degree purge           | More than 100 child rows, interrupted/restarted cleanup, uniqueness release, scrubbed FK anchor removal, hidden pending rows and unchanged bookmarks.          |
| Replica/portability         | Independent projections, atomic markers, stale-frame protection, bootstrap, complete ID remapping and invalid saved-search repair.                             |
| API/UI                      | Authorization/no-store/cursor/history behavior, later profile/navigation UI, and representative PostgreSQL feed query plans.                                   |

Intended later suites remain `tests/domain/people.test.ts` and `tests/integration/people.test.ts`. Vitest currently includes `tests/unit` for unit tests; wire the domain path when adding the deferred suite. Tooling/domain evidence does not establish PostgreSQL concurrency, live authentication, convergence or browser behavior.
