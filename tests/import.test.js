// Behavior tests for scenarios where revision tiddlers arrive through import
// (JSON bundle, sync partial payload, schema-newer plugin build) rather than
// through the plugin's own addToHistory path. These simulate "imported" data by
// building up revision tiddlers directly in the mock wiki, then exercising the
// verification/reconstruction paths against them.
const { resetTw } = require('./mock-tw');
const {
  Revisor,
  generateTag,
  hashName,
  SCHEMA_VERSION,
} = require('../plugins/mblackman/revision-history/src/revisor');
const DMP = require('diff-match-patch');

beforeEach(() => {
  resetTw($tw);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper: serialize fields the way revisor.js does (sorted keys)
function serialize(fields) {
  const sorted = {};
  for (const k of Object.keys(fields).sort()) sorted[k] = fields[k];
  return JSON.stringify(sorted);
}

// Helper: add a revision tiddler directly (simulating what an import produces)
function addRevision(name, { title, date, storage, data, extra = {} }) {
  const tag = generateTag(name);
  const fields = Object.assign({
    title,
    tags: '[[' + tag + ']]',
    'revision-of': name,
    'revision-date': date,
    'revision-storage': storage,
    'revision-data': data,
  }, extra);
  $tw.wiki.addTiddler(new $tw.Tiddler(fields));
}

describe('Import: partial revision set (missing earlier snapshots)', () => {
  it('marks the whole chain broken when only delta revisions are imported', () => {
    const revisor = new Revisor();
    const dmp = new DMP();

    // Simulate importing only D2, D3, D4 — F1 was left behind in the source wiki.
    const p1 = dmp.patch_toText(dmp.patch_make('base text here', 'base text edited'));
    const p2 = dmp.patch_toText(dmp.patch_make('base text edited', 'base text edited more'));
    const p3 = dmp.patch_toText(dmp.patch_make('base text edited more', 'base text edited more again'));

    addRevision('Doc', { title: 'd2', date: 2000, storage: 'delta', data: JSON.stringify({ text: p1 }) });
    addRevision('Doc', { title: 'd3', date: 3000, storage: 'delta', data: JSON.stringify({ text: p2 }) });
    addRevision('Doc', { title: 'd4', date: 4000, storage: 'delta', data: JSON.stringify({ text: p3 }) });

    const result = revisor.verifyChain('Doc');
    expect(result.status).toBe('broken');
    expect(result.brokenCount).toBe(3);
    for (const r of result.revisions) {
      expect(r.status).toBe('broken');
      expect(r.reason).toBe('no preceding full snapshot');
    }
  });

  it('salvages the portion of a chain that has a later full snapshot', () => {
    const revisor = new Revisor();
    const dmp = new DMP();

    // Imported: D2 (broken, no preceding full), F3 (fresh standalone snapshot), D4 (ok against F3)
    const orphanPatch = dmp.patch_toText(dmp.patch_make('gone', 'gone edited'));
    addRevision('Doc', {
      title: 'd2',
      date: 2000,
      storage: 'delta',
      data: JSON.stringify({ text: orphanPatch }),
    });

    const f3Data = serialize({ text: 'restart content' });
    addRevision('Doc', {
      title: 'f3',
      date: 3000,
      storage: 'full',
      data: f3Data,
      extra: { 'revision-full-hash': hashName(f3Data) },
    });

    const p4 = dmp.patch_toText(dmp.patch_make('restart content', 'restart content edited'));
    const d4State = { text: 'restart content edited' };
    addRevision('Doc', {
      title: 'd4',
      date: 4000,
      storage: 'delta',
      data: JSON.stringify({ text: p4 }),
      extra: { 'revision-full-hash': hashName(serialize(d4State)) },
    });

    const result = revisor.verifyChain('Doc');
    expect(result.status).toBe('broken');
    // d2 is broken; f3 and d4 are fine
    expect(result.brokenCount).toBe(1);
    expect(result.revisions[0].status).toBe('broken');
    expect(result.revisions[1].status).toBe('ok');
    expect(result.revisions[2].status).toBe('ok');

    // Reconstruction of ok revisions still works
    expect(revisor.reconstructText('f3')).toBe('restart content');
    expect(revisor.reconstructText('d4')).toBe('restart content edited');
  });
});

describe('Import: revisions for a tiddler that does not exist locally', () => {
  it('treats orphan revisions as a discoverable history (used by DeletedTiddlers)', () => {
    const revisor = new Revisor();

    // Imported revision history for "Orphan" — no live tiddler exists
    const data = serialize({ text: 'only in history', tags: 'archived' });
    addRevision('Orphan', {
      title: 'orev',
      date: 1000,
      storage: 'full',
      data,
      extra: { 'revision-full-hash': hashName(data), 'revision-deleted': 'yes' },
    });

    expect($tw.wiki.getTiddler('Orphan')).toBe(null);
    expect(revisor.historyExists('Orphan')).toBe(true);
    expect(revisor.getLatestDeletedRevision('Orphan')).toBe('orev');

    const fields = revisor.reconstructAllFields('orev');
    expect(fields.text).toBe('only in history');
    expect(fields.tags).toBe('archived');
  });

  it('restoring an orphan revision creates the live tiddler', () => {
    const revisor = new Revisor();

    const data = serialize({ text: 'welcome back', tags: 'restored', type: 'text/vnd.tiddlywiki' });
    addRevision('Orphan', {
      title: 'orev',
      date: 1000,
      storage: 'full',
      data,
      extra: { 'revision-full-hash': hashName(data), 'revision-deleted': 'yes' },
    });

    expect($tw.wiki.getTiddler('Orphan')).toBe(null);
    revisor.restoreFromRevision('orev');

    const restored = $tw.wiki.getTiddler('Orphan');
    expect(restored).not.toBe(null);
    expect(restored.getFieldString('text')).toBe('welcome back');
    expect(restored.getFieldString('tags')).toBe('restored');
    // revision-deleted marker must not leak onto the live tiddler
    expect(restored.fields['revision-deleted']).toBeUndefined();
  });
});

describe('Import: newer schema revisions into an older plugin', () => {
  it('tolerates unknown revision-version values', () => {
    const revisor = new Revisor();

    const data = serialize({ text: 'from the future', tags: 'v2stuff' });
    addRevision('Future', {
      title: 'frev',
      date: 1000,
      storage: 'full',
      data,
      extra: {
        'revision-full-hash': hashName(data),
        'revision-version': '99', // schema version from a future build
      },
    });

    // Reads still work — reader ignores unknown version
    const fields = revisor.reconstructAllFields('frev');
    expect(fields.text).toBe('from the future');

    // Integrity verification still passes
    const verify = revisor.verifyRevisionIntegrity('frev');
    expect(verify.ok).toBe(true);
  });

  it('tolerates unknown fields on a future revision tiddler', () => {
    const revisor = new Revisor();

    const data = serialize({ text: 'future' });
    addRevision('Future', {
      title: 'frev',
      date: 1000,
      storage: 'full',
      data,
      extra: {
        'revision-full-hash': hashName(data),
        'revision-new-field': 'some future metadata',
      },
    });

    expect(revisor.reconstructText('frev')).toBe('future');

    // Verification still succeeds because revision-data is unchanged
    const result = revisor.verifyChain('Future');
    expect(result.status).toBe('ok');
  });

  it('falls back to legacy-ok for imports without revision-full-hash', () => {
    const revisor = new Revisor();

    const data = serialize({ text: 'old format' });
    addRevision('Legacy', {
      title: 'lrev',
      date: 1000,
      storage: 'full',
      data,
      // Deliberately no revision-full-hash (pre-versioning import)
    });

    const verify = revisor.verifyRevisionIntegrity('lrev');
    expect(verify.ok).toBe(true);
    expect(verify.reason).toContain('legacy');

    const chain = revisor.verifyChain('Legacy');
    expect(chain.status).toBe('ok');
  });
});

describe('Import: repair flow on partial imports', () => {
  it('marks imported-but-orphaned delta revisions broken and leaves the full ones intact', () => {
    const revisor = new Revisor();
    const dmp = new DMP();

    // Broken orphan D1 without preceding full
    const p = dmp.patch_toText(dmp.patch_make('missing base', 'missing base edited'));
    addRevision('Mix', { title: 'd1', date: 1000, storage: 'delta', data: JSON.stringify({ text: p }) });

    // Fresh full snapshot (intact)
    const data = serialize({ text: 'new start', tags: 'new' });
    addRevision('Mix', {
      title: 'f2',
      date: 2000,
      storage: 'full',
      data,
      extra: { 'revision-full-hash': hashName(data) },
    });

    const repair = revisor.repairChain('Mix');
    expect(repair.marked).toBe(1);
    expect(repair.total).toBe(2);

    const d1 = $tw.wiki.getTiddler('d1');
    const f2 = $tw.wiki.getTiddler('f2');
    expect(d1.getFieldString('revision-broken-chain')).toBe('yes');
    expect(f2.getFieldString('revision-broken-chain')).toBe('');
  });
});
