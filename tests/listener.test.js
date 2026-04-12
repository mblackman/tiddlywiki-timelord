const { resetTw } = require('./mock-tw');
const { generateTag } = require('../plugins/mblackman/revision-history/src/revisor');

// listener.js registers hooks on $tw at startup() call time, so we
// re-require it fresh for each describe block via beforeEach.
let startup;

beforeEach(() => {
  resetTw($tw);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  // Clear the module cache so startup() registers fresh hooks each time
  jest.resetModules();
  // Re-require to get a fresh module with new Revisor instance
  ({ startup } = require('../plugins/mblackman/revision-history/src/listener'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

describe('startup()', () => {
  it('registers th-saving-tiddler and th-deleting-tiddler hooks', () => {
    startup();
    expect($tw.hooks._hooks['th-saving-tiddler']).toHaveLength(1);
    expect($tw.hooks._hooks['th-deleting-tiddler']).toHaveLength(1);
  });

  it('registers tm-restore-revision and tm-restore-deleted-tiddler event listeners', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-restore-revision']).toHaveLength(1);
    expect($tw.rootWidget._listeners['tm-restore-deleted-tiddler']).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// th-saving-tiddler hook
// ---------------------------------------------------------------------------

describe('th-saving-tiddler hook', () => {
  let savingHook;

  beforeEach(() => {
    startup();
    savingHook = $tw.hooks._hooks['th-saving-tiddler'][0];
  });

  it('returns newTiddler unchanged when draft is null (TW < 5.3.x guard)', () => {
    const newTiddler = new $tw.Tiddler({ title: 'Test', text: 'hello' });
    const result = savingHook(newTiddler, null);
    expect(result.fields.title).toBe('Test');
  });

  it('returns newTiddler when draft has no draft.of field', () => {
    const newTiddler = new $tw.Tiddler({ title: 'Test', text: 'hello' });
    const draft = new $tw.Tiddler({ title: 'Draft of Test' });
    const result = savingHook(newTiddler, draft);
    expect(result.fields.title).toBe('Test');
  });

  it('returns newTiddler when old tiddler does not exist in wiki', () => {
    const newTiddler = new $tw.Tiddler({ title: 'Test', text: 'hello' });
    const draft = new $tw.Tiddler({ title: 'Draft of Test', 'draft.of': 'Test' });
    const result = savingHook(newTiddler, draft);
    expect(result.fields.title).toBe('Test');
  });

  it('skips system tiddlers', () => {
    const oldTiddler = new $tw.Tiddler({ title: '$:/system', text: 'old' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: '$:/system', text: 'new' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': '$:/system' });

    const result = savingHook(newTiddler, draft);
    expect(result.fields.title).toBe('$:/system');
    // No revision should have been created
    expect($tw.wiki.store.size).toBe(1); // only the old tiddler
  });

  it('creates a revision when text changes', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old text', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new text', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft of Doc', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    // Should have the original tiddler + a revision tiddler
    const tag = generateTag('Doc');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a revision when tags change', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'same', tags: 'foo', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'same', tags: 'bar', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft of Doc', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
  });

  it('skips revision when only auto-managed fields change', () => {
    const oldTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'same', tags: 'foo', modifier: 'old-modifier',
    });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'same', tags: 'foo', modifier: 'new-modifier',
      modified: '20260411120000000',
    });
    const draft = new $tw.Tiddler({ title: 'Draft of Doc', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions).toHaveLength(0);
  });

  it('handles rename by calling renameHistory', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'OldName', text: 'content', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    // Create a revision under the old name first
    const tag = generateTag('OldName');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'existing-rev',
      tags: '[[' + tag + ']]',
      'revision-of': 'OldName',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'previous' }),
    }));

    const newTiddler = new $tw.Tiddler({ title: 'NewName', text: 'content changed', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'OldName' });

    savingHook(newTiddler, draft);

    // Old revision should now be tagged under the new name
    const newTag = generateTag('NewName');
    const revisions = $tw.wiki.getTiddlersWithTag(newTag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);

    // The existing revision's revision-of should be updated
    const existingRev = $tw.wiki.getTiddler('existing-rev');
    expect(existingRev.getFieldString('revision-of')).toBe('NewName');
  });

  it('stamps the new revision with rename metadata when a rename occurs', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'OldName', text: 'content', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'NewName', text: 'content changed', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'OldName' });

    savingHook(newTiddler, draft);

    const newTag = generateTag('NewName');
    const revisions = $tw.wiki.getTiddlersWithTag(newTag);
    // One of the new revisions should carry the rename markers
    const renameRev = revisions
      .map(t => $tw.wiki.getTiddler(t))
      .find(r => r.getFieldString('revision-renamed-from') === 'OldName');
    expect(renameRev).toBeTruthy();
    expect(renameRev.getFieldString('revision-renamed-to')).toBe('NewName');
  });

  it('does not stamp rename metadata when title is unchanged', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    for (const t of revisions) {
      const rev = $tw.wiki.getTiddler(t);
      expect(rev.getFieldString('revision-renamed-from')).toBe('');
    }
  });

  it('respects the global enabled toggle', () => {
    // Disable tracking
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/revision-history/enabled',
      text: 'no',
    }));

    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);
  });

  it('adds revision-tag to the returned tiddler', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    const result = savingHook(newTiddler, draft);
    expect(result.getFieldString('revision-tag')).toBe(generateTag('Doc'));
  });

  it('respects exclude filter', () => {
    // Set up the exclude filter to return 'Doc' when evaluated
    // We need to override filterTiddlers for this test
    const origFilter = $tw.wiki.filterTiddlers;
    $tw.wiki.filterTiddlers = (filter) => ['Doc'];
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/revision-history/exclude-filter',
      text: '[tag[excluded]]',
    }));

    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);

    // Restore
    $tw.wiki.filterTiddlers = origFilter;
  });
});

