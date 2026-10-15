# Task 4 implementation and contracts

Task 4 adds shared notes, stable references, explicit related links and backlink reads to Task 3's command transaction. It reuses the existing `entity_notes`, `note_revisions` and `entity_links` tables. No migration or live content mutation was performed. The note editor, picker and reader UI remain later tasks.

## Commands and revisions

All commands use `POST /api/v1/commands` with Task 3's versioned envelope and operation-ID retry rules. For example:

```json
{
	"protocolVersion": 1,
	"operationId": "019a0000-0000-7000-8000-000000000001",
	"command": {
		"type": "note.replace",
		"id": "019a0000-0000-7000-8000-000000000002",
		"expectedRevision": "0",
		"bodyMarkdown": "A note about [another item](prism:bookmark/019a0000-0000-7000-8000-000000000003)."
	}
}
```

`note.replace` accepts `id`, `expectedRevision` and `bodyMarkdown`. The source can be a bookmark, person or persona already present in the same vault. Revision `"0"` means no stored note; the first save creates revision `"1"`. Later saves require the current note revision. Metadata edits and related-link changes do not change that revision. Saves to trashed/purged sources reject. An empty body remains a revisioned note, removes its derived reference edges and preserves its previous body in history.

`related-link.add` and `related-link.remove` accept `id`, the source's metadata `expectedRevision`, and `target: { kind, id }`. These affect only `related` edges and increment source metadata revision, leaving the note untouched. Add of an existing edge and remove of an absent edge accept as set operations and still advance metadata revision; replay of the same operation ID returns its original receipt. They are directional connections; a note mention never writes a content-person authorship/about/related role.

Note changes, previous-body retention, derived edge replacement, sequence, complete change frame and receipt share the existing locked transaction/savepoint. Reference targets are validated with a bounded batch query. A stale note or metadata revision returns a receipted `revision_conflict`. Validation and frame-size failures roll back tentative writes before recording a terminal receipt.

## Markdown and reference rules

Destinations are exactly `prism:bookmark/<uuid>`, `prism:person/<uuid>` or `prism:persona/<uuid>`, with canonical lowercase kind/UUID identity. Display labels can change independently. CommonMark AST parsing uses the pinned `mdast-util-from-markdown`; inline links and resolved Markdown reference-style links participate. Repeated targets collapse. Fenced/indented/inline code, escaped syntax, raw HTML blocks, images, unresolved `[[text]]`, malformed UUID destinations and external URLs do not create edges. Self-links remain in outgoing edges and count toward the 200-target limit; backlink reads exclude the source itself.

Every extracted target must exist in the same vault and match its destination kind. A missing target rejects the save. Trashed targets retain identity and can be referenced. New references/related links to purged targets reject; an existing note reference to a purged target can survive subsequent note edits. Incoming edges keep only their registry target identity after purge. Future UI resolves trash/deleted state from that registry rather than copying titles into edges. Person/persona creation and lifecycle commands remain Tasks 20–21.

The renderer converts the AST to HTML with raw HTML disabled. It strips unsafe or relative link destinations and allows typed Prism links, HTTP, HTTPS and mailto links without embedded credentials. Images become alt text without making remote requests. Code and ordinary text are HTML-escaped. The later reader must route typed Prism links by stable ID and resolve target lifecycle state.

Bodies reject NUL and malformed Unicode and enforce 102,400 UTF-8 bytes before parsing; distinct references are capped at 200, including self-links. Accepted frames retain Task 3's exact wire/JSONB size checks and 1 MiB budget.

## Replica projections

- `note.upsert` carries the full body, entity ID, independent revision, last sequence and timestamps.
- `links.replace` carries the complete outgoing `{ targetId, kind }` set for both link kinds and a source ID/sequence. A note save replaces only derived rows in PostgreSQL, then emits both kinds together so replicas cannot erase explicit links.
- A related-link command also emits `bookmark.upsert` for bookmark metadata or `entity.upsert` for a person/persona registry's revision/lifecycle. The latter carries registry metadata only; later profile projections must compose with it.

