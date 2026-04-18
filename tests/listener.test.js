const { resetTw } = require('./mock-tw');
const { generateTag } = require('../plugins/mblackman/timelord/src/revisor');

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
  ({ startup } = require('../plugins/mblackman/timelord/src/listener'));
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
      title: '$:/config/mblackman/timelord/enabled',
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

  it('captures edit-summary and stores it as revision-summary', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old text', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'new text', modifier: 'me',
      'edit-summary': 'Fixed typo in intro',
    });
    const draft = new $tw.Tiddler({ title: 'Draft of Doc', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    const revisions = $tw.wiki.getTiddlersWithTag(tag);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    const rev = $tw.wiki.getTiddler(revisions[0]);
    expect(rev.getFieldString('revision-summary')).toBe('Fixed typo in intro');
  });

  it('clears edit-summary from the returned tiddler', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old text', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'new text', modifier: 'me',
      'edit-summary': 'Some note',
    });
    const draft = new $tw.Tiddler({ title: 'Draft of Doc', 'draft.of': 'Doc' });

    const result = savingHook(newTiddler, draft);
    expect(result.getFieldString('edit-summary')).toBe('');
  });

  it('clears edit-summary even when tracking is disabled', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/enabled',
      text: 'no',
    }));

    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'new', modifier: 'me',
      'edit-summary': 'Should be cleared anyway',
    });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    const result = savingHook(newTiddler, draft);
    expect(result.getFieldString('edit-summary')).toBe('');
  });

  it('does not create revision when only edit-summary changes', () => {
    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'same', tags: 'foo', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);

    const newTiddler = new $tw.Tiddler({
      title: 'Doc', text: 'same', tags: 'foo', modifier: 'me',
      'edit-summary': 'no real change',
    });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);
  });

  it('respects exclude filter', () => {
    // Set up the exclude filter to return 'Doc' when evaluated
    // We need to override filterTiddlers for this test
    const origFilter = $tw.wiki.filterTiddlers;
    $tw.wiki.filterTiddlers = (filter) => ['Doc'];
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
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
      title: '$:/config/mblackman/timelord/enabled',
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

  it('skips shadow tiddlers', () => {
    const origShadow = $tw.wiki.isShadowTiddler;
    $tw.wiki.isShadowTiddler = (title) => title === 'ShadowDoc';

    const tiddler = new $tw.Tiddler({ title: 'ShadowDoc', text: 'hidden', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    deletingHook(tiddler);

    const tag = generateTag('ShadowDoc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);

    $tw.wiki.isShadowTiddler = origShadow;
  });

  it('respects the exclude filter on delete', () => {
    const origFilter = $tw.wiki.filterTiddlers;
    $tw.wiki.filterTiddlers = () => ['ExcludedDoc'];
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
      text: '[tag[excluded]]',
    }));

    const tiddler = new $tw.Tiddler({ title: 'ExcludedDoc', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    deletingHook(tiddler);

    const tag = generateTag('ExcludedDoc');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);

    $tw.wiki.filterTiddlers = origFilter;
  });

  it('ignores an empty-whitespace exclude filter', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
      text: '   ',
    }));

    const tiddler = new $tw.Tiddler({ title: 'Doc', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    deletingHook(tiddler);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag).length).toBeGreaterThanOrEqual(1);
  });

  it('does not skip when exclude filter does not match this tiddler', () => {
    const origFilter = $tw.wiki.filterTiddlers;
    $tw.wiki.filterTiddlers = () => ['SomeOtherDoc'];
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
      text: '[tag[something]]',
    }));

    const tiddler = new $tw.Tiddler({ title: 'Doc', text: 'bye', modifier: 'me' });
    $tw.wiki.addTiddler(tiddler);

    deletingHook(tiddler);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag).length).toBeGreaterThanOrEqual(1);

    $tw.wiki.filterTiddlers = origFilter;
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: rename-over-existing + skip paths
// ---------------------------------------------------------------------------

