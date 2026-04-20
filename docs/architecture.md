# Architecture

## Design goals

- **Infinite, lossless history.** Every meaningful save of a user tiddler produces at most one new revision tiddler. Nothing is pruned automatically.
- **All fields tracked, not just text.** Tags, type, custom fields, and renames are all captured.
- **Compact storage.** Revisions use a combination of full snapshots and delta/diff compression so long histories don't explode wiki size.
- **Transparent reconstruction.** The UI can read any historical revision as if it were a full snapshot; delta resolution happens behind filter operators.
- **No core overrides.** The plugin wires into TiddlyWiki only via public `$tw.hooks` and widget messages.

## Module layout

```
src/revisor.js      → lib/revisor.js     (the Revisor class, hashing, generateTitle/Tag)
src/listener.js     → lib/listener.js    (startup module: hooks + widget messages)
src/filters.js      → lib/filters.js     (three filter operators used by the UI)
```

Babel transpiles ES modules in `src/` to CommonJS in `lib/`. `tiddlywiki.files` maps the three `lib/*.js` files to their TW module titles (`$:/plugins/mblackman/timelord/revisor.js`, etc.) with module type `application/javascript`, plus all `.tid` files at the plugin root.

The three JS modules are deliberately small and have clear responsibilities:

| File | Role |
|------|------|
| `revisor.js` | All revision CRUD, reconstruction, and hashing. No knowledge of TW events — it is driven by callers. |
| `listener.js` | Startup module. Wires `th-saving-tiddler` / `th-deleting-tiddler` hooks and `tm-restore-*` widget messages to `Revisor`. |
| `filters.js` | Exposes `Revisor.reconstructText` / `reconstructAllFields` / changed-field metadata to wikitext as filter operators. |

`Revisor` has no DOM or event dependencies. It reads and writes through the `$tw.wiki` store, which is what makes the Jest-based tests (under `tests/`) possible without a browser.

## Lifecycle of a revision

### Save

1. User saves a draft in the editor. TiddlyWiki fires `th-saving-tiddler(newTiddler, draft)`.
2. `listener.js` guards: the plugin must be enabled (`$:/config/mblackman/timelord/enabled`), neither old nor new titles can be system/shadow, and the new title must not match the exclusion filter.
3. The listener reads and strips any `edit-summary` field from the tiddler so it doesn't persist on the live tiddler; the value is forwarded to `addToHistory` as `opts.summary`.
4. The listener reads `draft.of` to discover the pre-save title. If it differs, it's a rename — `Revisor.renameHistory(oldTitle, newTitle)` runs before anything else.
5. The listener injects a `revision-tag` field on the saved tiddler so the UI can look up history quickly (`[tag<revisionTag>...]`).
6. If `tiddlerFieldsChanged(oldTiddler, newTiddler)` returns `false` (only auto-fields like `modified` moved) and no summary was supplied, no revision is written.
7. Otherwise the listener calls `revisor.addToHistory(newTitle, oldTiddler, opts)`. `opts` may carry `{ renamedFrom, renamedTo, summary }`.
8. Inside `addToHistory`:
   - Serialize the tiddler's fields, compute three SHA-256 hashes (`text`, `full`, `content`), and dedup against existing revisions via `revision-content-hash`.
   - Decide storage mode (`full` / `delta`) based on snapshot interval and patch-vs-text size (see [storage-and-reconstruction.md](storage-and-reconstruction.md)).
   - Compute `revision-changed-fields` by diffing against the reconstructed previous revision.
   - Write a new revision tiddler tagged with `generateTag(name)`.

### Delete

1. User deletes a tiddler. TiddlyWiki fires `th-deleting-tiddler(tiddler)`.
2. Same enabled / system-tiddler / exclude-filter guards as above.
3. `revisor.captureDeletedState(name, tiddler)` calls `addToHistory` (dedup applies) and then stamps `revision-deleted: yes` on the revision that matches the final text hash.

### Restore

1. UI button sends `tm-restore-revision` (or `tm-restore-deleted-tiddler`) with the revision title (or the deleted tiddler's name) in `paramObject`.
2. `listener.js` routes it to `revisor.restoreFromRevision(revisionTitle)`.
3. `restoreFromRevision`:
   - Snapshots the current live tiddler first (so the restore itself is undoable).
   - Rebuilds the full field state via `reconstructAllFields`.
   - Strips revision-only fields, re-adds `revision-tag`, and writes the live tiddler.
   - Temporarily flips `$:/config/mblackman/timelord/enabled` to `no` while applying the restore, so the write itself does not create an extra revision.
   - If the restored title differs from the current live title, deletes the current tiddler, renames the history via `renameHistory`, and patches `$:/StoryList` so the user still sees the restored tiddler in the open list.

## Data flow diagram (save path)

```
editor save
   │
   ▼
$tw.hooks.invokeHook("th-saving-tiddler", newTiddler, draft)
   │
   ▼
listener.js — enabled? system? excluded? rename? fields changed?
   │         (renameHistory on rename)
   ▼
Revisor.addToHistory(name, oldTiddler, opts)
   │
   ├─ dedup via revision-content-hash
   ├─ reconstructAllFields(previousRevision)  ← for delta computation
   ├─ _shouldStoreSnapshot() → "full" vs "delta"
   └─ $tw.wiki.addTiddler(new revision tiddler, tagged generateTag(name))
```

## UI wiring (read path)

```
Revisions.tid  ──filter──▶  [tag<revisionTag>...]
     │                          │
     │                          ▼
     ├──▶ [<rev>reconstructtext[]]      ◀── filters.js.reconstructtext
     ├──▶ [<rev>revisionchangedfields[]]◀── filters.js.revisionchangedfields
     └──▶ [<rev>reconstructfield<name>] ◀── filters.js.reconstructfield
                    │
                    ▼
              Revisor.reconstructAllFields / reconstructText
                    │
                    ▼
         walks delta chain to nearest snapshot
```

The UI never touches storage modes directly — it just calls the filter operators and gets back the reconstructed value.
