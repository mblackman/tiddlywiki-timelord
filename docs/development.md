# Development

## Prerequisites

- Node.js (any recent LTS) and npm.
- No browser-side tooling required — the plugin is vanilla JS transpiled by Babel and packaged by the `tiddlywiki` CLI.

```bash
npm install
```

Installs `@babel/*`, `cross-env`, `diff-match-patch` (used by the Jest test shim only — the runtime uses TW's bundled copy), `jest`, and `tiddlywiki`.

## Build pipeline

Babel transpiles ES modules in `src/` to CommonJS in `lib/` (required because TW's module loader is synchronous CommonJS). The `tiddlywiki.files` manifest then maps each `lib/*.js` file to its TW module title.

```bash
npm run babel           # src/ → lib/
npm run build-plugin    # babel + package plugin as build/revision-history.tid
npm run build-demo      # build the demo wiki HTML to build/index.html
npm run build-debug     # build the debug wiki HTML to build/index.html
npm run build-all       # build-plugin + build-demo
```

The plugin `.tid` file produced by `build-plugin` is drag-and-droppable into any TiddlyWiki ≥ 5.3.0.

## Development workflow

### Two wikis

- `demo/` — canonical. Committed. `build-demo` always reads here.
- `debug/` — gitignored sandbox. `serve` / `build-debug` read here. Seeded from `demo/` on first use.

```bash
npm run serve          # transpile + dev server on localhost:8081 against debug/
npm run clean-debug    # wipe debug/ and re-seed from demo/
```

To promote a sandbox change into the demo: copy the relevant `.tid` from `debug/tiddlers/` to `demo/tiddlers/` and commit.

### Typical edit cycle

1. Edit `src/revisor.js` / `src/listener.js` / `src/filters.js`.
2. `npm test` — fast, no TW needed.
3. `npm run serve` and exercise the change in a real wiki.
4. When happy, `npm run build-plugin` to sanity-check the packaged output.

`npm run serve` runs `babel` as part of its pre-step, so source edits are picked up after a page reload. If you're editing a `.tid` UI tiddler, changes to the plugin folder require a rebuild — easiest is Ctrl-C and re-run `npm run serve`.

## Testing

Jest with `babel-jest`. Tests run entirely on Node, no browser, no live TW.

```bash
npm test
npm run test:coverage
```

Structure under `tests/`:

| File | Purpose |
|------|---------|
| `mock-tw.js` | Minimal `$tw` stand-in: in-memory wiki store, `Tiddler` constructor, tag index, hooks registry, root widget event listener. |
| `dmp-shim.js` | Maps TW's internal `require("$:/core/modules/utils/diff-match-patch/...")` path to the npm `diff-match-patch` package, so real patch/apply cycles run in tests. |
| `setup.js` | Wires `mock-tw.js` and the shim into `global.$tw` before each test file. |
| `revisor.test.js` | Unit + integration tests for the `Revisor` class. Exercises every storage mode and all dedup paths. |
| `listener.test.js` | Hook registration and message routing. Covers every short-circuit guard. |
| `filters.test.js` | All three filter operators, including fallbacks. |

Coverage targets: ~90% statements/lines on core code. Do not drop below; the exit criterion for Phase 9 is ongoing.

### Writing new tests

The mock `$tw` is intentionally minimal — add methods to it only when a test needs them. Keep the mock side effect–free between tests by resetting in `beforeEach` (see existing test files).

## Coding conventions

- All ES-module source lives under `src/`. Do **not** edit `lib/` directly — it is a Babel output.
- No comments that restate the code. The top of `revisor.js` is the canonical place to document revision tiddler structure; mirror any field addition there **and** in [data-model.md](data-model.md).
- Keep `AUTO_FIELDS` in sync across `revisor.js`, `listener.js`, and `filters.js`. A helper extraction is tempting but each file loads in its own TW module boundary, so duplication is pragmatic.
- Prefer pure functions on `Revisor`. UI-driven state (e.g. toggling the enabled flag around a restore) stays inside the method; hooks in `listener.js` stay thin.
- When introducing a new revision-level field, bump `SCHEMA_VERSION` in `revisor.js` and document the change in [schema-versioning.md](schema-versioning.md).

## Extending the plugin

### Adding a new filter operator

1. Export a function from `src/filters.js` matching TW's filter-operator signature `(source, operator, options) → string[]`.
2. Add a pointer to `tiddlywiki.files` only if you split operators into new files — otherwise no change needed; the single `filters.js` module already exposes each export as an operator.
3. Add tests in `tests/filters.test.js`.

### Adding a new revision-level field

1. Document it in the header comment of `revisor.js` *and* in [data-model.md](data-model.md).
2. Write it in `addToHistory`. Strip it in `restoreFromRevision` if it should not appear on the live tiddler.
3. Bump `SCHEMA_VERSION`.
4. Ensure older revisions (missing the field) still reconstruct correctly — either by making readers tolerant, or by keying on `getRevisionVersion(revision)`.

### Adding a new UI surface

`Revisions.tid` shows how to consume the filter operators. Prefer building on the existing operators rather than reaching into `revision-data` JSON directly from wikitext — the operators hide `full`/`diff`/`delta` resolution, which wikitext cannot do.

## Debug logging

`Revisor` calls `console.log` on add / rename / capture / restore. `reconstructText` and `reconstructAllFields` call `console.warn` on patch-apply failures or unexpected chain state. These are visible in the browser devtools when running `npm run serve`.

## Release

1. `npm test` — must pass.
2. Bump version in `plugins/mblackman/revision-history/plugin.info`.
3. `npm run build-all`.
4. Commit and tag. The packaged plugin `.tid` in `build/` is what users drag-and-drop.