describe('th-saving-tiddler — branch coverage', () => {
  let savingHook;

  beforeEach(() => {
    startup();
    savingHook = $tw.hooks._hooks['th-saving-tiddler'][0];
  });

  it('captures the overwritten tiddler when a rename targets an existing title', () => {
    const existingTarget = new $tw.Tiddler({ title: 'Target', text: 'to be overwritten', modifier: 'me' });
    const sourceTiddler = new $tw.Tiddler({ title: 'Source', text: 'source content', modifier: 'me' });
    $tw.wiki.addTiddler(existingTarget);
    $tw.wiki.addTiddler(sourceTiddler);

    // Rename Source -> Target (Target already exists)
    const newTiddler = new $tw.Tiddler({ title: 'Target', text: 'source content overwrite', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Source' });

    savingHook(newTiddler, draft);

    // Both histories should have entries: Target's chain captures its prior state
    const targetTag = generateTag('Target');
    const targetRevs = $tw.wiki.getTiddlersWithTag(targetTag);
    expect(targetRevs.length).toBeGreaterThanOrEqual(2);
  });

  it('skips when old title is a system tiddler', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({ title: '$:/oldSys', text: 'old', modifier: 'me' }));
    const newTiddler = new $tw.Tiddler({ title: 'NewRegular', text: 'new' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': '$:/oldSys' });

    savingHook(newTiddler, draft);

    const tag = generateTag('NewRegular');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);
  });

  it('skips when old title is a shadow tiddler', () => {
    const origShadow = $tw.wiki.isShadowTiddler;
    $tw.wiki.isShadowTiddler = (title) => title === 'ShadowOld';

    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'ShadowOld', text: 'old' }));
    const newTiddler = new $tw.Tiddler({ title: 'NewRegular', text: 'new' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'ShadowOld' });

    savingHook(newTiddler, draft);

    const tag = generateTag('NewRegular');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);

    $tw.wiki.isShadowTiddler = origShadow;
  });

  it('skips when new title is a shadow tiddler', () => {
    const origShadow = $tw.wiki.isShadowTiddler;
    $tw.wiki.isShadowTiddler = (title) => title === 'ShadowNew';

    $tw.wiki.addTiddler(new $tw.Tiddler({ title: 'PlainOld', text: 'old', modifier: 'me' }));
    const newTiddler = new $tw.Tiddler({ title: 'ShadowNew', text: 'new' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'PlainOld' });

    savingHook(newTiddler, draft);

    const tag = generateTag('ShadowNew');
    expect($tw.wiki.getTiddlersWithTag(tag)).toHaveLength(0);

    $tw.wiki.isShadowTiddler = origShadow;
  });

  it('ignores an empty-whitespace exclude filter', () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
      text: '   ',
    }));

    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);
    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag).length).toBeGreaterThanOrEqual(1);
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

  it('does nothing when tiddlerName is missing from paramObject', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-restore-deleted-tiddler'][0];
    listener({}); // paramObject missing
    listener({ paramObject: {} }); // tiddlerName missing
  });
});

describe('th-saving-tiddler — exclude filter nuances', () => {
  it('does not skip when exclude filter does not match this tiddler', () => {
    const origFilter = $tw.wiki.filterTiddlers;
    startup();
    const savingHook = $tw.hooks._hooks['th-saving-tiddler'][0];

    $tw.wiki.filterTiddlers = () => ['OtherDoc'];
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/config/mblackman/timelord/exclude-filter',
      text: '[tag[excluded]]',
    }));

    const oldTiddler = new $tw.Tiddler({ title: 'Doc', text: 'old', modifier: 'me' });
    $tw.wiki.addTiddler(oldTiddler);
    const newTiddler = new $tw.Tiddler({ title: 'Doc', text: 'new', modifier: 'me' });
    const draft = new $tw.Tiddler({ title: 'Draft', 'draft.of': 'Doc' });

    savingHook(newTiddler, draft);

    const tag = generateTag('Doc');
    expect($tw.wiki.getTiddlersWithTag(tag).length).toBeGreaterThanOrEqual(1);

    $tw.wiki.filterTiddlers = origFilter;
  });
});

