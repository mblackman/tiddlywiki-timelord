# TiddlyWiki Integration

This page enumerates every place the plugin touches the TiddlyWiki runtime: hooks, widget messages, filter operators, config tiddlers, and the UI tiddlers it registers.

## Startup module

`src/listener.js` is declared as a startup module in `tiddlywiki.files` with module type `startup`. TiddlyWiki calls its exported `startup()` function once during boot. That function registers everything listed below.

Minimum TW version: **5.3.0**. Earlier versions do not pass the draft as the second argument of `th-saving-tiddler`; a `if (!draft) return newTiddler` guard keeps the plugin from crashing on older TW but also disables revision capture (rename detection is no longer possible).

## Hooks

### `th-saving-tiddler`

Registered in `listener.js:26`. Signature: `(newTiddler, draft) → newTiddler`.

Guards in order (any `return newTiddler` short-circuits without writing a revision):

1. `draft` is falsy — old TW version, cannot detect renames; skip.
2. `$:/config/mblackman/revision-history/enabled` is not `"yes"`.
3. `draft.of` is empty — new tiddler, nothing to compare against.
4. `$tw.wiki.getTiddler(oldTitle)` returns nothing — no pre-save state to save.
5. Either `oldTitle` or `newTitle` is a system or shadow tiddler.
6. `newTitle` matches `$:/config/mblackman/revision-history/exclude-filter`.

Behavior when not short-circuited:

- If `oldTitle !== newTitle`, call `renameHistory(oldTitle, newTitle)` to retag existing revisions.
- Set `revision-tag: generateTag(newTitle)` on `newTiddler` (returned to TW, so it lands on the live tiddler).
- If it's a rename that overwrites an existing tiddler, snapshot *that* tiddler's current state first (via `addToHistory(newTitle, existing)`) so the overwrite is recoverable.
- If `tiddlerFieldsChanged(oldTiddler, newTiddler)` is `false`, return without writing.
- Otherwise `addToHistory(newTitle, oldTiddler, { renamedFrom, renamedTo })`. The `opts` object is only passed on actual renames.

The old tiddler is what gets captured — the listener records the state being replaced, not the new state. The new state is what becomes the live tiddler.

### `th-deleting-tiddler`

Registered in `listener.js:93`. Signature: `(tiddler) → tiddler`.

Same guards as above (enabled, system/shadow, exclude-filter). On success, calls `revisor.captureDeletedState(title, tiddler)`, which writes a revision (subject to dedup) and stamps `revision-deleted: yes` on the matching revision.

## Widget messages

### `tm-restore-revision`

Payload: `paramObject.revisionTitle` — the full title of the revision to restore.
Handler: `revisor.restoreFromRevision(revisionTitle)`.

Used by the "Restore" button in the Revisions tab. The restore snapshot + title-change logic lives entirely inside `Revisor`.

### `tm-restore-deleted-tiddler`

Payload: `paramObject.tiddlerName` — the original name of a deleted tiddler.
Handler: looks up the latest `revision-deleted` revision with `revisor.getLatestDeletedRevision(name)`, then delegates to `restoreFromRevision`.

Used by the Restore button in the Deleted Tiddlers sidebar.

### `tm-verify-revision-chains`

No payload. Scans every revision chain in the wiki via `revisor.verifyAllChains()` and writes a human-readable report to `$:/temp/mblackman/revision-history/verify-report`. The report tiddler also carries numeric summary fields (`total-chains`, `broken-chains`, `total-revisions`, `broken-revisions`) so downstream UI can render badges without parsing the text.

Used by the "Verify revision history" button in the Settings tab.

### `tm-repair-revision-chains`

No payload. Runs `revisor.repairAllChains()`, which flags every broken revision with `revision-broken-chain: yes` and tries to promote the earliest still-reconstructable delta after a break into a full snapshot. Writes a summary to the same `verify-report` tiddler.

Used by the "Repair broken chains" button in the Settings tab.

## Filter operators

Defined in `src/filters.js`. Each is registered under its export name via TiddlyWiki's filter operator convention.

### `reconstructtext`

```
[<revisionTitle>reconstructtext[]]
```

- On a revision tiddler: returns the fully reconstructed text via `Revisor.reconstructText`.
- On a regular tiddler: returns the `text` field directly (so the operator is safe to use on mixed input, e.g. "compare this revision against the current tiddler").

Used in `Revisions.tid` for both diff sources and the character count (`length[]`).

### `revisionchangedfields`

```
[<revisionTitle>revisionchangedfields[]]
```

Returns the list of meaningful field names that changed in the revision.

- Reads `revision-changed-fields` if present (the common case).
- Falls back to computing it on the fly by reconstructing both this revision and the previous one and diffing their field maps. This keeps old revisions (pre-`revision-changed-fields` field) working.
- Excludes auto-fields from the fallback computation.

### `reconstructfield`

```
[<revisionTitle>reconstructfield[fieldname]]
```

- On a revision tiddler: returns the reconstructed value for `fieldname` via `reconstructAllFields`.
- On a regular tiddler: returns the field directly.

Used by the field-changes UI to render `old → new` inline comparisons and the tag-diff +tag/-tag view.

## Config tiddlers

| Title | Default | Purpose |
|-------|---------|---------|
| `$:/config/mblackman/revision-history/enabled` | `"yes"` | Master on/off. Checked on every save and delete. Also temporarily flipped by `restoreFromRevision` so the restore doesn't create a spurious revision. |
| `$:/config/mblackman/revision-history/exclude-filter` | `""` | Any filter expression. Tiddlers matching are skipped on save and delete. |
| `$:/config/mblackman/revision-history/diff-size-limit` | `"102400"` | Maximum reconstructed text length (characters) before the diff view in `Revisions.tid` falls back to raw text. Prevents UI lag on pathologically large tiddlers. |

All three are wired to visible controls in `Settings.tid` (a `$:/tags/ControlPanel/SettingsTab` tab).

## UI tiddlers shipped with the plugin

| File | Tag | Role |
|------|-----|------|
| `Revisions.tid` | `$:/tags/TiddlerInfo` | Per-tiddler revision list: sortable, paginated (20/all), restore, diff-vs-current, diff-vs-previous, field-changes expansion, rename markers. |
| `DeletedTiddlers.tid` | `$:/tags/SideBar` | Sidebar tab listing tiddler names that have a `revision-deleted` revision but no live tiddler. Offers a Restore button per row. |
| `ControlPanel.tid` | `$:/tags/ControlPanel` | Toggles for enabled / exclude-filter. |
| `Settings.tid` | — | Shared helper state. |
| `Readme.tid` | — | In-wiki plugin readme. |

The `Revisions.tid` entry template is factored into a `\define entry-template()` macro so the same rendering is reused across four filter variants (two sort directions × paginated/all).

## State tiddlers created at runtime

These are scratch tiddlers the UI writes to drive its own reveal/expand state. Nothing persists that isn't already user-visible state.

- `$:/state/revision-history/restore-confirm` — holds the revision title currently awaiting restore confirmation.
- `$:/state/revision-history/diff-current/<revisionTitle>` — `"open"` when the diff-vs-current section is expanded.
- `$:/state/revision-history/diff-prev/<revisionTitle>` — `"open"` when the diff-vs-previous section is expanded.
- `$:/state/revision-history/field-changes/<revisionTitle>` — `"open"` when the per-field changes are expanded.
- `$:/state/revision-history/show-all/<parentTitle>` — `"all"` when pagination is expanded.
- `$:/state/revision-history/sort/<parentTitle>` — `"asc"` for oldest-first sorting; empty for newest-first.
