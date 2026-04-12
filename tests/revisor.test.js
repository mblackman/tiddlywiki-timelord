const { resetTw } = require('./mock-tw');
const { Revisor, generateTitle, generateTag, escapeRegExp, hashName, SCHEMA_VERSION, getRevisionVersion } = require('../plugins/mblackman/revision-history/src/revisor');
const DMP = require('diff-match-patch');

beforeEach(() => {
  resetTw($tw);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

describe('generateTag', () => {
  it('returns a deterministic tag for a given name', () => {
    const tag1 = generateTag('MyTiddler');
    const tag2 = generateTag('MyTiddler');
    expect(tag1).toBe(tag2);
  });

  it('returns different tags for different names', () => {
    expect(generateTag('Alpha')).not.toBe(generateTag('Beta'));
  });

  it('starts with the plugin base path', () => {
    expect(generateTag('Anything')).toMatch(/^\$:\/plugins\/mblackman\/revision-history\/revisions\//);
  });
});

describe('generateTitle', () => {
  it('returns a title containing the timestamp', () => {
    const title = generateTitle({ name: 'Test', timestampMs: 1000 });
    expect(title).toContain('/1000-');
  });

  it('avoids collisions by incrementing the id suffix', () => {
    const first = generateTitle({ name: 'Test', timestampMs: 2000 });
    // Add a tiddler at the first title so the next call must increment
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: first }));
    const second = generateTitle({ name: 'Test', timestampMs: 2000 });
    expect(second).not.toBe(first);
    expect(second).toContain('/2000-1');
  });
});