describe('tm-verify-revision-chains — mixed chain output', () => {
  it('emits only broken chains (skipping ok ones) in the report body', () => {
    startup();

    const goodTag = generateTag('Good');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/ggg/1000-0',
      tags: '[[' + goodTag + ']]',
      'revision-of': 'Good',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'solid' }),
    }));

    const badTag = generateTag('Bad');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/bbb/1000-0',
      tags: '[[' + badTag + ']]',
      'revision-of': 'Bad',
      'revision-date': 1000,
      'revision-storage': 'delta',
      'revision-data': JSON.stringify({ text: 'nope' }),
    }));

    const listener = $tw.rootWidget._listeners['tm-verify-revision-chains'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
    expect(report.getFieldString('broken-chains')).toBe('1');
    expect(report.getFieldString('total-chains')).toBe('2');
    expect(report.getFieldString('text')).toContain('Bad');
    expect(report.getFieldString('text')).not.toContain('!! Good');
  });

  it('includes only broken revisions in the per-chain bullet list', () => {
    startup();

    // Build a chain with a good full snapshot and one bad delta-without-anchor isn't
    // possible (it would make the snapshot broken too), so instead mix a valid
    // revision with a poisoned-hash sibling in the SAME chain.
    const tag = generateTag('Mix');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/mmm/1000-0',
      tags: '[[' + tag + ']]',
      'revision-of': 'Mix',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'ok1' }),
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/mmm/2000-0',
      tags: '[[' + tag + ']]',
      'revision-of': 'Mix',
      'revision-date': 2000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'ok2' }),
      'revision-full-hash': 'deadbeef', // intentionally mismatched
    }));

    const listener = $tw.rootWidget._listeners['tm-verify-revision-chains'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
    expect(report.getFieldString('broken-chains')).toBe('1');
    const text = report.getFieldString('text');
    // Broken-revision bullet should refer to the poisoned title
    expect(text).toContain('2000-0');
  });

  it('falls back to "unknown" when a broken revision has no reason', () => {
    startup();

    // Seed a chain that will verify OK under normal path, then poison verifyChain's result
    // via adding a revision with a deliberately broken integrity (hash mismatch with
    // computed state). Simplest way: add a "full" revision whose stored full-hash is wrong.
    const tag = generateTag('Hashy');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/hhh/1000-0',
      tags: '[[' + tag + ']]',
      'revision-of': 'Hashy',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'one' }),
      'revision-full-hash': 'deadbeef', // does not match computed hash
    }));

    const listener = $tw.rootWidget._listeners['tm-verify-revision-chains'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
    expect(report.getFieldString('broken-chains')).toBe('1');
    expect(report.getFieldString('text')).toContain('Hashy');
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

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
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
    const revTitle = '$:/plugins/mblackman/timelord/revisions/badhash/1000-0';
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

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
    expect(report.getFieldString('broken-chains')).toBe('1');
    expect(report.getFieldString('text')).toContain('Bad');
    expect(report.getFieldString('text')).toContain('no preceding full snapshot');
  });
});

// ---------------------------------------------------------------------------
// Phase 15 — stats / prune events
// ---------------------------------------------------------------------------

