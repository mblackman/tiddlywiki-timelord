# Unreleased

## Theming

- UI elements (field-change panel, broken-chain warning, tag +/- badges, **Delete all history** button, verify/prune report boxes) now pull colors from the active TiddlyWiki palette via a stylesheet, so they adapt to dark palettes instead of using hardcoded light-mode colors.

---

# v0.0.1 — 2026-04-12

First public release of the mblackman fork. User-facing changes since the upstream Ashlin Duncan plugin:

## Revision capture

- All fields are tracked, not just text. Tag edits, type changes, and custom-field edits now create revisions.
- Deleting a tiddler captures its final state as a revision before removal.
- Renames are recorded on the resulting revision (shown as **renamed: Old → New** in the Revisions tab).
- Duplicate saves are deduplicated by content hash — no-op edits don't create revisions.

## Storage

- Revisions use three storage modes — full snapshots, text diffs, and per-field deltas — to keep history compact on long-lived tiddlers.
- A full snapshot is anchored every 10 revisions so individual deltas never require walking an unbounded chain.

## Revisions tab

- Pagination (20 per page by default) with a "Show all" toggle and newest/oldest sort control.
- Formatted timestamps, character-count deltas, and a summary of changed fields per revision.
- **Diff vs. current** and **Diff vs. previous** toggles powered by TiddlyWiki's built-in `<$diff-text>` widget.
- Tag changes render as green `+tag` / red `-tag`; other fields show inline `old → new` or a diff widget for long values.
- **Restore this version** button. The current state is captured first so the restore itself is undoable.

## Deleted tiddlers

- Sidebar tab lists every tiddler that has history but no live version. Each entry has a Restore button.

## Control Panel

- Global enable/disable toggle for revision tracking.
- Exclude-filter field to skip revisions for tiddlers matching a filter (e.g. bulk imports, drafts).
- Diff size limit (default 100 KB) — larger content falls back to raw text instead of blocking the UI.

## Chain integrity

- **Verify revision history** button walks every chain and reports broken or drifted revisions.
- **Repair broken chains** button flags broken revisions and promotes the earliest recoverable delta into a snapshot so downstream history is usable again.

## End-user surface

- New **Revision History Help** tab in the Control Panel explains what the plugin does, how to read the Revisions tab, how to pause capture, and how to prune history — aimed at users who haven't read the developer docs.
- New **Revision History Stats** tab shows total revision count, approximate storage, top tiddlers by revision count, and broken-revision totals.
- **Delete all history** button in the Revisions tab removes every revision for the current tiddler (with confirmation). The live tiddler is untouched.
- **Delete history matching filter** admin action in the Stats tab prunes history across many tiddlers at once. Blast radius is larger so confirmation is a separate step.

## Compatibility

- Requires TiddlyWiki 5.3.0 or newer.
- The `navigator.js` core override from the upstream plugin has been removed — revision capture now rides the standard `th-saving-tiddler` hook.
