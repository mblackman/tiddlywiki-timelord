# Changelog

## v0.0.6 - 2026-04-17

### Features

- **Edit summaries** — When editing a tiddler, an optional "edit summary" field appears below the editor body. The summary is stored on the revision and displayed in the Revisions tab, providing commit-message-like annotations for changes.
- **Revision comparison** — Compare any two revisions side by side, not just adjacent ones.

### Developer experience

- **Demo seed script** — Demo tiddler content and revision histories are now generated programmatically via `scripts/seed-demo.js`, driven by content definitions in `scripts/demo-content.js`. Revision tiddlers in `demo/tiddlers/` are gitignored (generated artifacts). Run `npm run seed-demo` to regenerate, or `npm run build-all` / `npm run clean-serve` which include it automatically.

## v0.0.5 — 2026-04-16

### Performance

- Deduplication now reuses the `getHistory` call instead of issuing a second lookup, reducing redundant wiki store reads on every save.
- Added `revision-text-length` field to revision tiddlers — stores original text length at write time. Char-count deltas in the Revisions tab now read this field directly instead of reconstructing the full diff chain just to get a byte count.

### Plugin presentation

- Plugin now has an icon, visible in the TiddlyWiki plugin library and Control Panel plugin list.
- Updated plugin description for clarity.

## v0.0.4 — 2026-04-15

### Improved visuals and layout

- The diff tool now works with all kinds of palettes, so its readable with a dark theme.
- Moved the location of documentation like stats and help.

### Delete history

- Now you can delete revision history of deleted tiddlers on the `Deleted Tiddlers` sidebar.

## v0.0.3 — 2026-04-13

### Rebranding

- Rebranded the plugin from `tiddlywiki-revision-history` to `timelord`.
- Updated all internal namespaces, identifiers, and UI elements to reflect the new `timelord` branding.

## v0.0.2 — 2026-04-13

### Theming

- UI elements (field-change panel, broken-chain warning, tag +/- badges, **Delete all history** button, verify/prune report boxes) now pull colors from the active TiddlyWiki palette via a stylesheet, so they adapt to dark palettes instead of using hardcoded light-mode colors.

### Packaging

- Production builds now minify the plugin's JavaScript, shrinking the bundled plugin size.
- The in-wiki "Changelog" tab has been removed. The changelog now lives at `CHANGELOG.md` in the repository.

---

## v0.0.1 — 2026-04-12

First public release of the mblackman fork. User-facing changes since the upstream Ashlin Duncan plugin:

### Revision capture

- All fields are tracked, not just text. Tag edits, type changes, and custom-field edits now create revisions.
- Deleting a tiddler captures its final state as a revision before removal.
- Renames are recorded on the resulting revision (shown as **renamed: Old → New** in the Revisions tab).
- Duplicate saves are deduplicated by content hash — no-op edits don't create revisions.

### Storage

- Revisions use three storage modes — full snapshots, text diffs, and per-field deltas — to keep history compact on long-lived tiddlers.
- A full snapshot is anchored every 10 revisions so individual deltas never require walking an unbounded chain.

### Revisions tab

- Pagination (20 per page by default) with a "Show all" toggle and newest/oldest sort control.
- Formatted timestamps, character-count deltas, and a summary of changed fields per revision.
- **Diff vs. current** and **Diff vs. previous** toggles powered by TiddlyWiki's built-in `<$diff-text>` widget.
- Tag changes render as green `+tag` / red `-tag`; other fields show inline `old → new` or a diff widget for long values.
- **Restore this version** button. The current state is captured first so the restore itself is undoable.

### Deleted tiddlers

- Sidebar tab lists every tiddler that has history but no live version. Each entry has a Restore button.

### Control Panel

- Global enable/disable toggle for revision tracking.
- Exclude-filter field to skip revisions for tiddlers matching a filter (e.g. bulk imports, drafts).
- Diff size limit (default 100 KB) — larger content falls back to raw text instead of blocking the UI.

### Chain integrity

- **Verify timelord** button walks every chain and reports broken or drifted revisions.
- **Repair broken chains** button flags broken revisions and promotes the earliest recoverable delta into a snapshot so downstream history is usable again.

### End-user surface

- New **Timelord Help** tab in the Control Panel explains what the plugin does, how to read the Revisions tab, how to pause capture, and how to prune history — aimed at users who haven't read the developer docs.
- New **Timelord Stats** tab shows total revision count, approximate storage, top tiddlers by revision count, and broken-revision totals.
- **Delete all history** button in the Revisions tab removes every revision for the current tiddler (with confirmation). The live tiddler is untouched.
- **Delete history matching filter** admin action in the Stats tab prunes history across many tiddlers at once. Blast radius is larger so confirmation is a separate step.

### Compatibility

- Requires TiddlyWiki 5.3.0 or newer.
- The `navigator.js` core override from the upstream plugin has been removed — revision capture now rides the standard `th-saving-tiddler` hook.