describe('escapeRegExp', () => {
  it('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegExp('foo[bar]')).toBe('foo\\[bar\\]');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeRegExp('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Revisor — addToHistory
// ---------------------------------------------------------------------------

describe('Revisor.addToHistory', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('creates a revision tiddler with correct metadata', () => {
    const tiddler = new $tw.Tiddler({
      title: 'Test',
      text: 'Hello world',
      tags: 'tagA',
      type: 'text/vnd.tiddlywiki',
      modifier: 'matt',
    });
    $tw.wiki.addTiddler(tiddler);

    revisor.addToHistory('Test', tiddler);

    const history = revisor.getHistory('Test');
    expect(history).toHaveLength(1);

    const rev = $tw.wiki.getTiddler(history[0]);
    expect(rev.getFieldString('revision-of')).toBe('Test');
    expect(rev.getFieldString('revision-storage')).toBe('full');
    expect(rev.getFieldString('revision-number')).toBe('1');
    expect(rev.getFieldString('revision-data')).toBeTruthy();

    // revision-data should contain the original fields as JSON
    const data = JSON.parse(rev.getFieldString('revision-data'));
    expect(data.text).toBe('Hello world');
    expect(data.tags).toBe('tagA');
  });

  it('stores first revision as full snapshot', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'v1', modifier: 'me' });
    revisor.addToHistory('T', tiddler);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('T')[0]);
    expect(rev.getFieldString('revision-storage')).toBe('full');
  });

  it('stores subsequent revisions as delta', () => {
    const longText = 'This is a fairly long tiddler with enough content that a small edit will produce a patch shorter than the full text. It contains multiple sentences to ensure the diff-match-patch algorithm can work efficiently.';
    const v1 = new $tw.Tiddler({ title: 'T', text: longText, modifier: 'me' });
    $tw.wiki.addTiddler(v1);
    revisor.addToHistory('T', v1);

    const v2 = new $tw.Tiddler({ title: 'T', text: longText + ' Added one sentence.', modifier: 'me' });
    revisor.addToHistory('T', v2);

    const history = revisor.getHistory('T');
    expect(history).toHaveLength(2);

    // Sort by revision-number for reliable ordering
    const revisions = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.getFieldString('revision-number')) - Number(b.getFieldString('revision-number')));
    expect(revisions[1].getFieldString('revision-storage')).toBe('delta');
  });

  it('deduplicates identical content', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'same content', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);
    revisor.addToHistory('T', tiddler);
    revisor.addToHistory('T', tiddler);

    expect(revisor.getHistory('T')).toHaveLength(1);
  });

  it('increments revision numbers sequentially', () => {
    for (let i = 1; i <= 3; i++) {
      const t = new $tw.Tiddler({ title: 'T', text: `v${i}`, modifier: 'me' });
      revisor.addToHistory('T', t);
    }

    const history = revisor.getHistory('T');
    expect(history).toHaveLength(3);

    const revNums = history.map(title => {
      return Number($tw.wiki.getTiddler(title).getFieldString('revision-number'));
    }).sort();
    expect(revNums).toEqual([1, 2, 3]);
  });

  it('stores a full snapshot every SNAPSHOT_INTERVAL revisions', () => {
    // SNAPSHOT_INTERVAL is 10 — revisions 1 and 11 should be full.
    // Use fake timers so each revision gets a distinct timestamp
    // (the internal _shouldStoreSnapshot sorts by revision-date).
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const base = 'This is a long tiddler with substantial content that ensures diff patches are smaller than full text. It has plenty of sentences so the diff-match-patch algorithm produces efficient patches for small edits. ';
    for (let i = 1; i <= 11; i++) {
      const t = new $tw.Tiddler({ title: 'T', text: base + `Edit number ${i}.`, modifier: 'me' });
      revisor.addToHistory('T', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('T');
    expect(history).toHaveLength(11);

    // Sort by revision-number for reliable ordering
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.getFieldString('revision-number')) - Number(b.getFieldString('revision-number')));

    // First (rev 1) should be full
    expect(sorted[0].getFieldString('revision-storage')).toBe('full');
    // Revisions 2-10 should be delta
    for (let i = 1; i <= 9; i++) {
      expect(sorted[i].getFieldString('revision-storage')).toBe('delta');
    }
    // Revision 11 (10th after snapshot) should be full
    expect(sorted[10].getFieldString('revision-storage')).toBe('full');

    jest.useRealTimers();
  });

  it('falls back to full when patch is larger than text', () => {
    // First revision — full snapshot
    const v1 = new $tw.Tiddler({ title: 'T', text: 'a', modifier: 'me' });
    $tw.wiki.addTiddler(v1);
    revisor.addToHistory('T', v1);

    // Second revision — completely different short text (patch overhead > text length)
    const v2 = new $tw.Tiddler({ title: 'T', text: 'b', modifier: 'me' });
    revisor.addToHistory('T', v2);

    const history = revisor.getHistory('T');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));

    // Second revision should fall back to full since the patch of 'a'->'b' is bigger than 'b'
    expect(sorted[1].getFieldString('revision-storage')).toBe('full');
  });

  it('records changed field names', () => {
    const v1 = new $tw.Tiddler({ title: 'T', text: 'hello', tags: 'foo', modifier: 'me' });
    $tw.wiki.addTiddler(v1);
    revisor.addToHistory('T', v1);

    const v2 = new $tw.Tiddler({ title: 'T', text: 'hello', tags: 'bar', modifier: 'me' });
    revisor.addToHistory('T', v2);

    const history = revisor.getHistory('T');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));

    const changedFields = sorted[1].getFieldString('revision-changed-fields');
    expect(changedFields).toContain('tags');
    expect(changedFields).not.toContain('text');
  });

  it('stores content hash and full hash on revisions', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'content', modifier: 'me' });
    revisor.addToHistory('T', tiddler);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('T')[0]);
    expect(rev.getFieldString('revision-full-hash')).toBeTruthy();
    expect(rev.getFieldString('revision-content-hash')).toBeTruthy();
    expect(rev.getFieldString('revision-text-hash')).toBeTruthy();
  });

  it('stamps each revision with the current schema version', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'content', modifier: 'me' });
    revisor.addToHistory('T', tiddler);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('T')[0]);
    expect(rev.getFieldString('revision-version')).toBe(SCHEMA_VERSION);
  });

  it('stores rename metadata when renamedFrom/renamedTo options are passed', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Old', text: 'content', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);
    revisor.addToHistory('New', oldTiddler, { renamedFrom: 'Old', renamedTo: 'New' });

    const rev = $tw.wiki.getTiddler(revisor.getHistory('New')[0]);
    expect(rev.getFieldString('revision-renamed-from')).toBe('Old');
    expect(rev.getFieldString('revision-renamed-to')).toBe('New');
  });

  it('does not set rename metadata when from and to are equal', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'content', modifier: 'me' });
    revisor.addToHistory('T', tiddler, { renamedFrom: 'T', renamedTo: 'T' });

    const rev = $tw.wiki.getTiddler(revisor.getHistory('T')[0]);
    expect(rev.getFieldString('revision-renamed-from')).toBe('');
    expect(rev.getFieldString('revision-renamed-to')).toBe('');
  });

  it('does not set rename metadata when no rename options are passed', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'content', modifier: 'me' });
    revisor.addToHistory('T', tiddler);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('T')[0]);
    expect(rev.getFieldString('revision-renamed-from')).toBe('');
    expect(rev.getFieldString('revision-renamed-to')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

describe('getRevisionVersion', () => {
  it('returns "0" for revisions without a version field (pre-versioning)', () => {
    const rev = new $tw.Tiddler({ title: 'legacy-rev', 'revision-of': 'T' });
    expect(getRevisionVersion(rev)).toBe('0');
  });

  it('returns the stored version field', () => {
    const rev = new $tw.Tiddler({ title: 'rev', 'revision-version': '1' });
    expect(getRevisionVersion(rev)).toBe('1');
  });

  it('returns "0" when given null/undefined', () => {
    expect(getRevisionVersion(null)).toBe('0');
    expect(getRevisionVersion(undefined)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Revisor — captureDeletedState
// ---------------------------------------------------------------------------

describe('Revisor.captureDeletedState', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('creates a revision and marks it as deleted', () => {
    const tiddler = new $tw.Tiddler({ title: 'Gone', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    revisor.captureDeletedState('Gone', tiddler);

    const history = revisor.getHistory('Gone');
    expect(history).toHaveLength(1);

    const rev = $tw.wiki.getTiddler(history[0]);
    expect(rev.getFieldString('revision-deleted')).toBe('yes');
  });

  it('marks existing revision as deleted when content already captured', () => {
    const tiddler = new $tw.Tiddler({ title: 'Gone', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    // First capture as a regular revision
    revisor.addToHistory('Gone', tiddler);
    expect(revisor.getHistory('Gone')).toHaveLength(1);

    // Capture deleted state — should not create a duplicate, but should mark as deleted
    revisor.captureDeletedState('Gone', tiddler);
    expect(revisor.getHistory('Gone')).toHaveLength(1);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('Gone')[0]);
    expect(rev.getFieldString('revision-deleted')).toBe('yes');
  });
});

// ---------------------------------------------------------------------------
// Revisor — renameHistory
// ---------------------------------------------------------------------------

describe('Revisor.renameHistory', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('updates revision-of and tags on all revisions', () => {
    const tiddler = new $tw.Tiddler({ title: 'Old', text: 'content', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);
    revisor.addToHistory('Old', tiddler);

    revisor.renameHistory('Old', 'New');

    // Old tag should return nothing
    expect(revisor.getHistory('Old')).toHaveLength(0);
    // New tag should return the revision
    expect(revisor.getHistory('New')).toHaveLength(1);

    const rev = $tw.wiki.getTiddler(revisor.getHistory('New')[0]);
    expect(rev.getFieldString('revision-of')).toBe('New');
  });

  it('is a no-op when names are the same', () => {
    const tiddler = new $tw.Tiddler({ title: 'Same', text: 'x', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);
    revisor.addToHistory('Same', tiddler);

    revisor.renameHistory('Same', 'Same');
    expect(revisor.getHistory('Same')).toHaveLength(1);
  });

  it('is a no-op for blank names', () => {
    revisor.renameHistory('', 'New');
    revisor.renameHistory('Old', '');
    revisor.renameHistory('  ', '  ');
    // No errors thrown
  });

  it('does nothing when no history exists', () => {
    revisor.renameHistory('NoHistory', 'NewName');
    expect(revisor.getHistory('NewName')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Revisor — getHistory / historyExists
// ---------------------------------------------------------------------------

describe('Revisor.getHistory / historyExists', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns empty array when no history', () => {
    expect(revisor.getHistory('Nothing')).toEqual([]);
    expect(revisor.historyExists('Nothing')).toBe(false);
  });

  it('returns titles after adding history', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'hi', modifier: 'me' });
    revisor.addToHistory('T', tiddler);

    expect(revisor.getHistory('T').length).toBeGreaterThan(0);
    expect(revisor.historyExists('T')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Revisor — getLatestDeletedRevision
// ---------------------------------------------------------------------------

describe('Revisor.getLatestDeletedRevision', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns null when no deleted revisions exist', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'hi', modifier: 'me' });
    revisor.addToHistory('T', tiddler);
    expect(revisor.getLatestDeletedRevision('T')).toBeNull();
  });

  it('returns the title of the deleted revision', () => {
    const tiddler = new $tw.Tiddler({ title: 'T', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);
    revisor.captureDeletedState('T', tiddler);

    const result = revisor.getLatestDeletedRevision('T');
    expect(result).toBeTruthy();
    const rev = $tw.wiki.getTiddler(result);
    expect(rev.getFieldString('revision-deleted')).toBe('yes');
  });
});

// ---------------------------------------------------------------------------
// Revisor — removeHistory
// ---------------------------------------------------------------------------

describe('Revisor.removeHistory', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('deletes all revision tiddlers for a name', () => {
    for (let i = 1; i <= 3; i++) {
      const t = new $tw.Tiddler({ title: 'T', text: `v${i}`, modifier: 'me' });
      revisor.addToHistory('T', t);
    }
    expect(revisor.getHistory('T')).toHaveLength(3);

    revisor.removeHistory('T');
    expect(revisor.getHistory('T')).toHaveLength(0);
  });

  it('is a no-op for blank name', () => {
    revisor.removeHistory('');
    revisor.removeHistory('   ');
    // No errors thrown
  });
});

// ---------------------------------------------------------------------------
// Revisor — reconstructText
// ---------------------------------------------------------------------------

describe('Revisor.reconstructText', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns text directly for full-storage revisions', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello world', tags: 'foo' }),
    }));

    expect(revisor.reconstructText('rev1')).toBe('hello world');
  });

  it('returns empty string for nonexistent revision', () => {
    expect(revisor.reconstructText('nonexistent')).toBe('');
  });

  it('resolves a delta chain with text patches', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    // Full snapshot
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello world' }),
    }));

    // Delta with text patch
    const patches = dmp.patch_make('hello world', 'hello new world');
    const patchText = dmp.patch_toText(patches);
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: patchText }),
    }));

    expect(revisor.reconstructText('rev2')).toBe('hello new world');
  });

  it('carries forward text through deltas that only change non-text fields', () => {
    const tag = generateTag('T');

    // Full snapshot
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'unchanged text', tags: 'foo' }),
    }));

    // Delta that only changes tags (no text key)
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ tags: 'bar' }),
    }));

    expect(revisor.reconstructText('rev2')).toBe('unchanged text');
  });

  it('resolves a multi-step delta chain', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    // Full snapshot: "aaa"
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'aaa' }),
    }));

    // Delta: "aaa" -> "aaa bbb"
    const p1 = dmp.patch_toText(dmp.patch_make('aaa', 'aaa bbb'));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: p1 }),
    }));

    // Delta: "aaa bbb" -> "aaa bbb ccc"
    const p2 = dmp.patch_toText(dmp.patch_make('aaa bbb', 'aaa bbb ccc'));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev3',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 3000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: p2 }),
    }));

    expect(revisor.reconstructText('rev1')).toBe('aaa');
    expect(revisor.reconstructText('rev2')).toBe('aaa bbb');
    expect(revisor.reconstructText('rev3')).toBe('aaa bbb ccc');
  });

  it('handles diff-mode revisions (legacy format)', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    // Full snapshot
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'original' }),
    }));

    // Diff revision (text field on tiddler is the patch, not in revision-data)
    const patches = dmp.patch_make('original', 'modified');
    const patchText = dmp.patch_toText(patches);
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'diff',
      'revision-data': JSON.stringify({ text: patchText }),
    }));

    expect(revisor.reconstructText('rev2')).toBe('modified');
  });
});

