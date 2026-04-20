# Storage and Reconstruction

The plugin stores revisions in one of two modes, indicated by the `revision-storage` field. Each mode is a different shape for the `revision-data` JSON blob. This document explains when each mode is chosen, what the blob contains, and how reconstruction walks the chain.

## Storage modes

### `"full"` — self-contained snapshot

- `revision-data` is a JSON object containing **all** of the tiddler's fields (including full text). Keys are sorted for deterministic hashing.
- Used for: the very first revision of a tiddler, the periodic snapshot (every `SNAPSHOT_INTERVAL = 10` revisions), and the fallback when a text patch ends up larger than the text itself.
- Readable with zero chain walking.

### `"delta"` — changed fields only

- `revision-data` is a JSON object containing **only the fields that changed** since the previous revision.
- Values:
  - `null` — the field was removed in this revision.
  - any other string — the new value for that field.
  - key absent — the field did not change; reuse the value from the previous revision.
- For the `text` field specifically, when text *did* change, the value stored is a **diff-match-patch patch string** (not the new text). The patch applies to the reconstructed text of the previous revision.
- If a delta would produce a patch text larger than the new text itself, `addToHistory` falls back to `"full"` on the spot.
- This is the default mode for ordinary edits.

## When `full` vs `delta` is chosen

Defined in [`Revisor.addToHistory`](../plugins/mblackman/timelord/src/revisor.js). Decision order:

1. If there is no previous revision, write `"full"`.
2. If [`_shouldStoreSnapshot(history)`](../plugins/mblackman/timelord/src/revisor.js) returns `true` — i.e. there have been `SNAPSHOT_INTERVAL - 1 = 9` consecutive non-snapshot revisions since the last full snapshot — write `"full"`.
3. Otherwise, compute the delta. If `text` changed and `dmp.patch_toText(...)` is shorter than the new text, store `"delta"` with the patch. If the patch is not shorter, fall back to `"full"` for this revision.
4. If diff-match-patch is unavailable, `addToHistory` falls back to `"full"` for every revision and surfaces an alert tiddler; see `getDmp()` in `revisor.js`.

This guarantees that any chain of `"delta"` revisions is bounded in length (≤ 9) before a fresh `"full"` anchors it, which bounds reconstruction cost.

## Dedup

Before writing anything, `addToHistory` dedups against existing revisions by comparing `revision-content-hash` (SHA-256 of meaningful fields only). This is what makes a restore from an old revision correctly dedup — `modified` and `revision-tag` differ but content doesn't.

If a match is found, `addToHistory` returns early and no new revision is written.

## Reconstruction

Two entry points, both on `Revisor`:

- **`reconstructText(revisionTitle)`** — returns the full text of that revision as a string.
- **`reconstructAllFields(revisionTitle)`** — returns the full set of fields (including text) as a plain object.

### Text chain walk

1. If storage is `"full"`, return the text directly from `revision-data.text`.
2. Otherwise (`"delta"`):
   1. Pull the history list for this tiddler (oldest-first).
   2. Find the target revision's index.
   3. Walk backward until a non-`delta` revision is found — the anchor snapshot.
   4. Starting from the snapshot's text, apply each forward delta's text patch in order. If `revision-data.text` is absent on a delta step, text didn't change — carry forward.
3. Patch application uses `diff_match_patch.patch_apply`. If any hunk fails, a warning is logged and the best-effort result is returned.

### Field chain walk

`reconstructAllFields` handles every field, not just text.

1. For `"full"`: parse `revision-data` as-is.
2. For `"delta"`:
   1. Walk back through the history to find the nearest non-`"delta"` revision — the base.
   2. Recursively reconstruct the base's full fields.
   3. Walk forward applying each intervening delta: for every key in the delta, set the value (or delete the field if the value is `null`). Skip `text` during this pass.
   4. Finally, replace `fields.text` with `reconstructText(revisionTitle)` so text lookup uses the patch-aware path above.

## Worked example

A tiddler saved 12 times with every field changing each time produces:

```
#1  "full"   ← first save, snapshot
#2  "delta"
#3  "delta"
…
#9  "delta"
#10 "full"   ← SNAPSHOT_INTERVAL triggered
#11 "delta"
#12 "delta"
```

To read revision `#12`'s text: walk back to `#10` (the anchor), then apply patches `#11` and `#12` in order. Worst case: 9 patch applications. This is why `SNAPSHOT_INTERVAL` is an explicit constant — raising it saves storage; lowering it speeds up reconstruction.

## Hashing

The plugin uses **SHA-256** (via `$tw.utils.sha256`, SJCL-backed) for every content hash on revisions. Output is a 64-character lowercase hex string. Exported as `contentHash` from [`revisor.js`](../plugins/mblackman/timelord/src/revisor.js); `hashName` is a backward-compatible alias used by callers.

Three distinct hashes exist:

- `revision-text-hash` — hash of the captured full text only.
- `revision-full-hash` — hash of the sorted-key JSON of all fields.
- `revision-content-hash` — like `revision-full-hash` but with auto-fields stripped. This is the dedup key.

A separate lightweight hash — `pathHash` — exists only for revision title/tag path segments. It's djb2 (8 hex chars) and is not used for dedup or integrity; it's just an identifier grouping revisions by tiddler name.
