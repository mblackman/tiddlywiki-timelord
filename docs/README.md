# Documentation

Documentation for the `mblackman/revision-history` TiddlyWiki plugin.
These docs assume familiarity with TiddlyWiki plugin authoring (tiddlers, filters, widgets, hooks).

If you are a new user, see the top-level [README.md](../README.md) for install and usage.

## Contents

- [architecture.md](architecture.md) — high-level module layout, data flow, and lifecycle of a revision.
- [data-model.md](data-model.md) — revision tiddler naming scheme and the full field reference.
- [storage-and-reconstruction.md](storage-and-reconstruction.md) — how `full` / `diff` / `delta` storage modes work and how reconstruction walks the chain.
- [integration.md](integration.md) — TiddlyWiki hooks, widget messages, filter operators, and UI tiddlers the plugin registers.
- [development.md](development.md) — build, test, and debug workflows; how to extend the plugin.
- [schema-versioning.md](schema-versioning.md) — what `SCHEMA_VERSION` means and how to evolve the on-disk format.
- [chain-integrity.md](chain-integrity.md) — verify/repair APIs, failure modes, and expected behavior under partial imports.

## Quick map of the source tree

```
plugins/mblackman/revision-history/
  src/
    revisor.js       # core: add/restore/reconstruct revisions
    listener.js      # startup module; registers hooks and widget-message handlers
    filters.js       # filter operators used by the UI
  Revisions.tid      # Info-panel tab ($:/tags/TiddlerInfo)
  DeletedTiddlers.tid# sidebar tab ($:/tags/SideBar)
  ControlPanel.tid   # settings tab ($:/tags/ControlPanel)
  Settings.tid       # exposed toggles
  Readme.tid         # in-wiki plugin readme
  plugin.info
  tiddlywiki.files   # maps lib/*.js and *.tid into TW module titles
tests/               # Jest unit tests plus mock $tw runtime
demo/                # tiddlers for demo site
```