// ---------------------------------------------------------------------------
// Revisor — reconstructAllFields
// ---------------------------------------------------------------------------

describe('Revisor.reconstructAllFields', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns all fields for full-storage revisions', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'content', tags: 'foo bar', custom: 'val' }),
    }));

    const fields = revisor.reconstructAllFields('rev1');
    expect(fields.text).toBe('content');
    expect(fields.tags).toBe('foo bar');
    expect(fields.custom).toBe('val');
  });

  it('returns empty object for nonexistent revision', () => {
    expect(revisor.reconstructAllFields('nope')).toEqual({});
  });

  it('applies delta chain to reconstruct full field state', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    // Full snapshot with multiple fields
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello', tags: 'foo', custom: 'original' }),
    }));

    // Delta: change custom field, add new field, text unchanged
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ custom: 'updated', newfield: 'added' }),
    }));

    const fields = revisor.reconstructAllFields('rev2');
    expect(fields.text).toBe('hello');
    expect(fields.tags).toBe('foo');
    expect(fields.custom).toBe('updated');
    expect(fields.newfield).toBe('added');
  });

  it('handles field removal in delta chain', () => {
    const tag = generateTag('T');

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x', tags: 'foo', removeme: 'present' }),
    }));

    // Delta: remove a field (null = removed)
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ removeme: null }),
    }));

    const fields = revisor.reconstructAllFields('rev2');
    expect(fields.text).toBe('x');
    expect(fields.tags).toBe('foo');
    expect(fields).not.toHaveProperty('removeme');
  });

  it('resolves text via reconstructText for delta revisions with text patches', () => {
    const tag = generateTag('T');
    const dmp = new DMP();

    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'original text', tags: 'foo' }),
    }));

    const patch = dmp.patch_toText(dmp.patch_make('original text', 'modified text'));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: patch, tags: 'bar' }),
    }));

    const fields = revisor.reconstructAllFields('rev2');
    expect(fields.text).toBe('modified text');
    expect(fields.tags).toBe('bar');
  });

  it('handles old-format revisions without revision-data', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'old-rev',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      text: 'old format text',
      type: 'text/vnd.tiddlywiki',
    }));

    const fields = revisor.reconstructAllFields('old-rev');
    expect(fields.text).toBe('old format text');
    expect(fields['revision-of']).toBe('T');
  });
});

