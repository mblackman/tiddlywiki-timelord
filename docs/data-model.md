# Data Model

Every historical state of a user tiddler is represented by a single **revision tiddler** — an ordinary TiddlyWiki tiddler with a well-known title prefix, a well-known tag, and a specific set of fields.

## Naming scheme

```
Title:  $:/plugins/mblackman/timelord/revisions/<hash>/<timestamp-ms>-<id>
Tag:    $:/plugins/mblackman/timelord/revisions/<hash>
```

- `<hash>` — djb2 hex hash (8 lowercase chars) of the **original tiddler name** via `pathHash`. Stable across edits; changes only when the tiddler is renamed (at which point `renameHistory` retags all existing revisions). djb2 is used here (not SHA-256) because a compact fixed-width segment keeps titles short and the tag is only an index key, not a security/integrity hash.
- `<timestamp-ms>` — `Date.now()` at the moment of capture.
- `<id>` — a small integer (usually `0`) used purely for collision avoidance when two revisions are captured in the same millisecond. It is **not** a revision number.

See [`revisor.js` `generateTitle` / `generateTag`](../plugins/mblackman/timelord/src/revisor.js) for the exact logic.

### Why hash the name and not embed it?

Tiddler names can contain any Unicode character, including `/`, `|`, and newlines — none of which are safe to use as title delimiters. Hashing the name produces a fixed-length, path-safe, URL-safe, rename-stable segment. The authoritative original name lives in the `revision-of` field.

### What the tag is used for

`generateTag(name)` is the one piece the UI and lookup code rely on. `Revisor.getHistory(name)` is just `$tw.wiki.getTiddlersWithTag(generateTag(name))`, which uses TW's internal tag index and is O(1) to locate. This is also what lets the `Revisions.tid` tab filter with `[tag<revisionTag>...]` cheaply.

## Field reference

Each revision tiddler carries the following fields. The source of truth is the comment block at the top of [`revisor.js`](../plugins/mblackman/timelord/src/revisor.js).

| Field | Value | Purpose |
|-------|-------|---------|
| `revision-of` | original tiddler name | Source of truth for lookup and restore. Updated in place by `renameHistory`. |
| `revision-date` | `modified` timestamp in ms | Used for sorting; also mirrored into the revision's own `modified` field. |
| `revision-data` | JSON string of tiddler fields | Shape depends on `revision-storage`. See [storage-and-reconstruction.md](storage-and-reconstruction.md). |
| `revision-storage` | `"full"` or `"delta"` | Tells readers how to interpret `revision-data`. |
| `revision-text-hash` | SHA-256 hash of the captured full text | Used by `captureDeletedState` to identify the revision it just added. |
| `revision-full-hash` | SHA-256 hash of the full serialized field state | Integrity / debug reference. Also the key compared by `verifyRevisionIntegrity`. |
| `revision-content-hash` | SHA-256 hash of meaningful fields (excluding auto-fields) | Primary dedup key on save. Ignores `modified`, `modifier`, `draft.*`, `revision-tag`, `edit-summary`, etc. |
| `revision-deleted` | `"yes"` or absent | Marks a revision as the final state captured before a delete. Drives the Deleted Tiddlers sidebar. |
| `revision-changed-fields` | space-separated field names | Cached list of meaningful fields that changed vs. the previous revision. Excludes auto-fields. |
| `revision-number` | `1`, `2`, `3`, … | Sequential count of revisions for this tiddler. Shown in the UI as `#N`. |
| `revision-version` | `SCHEMA_VERSION` at time of capture | See [schema-versioning.md](schema-versioning.md). |
| `revision-renamed-from` | previous title | Only set on the revision captured at a rename event. Frozen — unaffected by later renames. |
| `revision-renamed-to` | new title | Paired with `revision-renamed-from`. |
| `revision-text-length` | integer | Length of the original full text at write time. Lets the UI show char-count deltas without walking the chain. |
| `revision-summary` | optional string | Edit summary describing why the change was made. Sourced from the live tiddler's `edit-summary` field at save time. |
| `revision-broken-chain` | `"yes"` or absent | Stamped by `repairChain` when chain-integrity verification flags this revision as unreconstructable. The Revisions tab shows a `⚠ broken chain` badge. See [chain-integrity.md](chain-integrity.md). |
| `tags` | `[[<tag>]]` | The tag computed by `generateTag(name)`. |
| `title`, `type`, `modified`, `modifier` | standard TW fields | `modified` = capture time, **not** the original tiddler's modified time (that is preserved inside `revision-data`). |

## Auto-managed fields (not "meaningful")

Two places in the code share a list of fields that change automatically on every save and therefore **do not** count as a change by themselves. Keep the two lists in sync.

```js
export const AUTO_FIELDS = new Set([
  'modified', 'modifier', 'created', 'creator',
  'draft.of', 'draft.title', 'revision-tag', 'edit-summary'
]);
```

`AUTO_FIELDS` is exported from [`revisor.js`](../plugins/mblackman/timelord/src/revisor.js) (used by `serializeContentFields` / `_getChangedFieldNames`) and imported by [`filters.js`](../plugins/mblackman/timelord/src/filters.js) (used by the on-the-fly fallback of `revisionchangedfields`). [`listener.js`](../plugins/mblackman/timelord/src/listener.js) inlines an equivalent set in `tiddlerFieldsChanged`.

A save that only touches auto-fields produces **no** revision. Content-hash dedup uses the same list, so a restored tiddler will match its source revision even though `modified`/`revision-tag` differ. `edit-summary` is included here because the listener strips it from the live tiddler at save time and forwards it as `opts.summary` — it never persists as a meaningful field.

## The `revision-tag` field on *live* tiddlers

On every save the listener stamps `revision-tag: generateTag(newTitle)` onto the live tiddler. This is a UI convenience: `Revisions.tid` reads it via `{{!!revision-tag}}` and plugs it straight into the `[tag<revisionTag>...]` filter. If the field is missing (e.g. an externally imported tiddler), the Revisions tab still works after the next save, and history lookup via `Revisor.getHistory(name)` works immediately because it computes the tag from the name.