// ---------------------------------------------------------------------------
// th-deleting-tiddler hook
// ---------------------------------------------------------------------------

describe('th-deleting-tiddler hook', () => {
  let deletingHook;

  beforeEach(() => {
    startup();
    deletingHook = $tw.hooks._hooks['th-deleting-tiddler'][0];
  });

  it('captures deleted state for regular tiddlers', () => {
    const tiddler = new $tw.Tiddler({ title: 'Goodbye', text: 'farewell', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    deletingHook(tiddler);

    const tag = generateTag('Goodbye');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);

    // At least one revision should be marked deleted
    const hasDeleted = revisions.some(t => {
      const rev = $tw.wiki.getTiddler(t);
      return rev && rev.getFieldString('revision-deleted') === 'yes';
    });
    expect(hasDeleted).toBe(true);
  });

  it('skips system tiddlers', () => {
    const tiddler = new $tw.Tiddler({ title: '$:/config/something', text: 'sys' });
    const result = deletingHook(tiddler);
    expect(result.fields.title).toBe('$:/config/something');
    // No revisions created (only the config tiddler existed)
  });

  it('returns the tiddler unchanged when disabled', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/revision-history/enabled',
      text: 'no',
    }));

    const tiddler = new $tw.Tiddler({ title: 'Doc', text: 'content', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    const result = deletingHook(tiddler);
    expect(result.fields.title).toBe('Doc');

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);
  });

  it('returns tiddler when input is null', () => {
    const result = deletingHook(null);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

describe('tm-restore-revision event', () => {
  it('restores a revision when given a valid revisionTitle', () => {
    startup();

    const tag = generateTag('Doc');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'rev1',
      tags: '[[' + tag + ']]',
      'revision-of': 'Doc',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'restored content', tags: 'restored' }),
    }));

    const listener = $tw.rootWidget._listeners['tm-restore-revision'][0];
    listener({ paramObject: { revisionTitle: 'rev1' } });

    const live = $tw.wiki.getTiddler('Doc');
    expect(live).toBeTruthy();
    expect(live.getFieldString('text')).toBe('restored content');
  });

  it('does nothing when paramObject is missing', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-restore-revision'][0];
    listener({}); // No error
    listener({ paramObject: {} }); // No error
  });
});

describe('tm-restore-deleted-tiddler event', () => {
  it('restores the latest deleted revision', () => {
    startup();

    const tag = generateTag('Deleted');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: 'del-rev',
      tags: '[[' + tag + ']]',
      'revision-of': 'Deleted',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'was deleted' }),
      'revision-deleted': 'yes',
    }));

    const listener = $tw.rootWidget._listeners['tm-restore-deleted-tiddler'][0];
    listener({ paramObject: { tiddlerName: 'Deleted' } });

    const live = $tw.wiki.getTiddler('Deleted');
    expect(live).toBeTruthy();
    expect(live.getFieldString('text')).toBe('was deleted');
  });

  it('does nothing when no deleted revision exists', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-restore-deleted-tiddler'][0];
    listener({ paramObject: { tiddlerName: 'NeverExisted' } });
    expect($tw.wiki.getTiddler('NeverExisted')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verify / repair events (Phase 13)
// ---------------------------------------------------------------------------

describe('tm-verify-revision-chains event', () => {
  it('registers an event listener', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-verify-revision-chains']).toHaveLength(1);
  });

  it('writes a report tiddler with summary fields', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-verify-revision-chains'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/revision-history/verify-report');
    expect(report).toBeTruthy();
    expect(report.getFieldString('total-chains')).toBe('0');
    expect(report.getFieldString('broken-chains')).toBe('0');
    expect(report.getFieldString('text')).toContain('All chains verified OK');
  });

  it('lists broken chains in the report', () => {
    startup();

    // verifyAllChains discovers chains by scanning tiddler titles that start with
    // the plugin's revisions baseName, so use a realistic title here.
    const tag = generateTag('Bad');
    const revTitle = '$:/plugins/mblackman/revision-history/revisions/badhash/1000-0';
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: revTitle,
      tags: '[[' + tag + ']]',
      'revision-of': 'Bad',
      'revision-date': 1000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: 'fake patch' }),
    }));

    const listener = $tw.rootWidget._listeners['tm-verify-revision-chains'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/revision-history/verify-report');
    expect(report.getFieldString('broken-chains')).toBe('1');
    expect(report.getFieldString('text')).toContain('Bad');
    expect(report.getFieldString('text')).toContain('no preceding full snapshot');
  });
});

describe('tm-repair-revision-chains event', () => {
  it('registers an event listener', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-repair-revision-chains']).toHaveLength(1);
  });

  it('marks broken revisions and writes a summary report', () => {
    startup();

    const tag = generateTag('Bad');
    const revTitle = '$:/plugins/mblackman/revision-history/revisions/badhash/1000-0';
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: revTitle,
      tags: '[[' + tag + ']]',
      'revision-of': 'Bad',
      'revision-date': 1000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: 'fake patch' }),
    }));

    const listener = $tw.rootWidget._listeners['tm-repair-revision-chains'][0];
    listener({});

    const rev = $tw.wiki.getTiddler(revTitle);
    expect(rev.getFieldString('revision-broken-chain')).toBe('yes');

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/revision-history/verify-report');
    expect(report.getFieldString('marked')).toBe('1');
    expect(report.getFieldString('chains-repaired')).toBe('1');
  });
});
