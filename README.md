# Revision History for TiddlyWiki (mblackman fork)

A personal fork of [Ashlin Duncan's tiddlywiki-revision-history](https://github.com/AshlinDuncan/tiddlywiki-revision-history), featuring significant improvements to the interface, storage mechanisms, and core TiddlyWiki integration.

[Demo](https://mblackman.github.io/tiddlywiki-revision-history/)

## Features

- **Infinite revision history** — No automatic pruning, ever. The wiki is the source of truth.
- **Full restore** — Click any revision and restore the tiddler to that exact state (including all fields and tags). Restores are themselves undoable.
- **Delete capture** — When a tiddler is deleted, its final state is saved before removal. A "Deleted Tiddlers" sidebar tab keeps them discoverable and restorable.
- **Diff view** — See exactly what changed between any two revisions, including both text diffs and field changes (e.g., added/removed tags).
- **Smart storage** — Revisions use delta and diff compression under the hood to minimize storage bloat while retaining a complete history of all fields.
- **Bulk-operation pause & exclusions** — Toggle tracking off globally for mass imports, or exclude specific tiddlers via filters in the Control Panel.

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

## Usage

Once a tiddler has been edited, the plugin automatically archives the previous version as a system tiddler.
- To view revisions, diffs, and restore a tiddler, click the **Info** button on a tiddler and go to the **Revisions** tab.
- To view or restore deleted tiddlers, open the sidebar and navigate to the **Deleted Tiddlers** tab.