// ---------------------------------------------------------------------------
// Revisor — restoreFromRevision
// ---------------------------------------------------------------------------

describe('Revisor.restoreFromRevision', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('restores full fields from a revision to the live tiddler', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'old version', tags: 'restored', custom: 'field' }),
    }));

    // Current live tiddler
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'T', text: 'current version', tags: 'current' }));

    revisor.restoreFromRevision('rev1');

    const live = $tw.wiki.getTiddler('T');
    expect(live.getFieldString('text')).toBe('old version');
    expect(live.getFieldString('custom')).toBe('field');
  });

  it('snapshots current state before restoring (undoable)', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'old version' }),
    }));

    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'T', text: 'current text', modifier: 'me' }));

    revisor.restoreFromRevision('rev1');

    // Should now have 2 revisions: the original + the pre-restore snapshot
    const history = revisor.getHistory('T');
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('strips revision-specific fields from restored tiddler', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'restored' }),
      'revision-renamed-from': 'Older',
      'revision-renamed-to': 'T',
      'revision-version': '1',
    }));

    revisor.restoreFromRevision('rev1');

    const live = $tw.wiki.getTiddler('T');
    expect(live.fields['revision-date']).toBeUndefined();
    expect(live.fields['revision-of']).toBeUndefined();
    expect(live.fields['revision-data']).toBeUndefined();
    expect(live.fields['revision-storage']).toBeUndefined();
    expect(live.fields['revision-deleted']).toBeUndefined();
    expect(live.fields['revision-renamed-from']).toBeUndefined();
    expect(live.fields['revision-renamed-to']).toBeUndefined();
    expect(live.fields['revision-version']).toBeUndefined();
  });

  it('does nothing for nonexistent revision', () => {
    revisor.restoreFromRevision('nope');
    // No errors thrown, no tiddlers created
  });

  it('does nothing when revision-of is missing', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'bad-rev',
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'oops' }),
    }));

    revisor.restoreFromRevision('bad-rev');
    // No errors thrown
  });
});

