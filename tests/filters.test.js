const { resetTw } = require('./mock-tw');
const { generateTag, Revisor } = require('../plugins/revision-history/src/revisor');
const { reconstructtext, revisionchangedfields, revisionchanges } = require('../plugins/revision-history/src/filters');
const DMP = require('diff-match-patch');

beforeEach(() => {
  resetTw($tw);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper: wrap a tiddler title in a filter source function (mimics TW filter pipeline)
function makeSource(...titles) {
  return function(callback) {
    for (const title of titles) {
      const tiddler = $tw.wiki.getTiddler(title);
      callback(tiddler, title);
    }
  };
}

// ---------------------------------------------------------------------------
// reconstructtext filter operator
// ---------------------------------------------------------------------------

describe('reconstructtext', () => {
  it('returns text field directly for non-revision tiddlers', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'Regular', text: 'plain text' }));

    const results = reconstructtext(makeSource('Regular'), {}, {});
    expect(results).toEqual(['plain text']);
  });

  it('returns empty string for nonexistent tiddlers', () => {
    const results = reconstructtext(makeSource('noexist'), {}, {});
    expect(results).toEqual(['']);
  });

  it('returns reconstructed text for full-storage revision tiddlers', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'full text content' }),
    }));

    const results = reconstructtext(makeSource('rev1'), {}, {});
    expect(results).toEqual(['full text content']);
  });

  it('resolves delta chains for delta-storage revision tiddlers', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'base text' }),
    }));

    const patch = dmp.patch_toText(dmp.patch_make('base text', 'updated text'));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: patch }),
    }));

    const results = reconstructtext(makeSource('rev2'), {}, {});
    expect(results).toEqual(['updated text']);
  });

  it('handles multiple source titles', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'A', text: 'alpha' }));
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'B', text: 'beta' }));

    const results = reconstructtext(makeSource('A', 'B'), {}, {});
    expect(results).toEqual(['alpha', 'beta']);
  });
});

// ---------------------------------------------------------------------------
// revisionchangedfields filter operator
// ---------------------------------------------------------------------------

describe('revisionchangedfields', () => {
  it('returns stored metadata when available', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
      'revision-changed-fields': 'text tags custom',
    }));

    const results = revisionchangedfields(makeSource('rev1'), {}, {});
    expect(results).toEqual(['text', 'tags', 'custom']);
  });

  it('returns empty for non-revision tiddlers', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'Regular', text: 'plain' }));

    const results = revisionchangedfields(makeSource('Regular'), {}, {});
    expect(results).toEqual([]);
  });

  it('computes on-the-fly for old revisions without stored metadata', () => {
    const tag = generateTag('T');

    // First revision (full snapshot)
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello', tags: 'foo' }),
    }));

    // Second revision — no stored changed-fields metadata
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello', tags: 'bar', custom: 'new' }),
    }));

    const results = revisionchangedfields(makeSource('rev2'), {}, {});
    expect(results).toContain('tags');
    expect(results).toContain('custom');
    expect(results).not.toContain('text');
  });

  it('returns empty for the first revision in history (no predecessor)', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
      // No revision-changed-fields stored
    }));

    const results = revisionchangedfields(makeSource('rev1'), {}, {});
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// revisionchanges filter operator
// ---------------------------------------------------------------------------

describe('revisionchanges', () => {
  it('returns formatted descriptions of field changes', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', custom: 'old value' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', custom: 'new value' }),
    }));

    const results = revisionchanges(makeSource('rev2'), {}, {});
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('custom');
    expect(results[0]).toContain('old value');
    expect(results[0]).toContain('new value');
    expect(results[0]).toContain('→');
  });

  it('formats tag additions and removals with +/- notation', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', tags: 'alpha beta' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', tags: 'beta gamma' }),
    }));

    const results = revisionchanges(makeSource('rev2'), {}, {});
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/tags:/);
    expect(results[0]).toContain('+[[gamma]]');
    expect(results[0]).toContain('-[[alpha]]');
  });

  it('formats field additions as "(added)"', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', newfield: 'hello' }),
    }));

    const results = revisionchanges(makeSource('rev2'), {}, {});
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('newfield');
    expect(results[0]).toContain('(added)');
    expect(results[0]).toContain('hello');
  });

  it('formats field removals as "(removed)"', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', gone: 'was here' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
    }));

    const results = revisionchanges(makeSource('rev2'), {}, {});
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('gone');
    expect(results[0]).toContain('(removed)');
  });

  it('skips text field (shown via diff widget instead)', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'old text' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'new text' }),
    }));

    const results = revisionchanges(makeSource('rev2'), {}, {});
    // Text changes should not appear in the results
    expect(results).toHaveLength(0);
  });

  it('returns empty for first revision (no predecessor)', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', custom: 'val' }),
    }));

    const results = revisionchanges(makeSource('rev1'), {}, {});
    expect(results).toEqual([]);
  });

  it('returns empty for non-revision tiddlers', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'Regular', text: 'plain' }));
    const results = revisionchanges(makeSource('Regular'), {}, {});
    expect(results).toEqual([]);
  });
});