Replicas must apply each frame atomically and ignore older source-link replacements. Bootstrap must produce one outgoing-edge projection per live source, using the maximum of source metadata and note `last_seq`. Link rows themselves do not have a separate sequence column. Task 3's purge marker removes owned notes/history/outgoing links while retaining incoming identities. Derived backlinks use source/target lifecycle to hide purged relations and exclude trashed sources without fan-out rewrites on trash/restore.

## Bounded reads

`GET /api/v1/bookmarks/:id/note-history?before=<revision>` returns `{ items, nextBefore }`, newest first. Each item has decimal `revision`, `bodyMarkdown` and `acceptedAt` (when that body became current). At most five previous bodies are returned, with an additional serialized 1 MiB page bound and an exclusive revision cursor. Only the latest 50 accepted previous bodies are retained; the current body is separate. Trash preserves recovery history; purge removes it. Missing, wrong-kind and purged bookmarks return 404. Restoring a previous body uses a new `note.replace` command against the current note revision and revalidates all references.

`GET /api/v1/entities/:id/backlinks?after=<source-uuid>` returns `{ items, nextAfter }`, ordered by stable source ID with at most 50 distinct sources. Each item includes the source ID/kind/current title, connecting edge `kinds` and a plain-text note snippet of at most 240 code points around its first target mention. A source connected by both kinds appears once. Labels resolve from current subtype rows, so renames preserve navigation. Trashed/purged sources and self-links are excluded. A purged target returns an empty list. Missing targets return 404. Both endpoints require the owner, validate IDs/cursors and return `Cache-Control: no-store`.

## Verification and deferred quality pass

Basic checks: `bun run check` passed with zero errors/warnings; `bun run lint`, `bun run build` and `git diff --check` passed. The build emitted environment-color and plugin-timing notices, without build failures.

Focused local domain assertions passed for typed/canonical/reference-style extraction, duplicate collapse, code/escape/HTML/image exclusion, unsafe-rendered-link removal, HTML escaping, the Unicode byte boundary, 200/201 references, strict command fields/revisions and mention-context snippets. These checks used an ephemeral script and do not constitute PostgreSQL/API/browser suite evidence. A fresh-context static review found and verified the correction of missing-ID reads returning 500; both reads now explicitly return 404. Its snippet-context suggestion was implemented. Follow-up review caught a target-purge visibility race between the read service's two statements; the result query now rechecks target purge state in its own snapshot, and the reviewer verified the fix with no unresolved findings.

Per the existing user preference, no broad functional, PostgreSQL, browser or performance suites were added or run. Keep these completion gates pending:

| Pending case                  | Evidence required at final quality pass                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-type references         | Bookmark/person/persona sources and targets; wrong kind, unknown and foreign-vault IDs reject without partial writes; mention creates no authorship role.          |
| Independent conflict behavior | Metadata/tagging leaves the note revision unchanged; two concurrent note saves produce one accepted result and one stable conflict receipt.                        |
| Retry and rollback            | Lost-response replay has one note revision/history/frame/receipt effect; body/history/edge/sequence changes all roll back on forced failures and oversized frames. |
| Link lifecycle                | Rename, note reference removal, related-link coexistence, self-links, trash, restore and purge preserve correct visibility and minimal deleted-target identity.    |
| Recovery                      | At least 52 saves retain exactly 50 previous bodies; history page/cursor/JSON-escaping byte bounds; revision-checked recovery creates a new revision.              |
| Read authorization            | Owner access, anonymous/other-user denial, malformed IDs/cursors, missing/wrong-kind/purged history, stable backlink pagination and no-store responses.            |
| Replica contract              | Note and both link kinds apply in one frame; source metadata and note sequences bootstrap consistently; old replacements cannot regress links.                     |
| UI integration                | Future reader uses the safe renderer and stable-ID navigation; picker/editor shows missing, trash and deleted targets without exposing purged profile data.        |

The intended deferred suite paths are `tests/domain/notes.test.ts` and `tests/integration/notes-links.test.ts`. The current Vitest unit project includes `tests/unit`; wire the domain path into that project when adding the deferred suite. No claim of live database behavior, convergence or measured latency is made.