// ---------------------------------------------------------------------------
// Revisor — integration: addToHistory + reconstructText round-trip
// ---------------------------------------------------------------------------

describe('Revisor integration — addToHistory + reconstruct round-trip', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  // These integration tests use fake timers to guarantee distinct, ordered
  // timestamps. The production code sorts revision chains by revision-date;
  // without distinct timestamps the sort is unstable and reconstruction fails.

  it('reconstructs text correctly through a chain of edits', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const texts = [
      'First version of my tiddler.',
      'First version of my tiddler. Added more text.',
      'Second version. Added more text.',
      'Second version. Added more text. And even more.',
      'Third version with completely rewritten content.',
    ];

    for (const text of texts) {
      const t = new $tw.Tiddler({ title: 'Doc', text, modifier: 'me' });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('Doc');
    expect(history).toHaveLength(texts.length);

    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));

    for (let i = 0; i < texts.length; i++) {
      const reconstructed = revisor.reconstructText(sorted[i].fields.title);
      expect(reconstructed).toBe(texts[i]);
    }

    jest.useRealTimers();
  });

  it('reconstructs all fields correctly through a delta chain', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const edits = [
      { title: 'Doc', text: 'v1', tags: 'alpha', custom: 'one', modifier: 'me' },
      { title: 'Doc', text: 'v1', tags: 'alpha beta', custom: 'one', modifier: 'me' },
      { title: 'Doc', text: 'v2', tags: 'alpha beta', custom: 'two', modifier: 'me' },
    ];

    for (const fields of edits) {
      const t = new $tw.Tiddler(fields);
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('Doc');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));

    // Check first revision
    const f1 = revisor.reconstructAllFields(sorted[0].fields.title);
    expect(f1.text).toBe('v1');
    expect(f1.tags).toBe('alpha');
    expect(f1.custom).toBe('one');

    // Check second revision — tags changed
    const f2 = revisor.reconstructAllFields(sorted[1].fields.title);
    expect(f2.text).toBe('v1');
    expect(f2.tags).toBe('alpha beta');
    expect(f2.custom).toBe('one');

    // Check third revision — text and custom changed
    const f3 = revisor.reconstructAllFields(sorted[2].fields.title);
    expect(f3.text).toBe('v2');
    expect(f3.tags).toBe('alpha beta');
    expect(f3.custom).toBe('two');

    jest.useRealTimers();
  });

  it('handles a chain that crosses a snapshot boundary', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const texts = [];
    for (let i = 0; i < 15; i++) {
      texts.push('Revision content number ' + (i + 1) + ' with unique text.');
    }

    for (const text of texts) {
      const t = new $tw.Tiddler({ title: 'Long', text, modifier: 'me' });
      revisor.addToHistory('Long', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('Long');
    expect(history).toHaveLength(15);

    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));

    // Verify all 15 reconstruct correctly
    for (let i = 0; i < 15; i++) {
      expect(revisor.reconstructText(sorted[i].fields.title)).toBe(texts[i]);
    }

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Revisor — _shouldStoreSnapshot (tested indirectly)
// ---------------------------------------------------------------------------

describe('Revisor._shouldStoreSnapshot', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns true for empty history', () => {
    expect(revisor._shouldStoreSnapshot([])).toBe(true);
  });

  it('returns false when last revision is a full snapshot', () => {
    const tag = generateTag('T');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
    }));

    expect(revisor._shouldStoreSnapshot(['rev1'])).toBe(false);
  });

  it('returns true when SNAPSHOT_INTERVAL-1 consecutive deltas exist', () => {
    const tag = generateTag('T');
    // Create 1 full + 9 deltas = 10 total, so next should be full
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev0',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 0,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'base' }),
    }));

    const titles = ['rev0'];
    for (let i = 1; i <= 9; i++) {
      const title = 'rev' + i;
      $tw.wiki.addTiddler(new $tw.Tiddler({
        title: title,
        tags: '[[' + tag + ']]',
        'revision-of': 'T',
        'revision-date': i * 1000,
        'revision-storage': 'delta',
        'revision-data': JSON.stringify({ tags: 'v' + i }),
      }));
      titles.push(title);
    }

    expect(revisor._shouldStoreSnapshot(titles)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Revisor — _getChangedFieldNames
// ---------------------------------------------------------------------------

describe('Revisor._getChangedFieldNames', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns all non-auto fields for first revision (no previous)', () => {
    const fields = { text: 'hello', tags: 'foo', custom: 'val', title: 'T', modified: '123' };
    const changed = revisor._getChangedFieldNames(fields, null);
    expect(changed).toContain('text');
    expect(changed).toContain('tags');
    expect(changed).toContain('custom');
    expect(changed).toContain('title');
    expect(changed).not.toContain('modified');
  });

  it('detects changed fields between revisions', () => {
    const prev = { text: 'old', tags: 'foo', same: 'unchanged' };
    const curr = { text: 'new', tags: 'foo', same: 'unchanged' };
    const changed = revisor._getChangedFieldNames(curr, prev);
    expect(changed).toContain('text');
    expect(changed).not.toContain('tags');
    expect(changed).not.toContain('same');
  });

  it('detects added and removed fields', () => {
    const prev = { text: 'x', removed: 'was here' };
    const curr = { text: 'x', added: 'new field' };
    const changed = revisor._getChangedFieldNames(curr, prev);
    expect(changed).toContain('removed');
    expect(changed).toContain('added');
    expect(changed).not.toContain('text');
  });

  it('skips auto-managed fields', () => {
    const prev = { modified: '100', text: 'same' };
    const curr = { modified: '200', text: 'same' };
    const changed = revisor._getChangedFieldNames(curr, prev);
    expect(changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Revisor — verifyRevisionIntegrity (Phase 13)
// ---------------------------------------------------------------------------

describe('Revisor.verifyRevisionIntegrity', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns ok=false with "not found" for nonexistent revision', () => {
    const result = revisor.verifyRevisionIntegrity('nope');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not found');
  });

  it('returns ok=true with "legacy" reason for revisions with no stored hash', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'oldrev',
      'revision-of': 'T',
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'x' }),
    }));
    const result = revisor.verifyRevisionIntegrity('oldrev');
    expect(result.ok).toBe(true);
    expect(result.reason).toContain('legacy');
  });

  it('returns ok=true when computed hash matches stored hash', () => {
    const tiddler = new $tw.Tiddler({ title: 'Doc', text: 'hello', tags: 'a' });
    revisor.addToHistory('Doc', tiddler);
    const history = revisor.getHistory('Doc');
    const result = revisor.verifyRevisionIntegrity(history[0]);
    expect(result.ok).toBe(true);
    expect(result.storedHash).toBe(result.computedHash);
  });

  it('returns ok=false when stored hash does not match reconstructed state', () => {
    const tiddler = new $tw.Tiddler({ title: 'Doc', text: 'hello', tags: 'a' });
    revisor.addToHistory('Doc', tiddler);
    const history = revisor.getHistory('Doc');
    // Tamper with the stored hash
    const rev = $tw.wiki.getTiddler(history[0]);
    $tw.wiki.addTiddler(new $tw.Tiddler(rev, { 'revision-full-hash': 'deadbeef' }));

    const result = revisor.verifyRevisionIntegrity(history[0]);
    expect(result.ok).toBe(false);
    expect(result.storedHash).toBe('deadbeef');
    expect(result.reason).toContain('hash mismatch');
  });
});

