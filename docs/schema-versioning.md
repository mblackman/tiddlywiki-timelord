# Schema Versioning

Revision tiddlers are user data. They live in the wiki forever and must stay readable across plugin upgrades. Schema versioning gives readers a way to branch on the format they're looking at, and gives authors a way to evolve the format safely.

## `SCHEMA_VERSION`

Defined in [`revisor.js`](../plugins/mblackman/timelord/src/revisor.js):

```js
export const SCHEMA_VERSION = "1";
```

Every revision written by `addToHistory` is stamped with `revision-version: SCHEMA_VERSION`. The helper `getRevisionVersion(revision)` returns the field value or `"0"` if the field is missing.

- `"0"` — pre-versioning. Produced by any plugin build before this field was introduced, and by all revisions written by the upstream `ashlin/timelord` plugin. Readers must be prepared for the whole list of fields documented in [data-model.md](data-model.md) to be partially missing; in particular, `revision-data`, `revision-content-hash`, `revision-changed-fields`, `revision-number`, `revision-renamed-from`/`-to`, and the `"delta"` storage mode may all be absent.
- `"1"` — current format. All documented fields are present; `revision-storage` may be `"full"` or `"delta"`; legacy `"diff"` may appear on revisions migrated in.

## When to bump

Bump `SCHEMA_VERSION` whenever a change to the on-disk format would make new readers mis-interpret old revisions, or would require old readers to see a new revision and fail gracefully. Examples:

- Adding a new required field on every revision.
- Changing the shape of `revision-data` for an existing storage mode.
- Introducing a new `revision-storage` value.
- Changing hash function or field-serialization order such that existing hashes no longer verify.

Do **not** bump for UI-only changes, additional filter operators, or optional fields that readers ignore when missing.

## Writer responsibilities (new version)

When you bump `SCHEMA_VERSION`:

1. Update the `SCHEMA_VERSION` constant in `revisor.js`.
2. Update the field table in [data-model.md](data-model.md) to describe the new shape.
3. Update the top-of-file comment in `revisor.js` listing revision fields.
4. Make sure `addToHistory` stamps the new version on every new revision (automatic: it already uses the constant).
5. Add tests for new-format round-trips and for reading old-format revisions (the mock `$tw` store in `tests/mock-tw.js` lets you hand-craft old-format tiddlers).

## Reader responsibilities (tolerating old versions)

Today the plugin does not branch on `revision-version` — it detects old-format revisions by the absence of specific fields (`revision-data`, `revision-content-hash`, `revision-changed-fields`). This works because the schema has only grown so far.

When a format change is breaking rather than additive, switch to explicit version branching:

```js
const v = getRevisionVersion(revision);
if (v === "0" || v === "1") {
  // legacy path
} else if (v === "2") {
  // new path
}
```

Keep branches narrow — one `switch` at the top of `reconstructAllFields` and `reconstructText` is usually enough.

## Migration strategy

The plugin does **not** rewrite existing revisions when the schema changes. That is deliberate:

- Revisions are immutable user history. Rewriting them on plugin load would destroy audit integrity, slow first boot on large wikis, and create a window where a partially-migrated wiki is inconsistent.
- TiddlyPWA syncs every tiddler change to the server; a mass rewrite would produce an O(history) sync storm.

Instead, readers tolerate older formats. The dedup path already demonstrates the pattern: `revision-content-hash` is preferred, `revision-full-hash` is the fallback, raw text equality is the final fallback. Future schema changes should follow the same "new fields augment, old fields remain readable" principle unless there's no way to avoid a breaking change — in which case add an explicit reader branch keyed on `getRevisionVersion`.

## History so far

| Version | Introduced in | What changed |
|---------|---------------|--------------|
| `"0"`   | pre-fork (upstream `ashlin/timelord`) | Original format. No `revision-data`, no hashes, no delta storage; revision tiddlers held fields directly; no rename markers; no change-fields metadata. |
| `"1"`   | Phase 10 | All fields serialized into `revision-data`; three-mode storage (`full`/`diff`/`delta`); content hash for dedup; `revision-number`, `revision-changed-fields`, `revision-renamed-from`/`-to`; `revision-version` itself. |

When the next bump lands, add a row here describing the diff from `"1"`.
