#!/usr/bin/env node
// Seed script: replays demo-content.js through the Revisor to build
// valid revision chains with proper hashes, deltas, and snapshots.
// Run via: npm run seed-demo  (after babel transpile)
// Outputs .tid files into demo/tiddlers/
//
// Content lives in demo-content.js — edit that file to change the demo.

const path = require('path');
const fs = require('fs');

// --- Bootstrap mock $tw runtime ---
const { createMockTw } = require('../tests/mock-tw');
global.$tw = createMockTw();

// Wire up DMP shim so revisor can find it
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '$:/core/modules/utils/diff-match-patch/diff_match_patch.js') {
    return require.resolve('../tests/dmp-shim');
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const { Revisor, generateTag } = require('../plugins/mblackman/timelord/lib/revisor');
const content = require('./demo-content');

const revisor = new Revisor();

// --- Controlled clock ---
let currentTime = new Date('2026-03-01T10:00:00Z').getTime();
function advanceTime(minutes) {
  currentTime += minutes * 60 * 1000;
}

const OrigDate = Date;
global.Date = class extends OrigDate {
  constructor(...args) {
    if (args.length === 0) {
      super(currentTime);
    } else {
      super(...args);
    }
  }
  static now() { return currentTime; }
};
global.Date.prototype = OrigDate.prototype;

// --- Tiddler operations ---

function saveTiddler(name, fields, options) {
  const existing = $tw.wiki.getTiddler(name);
  const merged = Object.assign(
    {},
    existing ? existing.fields : {},
    { title: name, 'revision-tag': generateTag(name) },
    fields,
    { modified: new Date(currentTime) }
  );
  const tiddler = new $tw.Tiddler(merged);
  $tw.wiki.addTiddler(tiddler);
  revisor.addToHistory(name, tiddler, options);
}

function deleteTiddler(name) {
  const tiddler = $tw.wiki.getTiddler(name);
  if (tiddler) {
    revisor.captureDeletedState(name, tiddler);
    $tw.wiki.deleteTiddler(name);
  }
}

function renameTiddler(oldName, newName, fieldUpdates) {
  const existing = $tw.wiki.getTiddler(oldName);
  if (!existing) return;
  const fields = Object.assign({}, existing.fields, { title: newName }, fieldUpdates || {});
  const tiddler = new $tw.Tiddler(fields);
  $tw.wiki.deleteTiddler(oldName);
  $tw.wiki.addTiddler(tiddler);
  revisor.renameHistory(oldName, newName);
  revisor.addToHistory(newName, tiddler, { renamedFrom: oldName, renamedTo: newName });
}

// --- Replay content definitions ---

for (const tiddlerDef of content) {
  let currentName = tiddlerDef.name;

  for (const version of tiddlerDef.versions) {
    advanceTime(version.wait || 15);

    switch (version.action) {
      case 'save':
        saveTiddler(currentName, version.fields || {}, version.summary ? { summary: version.summary } : undefined);
        break;
      case 'rename':
        renameTiddler(currentName, version.newName, version.fields);
        currentName = version.newName;
        break;
      case 'delete':
        deleteTiddler(currentName);
        break;
    }
  }
}

// --- System tiddlers ---

$tw.wiki.addTiddler(new $tw.Tiddler({
  title: '$:/DefaultTiddlers',
  text: '[[Welcome to Timelord]] [[Chocolate Chip Cookies]] [[Installation]]',
}));

$tw.wiki.addTiddler(new $tw.Tiddler({
  title: '$:/StoryList',
  list: 'Welcome to Timelord Chocolate Chip Cookies Installation',
}));

// --- Output .tid files ---

const outDir = path.join(__dirname, '..', 'demo', 'tiddlers');

const keepFiles = new Set([
  '$__config_ViewToolbarButtons_Visibility_$__core_ui_Buttons_info.tid',
]);

const existing = fs.readdirSync(outDir);
for (const f of existing) {
  if (f.endsWith('.tid') && !keepFiles.has(f)) {
    fs.unlinkSync(path.join(outDir, f));
  }
}

function sanitizeFilename(title) {
  return title.replace(/\$:\//g, '$__').replace(/\//g, '_');
}

function tiddlerToTid(tiddler) {
  const fields = tiddler.fields;
  let header = '';
  let text = '';
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'text') {
      text = typeof val === 'string' ? val : String(val);
      continue;
    }
    let strVal;
    if (val instanceof Date || val instanceof OrigDate) {
      const d = new Date(val);
      strVal = d.getUTCFullYear().toString() +
        (d.getUTCMonth() + 1).toString().padStart(2, '0') +
        d.getUTCDate().toString().padStart(2, '0') +
        d.getUTCHours().toString().padStart(2, '0') +
        d.getUTCMinutes().toString().padStart(2, '0') +
        d.getUTCSeconds().toString().padStart(2, '0') +
        d.getUTCMilliseconds().toString().padStart(3, '0');
    } else {
      strVal = String(val);
    }
    header += `${key}: ${strVal}\n`;
  }
  return header + '\n' + text;
}

let revisionCount = 0;
let contentCount = 0;

for (const [title, tiddler] of $tw.wiki.store) {
  if (title === '$:/config/ViewToolbarButtons/Visibility/$:/core/ui/Buttons/info') continue;

  const filename = sanitizeFilename(title) + '.tid';
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, tiddlerToTid(tiddler));

  if (title.includes('/revisions/')) {
    revisionCount++;
  } else {
    contentCount++;
  }
}

console.log(`\nSeed complete!`);
console.log(`  ${contentCount} content tiddlers`);
console.log(`  ${revisionCount} revision tiddlers`);
console.log(`  Output: ${outDir}`);