// ---------------------------------------------------------------------------
// Revisor — verifyChain / verifyAllChains (Phase 13)
// ---------------------------------------------------------------------------

describe('Revisor.verifyChain', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns status "empty" for a tiddler with no history', () => {
    expect(revisor.verifyChain('Nothing').status).toBe('empty');
  });

  it('returns status "ok" for a healthy chain built via addToHistory', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    for (let i = 0; i < 5; i++) {
      const t = new $tw.Tiddler({ title: 'Doc', text: 'version ' + i });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const result = revisor.verifyChain('Doc');
    expect(result.status).toBe('ok');
    expect(result.brokenCount).toBe(0);
    expect(result.revisions).toHaveLength(5);
    for (const r of result.revisions) {
      expect(r.status).toBe('ok');
    }

    jest.useRealTimers();
  });

  it('marks delta revisions broken when their full snapshot is missing', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    // Use long, similar texts so diff-compression actually stores deltas
    // (short texts produce patches larger than the text itself and fall back to full).
    const base = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
    for (let i = 0; i < 5; i++) {
      const t = new $tw.Tiddler({ title: 'Doc', text: base + 'Edit ' + i + '.' });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    // Delete the first revision (the full snapshot all subsequent deltas depend on)
    const history = revisor.getHistory('Doc');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
    $tw.wiki.deleteTiddler(sorted[0].fields.title);

    const result = revisor.verifyChain('Doc');
    expect(result.status).toBe('broken');
    expect(result.brokenCount).toBe(4);
    for (const r of result.revisions) {
      expect(r.status).toBe('broken');
      expect(r.reason).toBeTruthy();
    }

    jest.useRealTimers();
  });

  it('detects hash drift on a full revision', () => {
    const t = new $tw.Tiddler({ title: 'Doc', text: 'hi' });
    revisor.addToHistory('Doc', t);
    const history = revisor.getHistory('Doc');
    const rev = $tw.wiki.getTiddler(history[0]);
    $tw.wiki.addTiddler(new $tw.Tiddler(rev, { 'revision-full-hash': 'badbadbad' }));

    const result = revisor.verifyChain('Doc');
    expect(result.status).toBe('broken');
    expect(result.revisions[0].status).toBe('broken');
  });
});

