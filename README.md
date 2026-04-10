# Revision History for TiddlyWiki (mblackman fork)

A personal fork of [Ashlin Duncan's tiddlywiki-revision-history](https://github.com/AshlinDuncan/tiddlywiki-revision-history), with the hopes of improvements to the interface and integration with TiddlyWiki.

[Demo](https://mblackman.github.io/tiddlywiki-revision-history/)

## Goals

- **Infinite revision history** — no automatic pruning, ever. The wiki is the source of truth.
- **Full restore** — click any revision and restore the tiddler to that state (restore is itself undoable).
- **Delete capture** — when a tiddler is deleted, its final state is saved before removal. Deleted-tiddler history stays discoverable and restorable.
- **Diff view** — see exactly what changed between any two revisions.
- **Bulk-operation pause** — toggle tracking off for mass imports, back on when done.

## Building

```bash
npm install
npm run build-plugin   # outputs build/revision-history.tid
npm run build-all      # also builds the demo wiki to build/index.html
npm run serve          # dev server at localhost:8080
```

## Installation

Install it from the [Demo](https://mblackman.github.io/tiddlywiki-revision-history/) page by dragging and dropping the plugin.

Or if you are testing locally:

Import `build/revision-history.tid` into your TiddlyWiki by drag-and-drop or the standard import dialog.

## Requirements

TiddlyWiki `>=5.3.0`.

## Current behaviour

Once a tiddler has been edited, the plugin intercepts the save and archives the previous version as a system tiddler. To view revisions, click the **Info** button on a tiddler and go to the **Revisions** tab.

- Only tiddlers with a `text` field are tracked. System tiddlers and shadow tiddlers are excluded.
- Field-only changes (tags, custom fields, no text change) are **not** currently tracked — planned for a future phase.
- Renaming a tiddler migrates its full revision history to the new title.
- Deleting a tiddler leaves existing revisions in place but does **not** capture the final state before deletion — this is a known gap being addressed in Phase 4.
