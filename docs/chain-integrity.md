# Chain Integrity & Repair

Delta-compressed history is efficient but fragile: a single missing revision can make every later revision in the chain silently unreconstructable. This page describes the verification and repair machinery added in Phase 13, the failure modes it catches, and the behavior expected under partial imports.

## What "broken" means

A revision is classified as broken when any of the following is true:

1. **No preceding full snapshot.** A `delta` or legacy `diff` revision appears in the chain without a prior full revision to anchor against. Common cause: partial import, manual deletion of the seed snapshot.
2. **Snapshot unreachable.** `reconstructText` walks back through deltas and never finds a non-delta revision. Same symptom as (1) but detected mid-walk.
3. **Patch failure.** `diff_match_patch.patch_apply` reports any patch as unsuccessful when resolving the text chain.
4. **Parse failure.** `revision-data` is malformed JSON, or a delta patch text cannot be parsed.
5. **Hash mismatch.** Reconstructed state hashes to a different value than the stored `revision-full-hash`. Indicates silent drift — the stored data cannot be trusted even if the chain walk completed without errors.

Ok revisions from a structurally healthy chain but with no stored hash (pre-Phase 10 revisions) return `ok: true` with reason `legacy (no stored hash)` — we cannot verify them either way.

## API surface

```
revisor.verifyRevisionIntegrity(revisionTitle)
  → { ok, storedHash?, computedHash?, reason? }

revisor.verifyChain(name)
  → { name, revisions: [{ title, storage, status, reason }], status, brokenCount }

revisor.verifyAllChains()
  → { chains: [...verifyChain results], summary: { totalChains, okChains, brokenChains, totalRevisions, brokenRevisions } }

revisor.repairChain(name)
  → { name, marked, promoted, total }

revisor.repairAllChains()
  → { results: [...repairChain results], summary: { chainsRepaired, totalMarked, totalPromoted } }
```

`verifyChain` iterates revisions oldest-first and applies the checks above in order; each broken revision carries a short `reason` string.

## What repair does

`repairChain` is intentionally conservative:

1. Stamps every broken revision with `revision-broken-chain: yes`. The Revisions tab UI surfaces these with a red `⚠ broken chain` badge so users know not to trust the reconstructed content.
2. Finds the earliest *ok* delta or diff revision that follows a broken revision, and promotes it to a `full` snapshot. This anchors the downstream chain so further losses don't cascade past that point.

Repair never deletes revisions, never rewrites their `revision-data` in a lossy way, and never attempts to fabricate missing state. Broken revisions stay broken — they are flagged, not patched up.

## Widget messages

Exposed to the UI as:

- `tm-verify-revision-chains` — runs `verifyAllChains`, writes a human-readable report to `$:/temp/mblackman/revision-history/verify-report` with summary fields.
- `tm-repair-revision-chains` — runs `repairAllChains`, writes the summary to the same report tiddler.

Both are wired to buttons in the Settings tab (`$:/tags/ControlPanel/SettingsTab`).

## Expected behavior under imports

The scenarios below are covered by `tests/import.test.js`.

### 1. Partial JSON bundle (some revisions missing)

Importing a slice of history that omits the initial full snapshot produces broken revisions: each orphaned delta is flagged with reason `no preceding full snapshot`. Later revisions in the same tiddler that have their own fresh full snapshot are unaffected.

### 2. Orphan revisions (no live tiddler)

Importing revisions for a tiddler that does not exist locally is supported and safe:
- `historyExists(name)` returns `true`.
- The Deleted Tiddlers sidebar surfaces the name if any revision has `revision-deleted: yes`.
- `restoreFromRevision` on an orphan revision creates the live tiddler from the reconstructed fields (the `revision-deleted` marker is stripped).

### 3. Newer-schema revisions

Revisions carrying a `revision-version` value the current reader doesn't recognize are still read. The reader ignores unknown `revision-version` and unknown metadata fields on the revision tiddler — `revision-data` is the source of truth. This is the "readers stay tolerant" policy from [schema-versioning.md](schema-versioning.md).

### 4. Pre-versioning revisions (no `revision-full-hash`)

Legacy revisions pass `verifyChain` as ok because there is no stored hash to compare against. Their chain structure (storage mode ordering, patch success) is still checked.