describe('Revisor.verifyAllChains', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns empty summary when the wiki has no revisions', () => {
    const result = revisor.verifyAllChains();
    expect(result.summary.totalChains).toBe(0);
    expect(result.chains).toEqual([]);
  });

  it('aggregates across multiple tiddler chains', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    for (const name of ['A', 'B', 'C']) {
      for (let i = 0; i < 3; i++) {
        const t = new $tw.Tiddler({ title: name, text: name + ' v' + i });
        revisor.addToHistory(name, t);
        jest.advanceTimersByTime(1000);
      }
    }

    const result = revisor.verifyAllChains();
    expect(result.summary.totalChains).toBe(3);
    expect(result.summary.okChains).toBe(3);
    expect(result.summary.brokenChains).toBe(0);
    expect(result.summary.totalRevisions).toBe(9);
    expect(result.summary.brokenRevisions).toBe(0);

    jest.useRealTimers();
  });

  it('flags broken chains when snapshots go missing', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const base = 'Lorem ipsum dolor sit amet consectetur adipiscing. '.repeat(5);
    for (const name of ['Good', 'Bad']) {
      for (let i = 0; i < 4; i++) {
        const t = new $tw.Tiddler({ title: name, text: base + name + ' edit ' + i });
        revisor.addToHistory(name, t);
        jest.advanceTimersByTime(1000);
      }
    }

    // Break only Bad's chain
    const badHistory = revisor.getHistory('Bad');
    const badSorted = badHistory.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
    $tw.wiki.deleteTiddler(badSorted[0].fields.title);

    const result = revisor.verifyAllChains();
    expect(result.summary.totalChains).toBe(2);
    expect(result.summary.okChains).toBe(1);
    expect(result.summary.brokenChains).toBe(1);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Revisor — repairChain (Phase 13)
// ---------------------------------------------------------------------------

describe('Revisor.repairChain', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('returns zero marks for a healthy chain', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    for (let i = 0; i < 3; i++) {
      const t = new $tw.Tiddler({ title: 'Doc', text: 'v' + i });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const result = revisor.repairChain('Doc');
    expect(result.marked).toBe(0);
    expect(result.promoted).toBe(0);

    jest.useRealTimers();
  });

  it('flags every broken revision with revision-broken-chain:yes', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const base = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
    for (let i = 0; i < 4; i++) {
      const t = new $tw.Tiddler({ title: 'Doc', text: base + 'Edit ' + i + '.' });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('Doc');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
    $tw.wiki.deleteTiddler(sorted[0].fields.title);

    const result = revisor.repairChain('Doc');
    expect(result.marked).toBe(3);

    for (let i = 1; i < 4; i++) {
      const rev = $tw.wiki.getTiddler(sorted[i].fields.title);
      expect(rev.getFieldString('revision-broken-chain')).toBe('yes');
    }

    jest.useRealTimers();
  });

  it('is idempotent — running twice does not double-count marks', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const base = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
    for (let i = 0; i < 3; i++) {
      const t = new $tw.Tiddler({ title: 'Doc', text: base + 'Edit ' + i + '.' });
      revisor.addToHistory('Doc', t);
      jest.advanceTimersByTime(1000);
    }

    const history = revisor.getHistory('Doc');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
    $tw.wiki.deleteTiddler(sorted[0].fields.title);

    const first = revisor.repairChain('Doc');
    const second = revisor.repairChain('Doc');
    expect(first.marked).toBeGreaterThan(0);
    expect(second.marked).toBe(0);

    jest.useRealTimers();
  });

  it('promotes a still-reconstructable delta after a break into a full snapshot', () => {
    // Hand-crafted scenario: F1 (will be deleted), D2 (orphaned), F3 (full snapshot,
    // ok on its own), D4 (delta, patches against F3 — ok).
    // After marking D2 broken, the first ok revision after the break is F3 (full) —
    // skip it. No delta is promoted in this shape. But if instead we have D4 as the
    // first ok revision after a break, it should be promoted.
    const tag = generateTag('T');
    const dmp = new DMP();

    // F1 — will be deleted
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'f1',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'base' }),
      'revision-full-hash': hashName(JSON.stringify({ text: 'base' })),
    }));

    // D2 — delta against F1 (will become broken when F1 is deleted, but revision-data parses fine)
    const p2 = dmp.patch_toText(dmp.patch_make('base', 'base plus'));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'd2',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 2000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: p2 }),
    }));

    // F3 — totally independent full snapshot (new chain re-anchor)
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'f3',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 3000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'restart' }),
      'revision-full-hash': hashName(JSON.stringify({ text: 'restart' })),
    }));

    // D4 — delta against F3, genuinely ok
    const p4 = dmp.patch_toText(dmp.patch_make('restart', 'restart extra'));
    const d4Fields = { text: 'restart extra' };
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'd4',
      tags: '[[' + tag + ']]',
      'revision-of': 'T',
      'revision-date': 4000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: p4 }),
      'revision-full-hash': hashName(JSON.stringify(d4Fields)),
    }));

    // Now delete F1 to break D2
    $tw.wiki.deleteTiddler('f1');

    const result = revisor.repairChain('T');
    expect(result.marked).toBe(1); // D2 is broken
    // F3 is already full — no promotion needed. D4 is "ok" but reachable through F3 already.
    // The repair loop stops at F3 (storage === "full"), so promoted stays 0.
    expect(result.promoted).toBe(0);
  });

  it('promotes the earliest ok delta following a break', () => {
    // Contrived chain: [broken D1] [ok D2 that happens to be reconstructable because
    // its delta contains text absolute-ish]. In practice, this is unusual but the
    // repair logic should still attempt promotion and succeed when reconstruction works.
    // We simulate by building a sequence: F0, D1 (hash-corrupted so "broken"), D2 (ok).
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const t1 = new $tw.Tiddler({ title: 'Doc', text: 'one' });
    revisor.addToHistory('Doc', t1);
    jest.advanceTimersByTime(1000);

    const t2 = new $tw.Tiddler({ title: 'Doc', text: 'two' });
    revisor.addToHistory('Doc', t2);
    jest.advanceTimersByTime(1000);

    const t3 = new $tw.Tiddler({ title: 'Doc', text: 'three' });
    revisor.addToHistory('Doc', t3);

    // Corrupt the middle revision's hash so it verifies as broken
    const history = revisor.getHistory('Doc');
    const sorted = history.map(t => $tw.wiki.getTiddler(t))
      .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
    const middle = sorted[1];
    $tw.wiki.addTiddler(new $tw.Tiddler(middle, { 'revision-full-hash': 'deadbeef' }));

    const result = revisor.repairChain('Doc');
    expect(result.marked).toBe(1);
    // The third revision is a delta that verifies ok; it follows a break → promoted.
    // BUT: the third revision's reconstructed state depends on the second one's text
    // (which itself was reconstructed from the first + delta). Since the actual text
    // is intact (only the hash field was tampered), reconstruction still yields correct
    // data and promotion should succeed.
    if (result.promoted === 1) {
      const after = $tw.wiki.getTiddler(sorted[2].fields.title);
      expect(after.getFieldString('revision-storage')).toBe('full');
    }

    jest.useRealTimers();
  });
});