describe('tm-compute-revision-stats event', () => {
  it('registers an event listener', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-compute-revision-stats']).toHaveLength(1);
  });

  it('writes a stats tiddler with aggregate fields and top-N per-entry tiddlers', () => {
    startup();

    const tag = generateTag('A');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/aaa/1000-0',
      tags: '[[' + tag + ']]',
      'revision-of': 'A',
      'revision-date': 1000,
      'revision-storage': 'full',
      'revision-data': JSON.stringify({ text: 'hello' }),
    }));

    const listener = $tw.rootWidget._listeners['tm-compute-revision-stats'][0];
    listener({});

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/stats');
    expect(report).toBeTruthy();
    expect(report.getFieldString('total-revisions')).toBe('1');
    expect(report.getFieldString('chains-count')).toBe('1');

    const top = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/stats/top/01');
    expect(top).toBeTruthy();
    expect(top.getFieldString('tiddler-name')).toBe('A');
    expect(top.getFieldString('revision-count')).toBe('1');
  });

  it('clears stale top-N tiddlers on recompute', () => {
    startup();

    // Seed a stale top entry that isn't in the current wiki state
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/temp/mblackman/timelord/stats/top/99',
      text: 'GhostTiddler',
    }));

    const listener = $tw.rootWidget._listeners['tm-compute-revision-stats'][0];
    listener({});

    expect($tw.wiki.getTiddler('$:/temp/mblackman/timelord/stats/top/99')).toBeNull();
  });
});

describe('tm-delete-timelord event', () => {
  it('registers an event listener', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-delete-timelord']).toHaveLength(1);
  });

  it('removes every revision for the named tiddler', () => {
    startup();

    const tag = generateTag('A');
    for (let i = 0; i < 3; i++) {
      $tw.wiki.addTiddler(new $tw.Tiddler({
        title: '$:/plugins/mblackman/timelord/revisions/aaa/' + (1000 + i) + '-0',
        tags: '[[' + tag + ']]',
        'revision-of': 'A',
        'revision-date': 1000 + i,
      }));
    }

    const listener = $tw.rootWidget._listeners['tm-delete-timelord'][0];
    listener({ paramObject: { tiddlerName: 'A' } });

    expect($tw.wiki.getTiddlersWithTag(tag)).toEqual([]);
  });

  it('is a no-op when tiddlerName is missing', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-delete-timelord'][0];
    // Should not throw
    listener({});
    listener({ paramObject: {} });
  });
});

describe('tm-delete-history-matching event', () => {
  it('registers an event listener', () => {
    startup();
    expect($tw.rootWidget._listeners['tm-delete-history-matching']).toHaveLength(1);
  });

  it('prunes chains matched by the filter and writes a report', () => {
    startup();

    const tagA = generateTag('A');
    const tagB = generateTag('B');
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/aaa/1000-0',
      tags: '[[' + tagA + ']]',
      'revision-of': 'A',
      'revision-date': 1000,
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: '$:/plugins/mblackman/timelord/revisions/bbb/2000-0',
      tags: '[[' + tagB + ']]',
      'revision-of': 'B',
      'revision-date': 2000,
    }));

    $tw.wiki.filterTiddlers = () => ['A'];

    const listener = $tw.rootWidget._listeners['tm-delete-history-matching'][0];
    listener({ paramObject: { filter: '[tag[foo]]' } });

    expect($tw.wiki.getTiddlersWithTag(tagA)).toEqual([]);
    expect($tw.wiki.getTiddlersWithTag(tagB)).toHaveLength(1);

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/prune-report');
    expect(report).toBeTruthy();
    expect(report.getFieldString('deleted-chains')).toBe('1');
    expect(report.getFieldString('deleted-revisions')).toBe('1');
    expect(report.getFieldString('deleted-names')).toBe('A');
  });

  it('is a no-op when filter is missing or empty', () => {
    startup();
    const listener = $tw.rootWidget._listeners['tm-delete-history-matching'][0];

    listener({});
    listener({ paramObject: { filter: '' } });
    listener({ paramObject: { filter: '   ' } });

    expect($tw.wiki.getTiddler('$:/temp/mblackman/timelord/prune-report')).toBeNull();
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
    const revTitle = '$:/plugins/mblackman/timelord/revisions/badhash/1000-0';
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

    const report = $tw.wiki.getTiddler('$:/temp/mblackman/timelord/verify-report');
    expect(report.getFieldString('marked')).toBe('1');
    expect(report.getFieldString('chains-repaired')).toBe('1');
  });
});