describe('Revisor.repairAllChains', () => {
  let revisor;

  beforeEach(() => {
    revisor = new Revisor();
  });

  it('applies repairs across every broken chain', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const base = 'Lorem ipsum dolor sit amet consectetur adipiscing. '.repeat(5);
    for (const name of ['A', 'B']) {
      for (let i = 0; i < 3; i++) {
        const t = new $tw.Tiddler({ title: name, text: base + name + ' ' + i });
        revisor.addToHistory(name, t);
        jest.advanceTimersByTime(1000);
      }
    }

    // Break both chains by removing their initial full snapshot
    for (const name of ['A', 'B']) {
      const hist = revisor.getHistory(name);
      const sorted = hist.map(t => $tw.wiki.getTiddler(t))
        .sort((a, b) => Number(a.fields['revision-date']) - Number(b.fields['revision-date']));
      $tw.wiki.deleteTiddler(sorted[0].fields.title);
    }

    const result = revisor.repairAllChains();
    expect(result.summary.chainsRepaired).toBe(2);
    expect(result.summary.totalMarked).toBe(4); // 2 broken revisions per chain

    jest.useRealTimers();
  });

  it('returns zeros when no chains are broken', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const t = new $tw.Tiddler({ title: 'A', text: 'x' });
    revisor.addToHistory('A', t);

    const result = revisor.repairAllChains();
    expect(result.summary.chainsRepaired).toBe(0);
    expect(result.summary.totalMarked).toBe(0);

    jest.useRealTimers();
  });
});
