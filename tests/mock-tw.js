// Mock TiddlyWiki runtime ($tw global) for unit testing.

// Parse a TW-format tag string like '[[tag one]] simple' into ['tag one', 'simple']
function parseTags(tagStr) {
  if (!tagStr || typeof tagStr !== 'string') return [];
  const tags = [];
  const re = /\[\[(.*?)\]\]|(\S+)/g;
  let match;
  while ((match = re.exec(tagStr)) !== null) {
    tags.push(match[1] || match[2]);
  }
  return tags;
}

class MockTiddler {
  constructor(...args) {
    this.fields = {};
    for (const arg of args) {
      if (arg && arg instanceof MockTiddler) {
        for (const [k, v] of Object.entries(arg.fields)) {
          this.fields[k] = v;
        }
      } else if (arg && typeof arg === 'object' && arg.fields) {
        // Object with a fields property (another tiddler-like object)
        for (const [k, v] of Object.entries(arg.fields)) {
          this.fields[k] = v;
        }
      } else if (arg && typeof arg === 'object') {
        for (const [k, v] of Object.entries(arg)) {
          this.fields[k] = v;
        }
      }
    }
  }

  getFieldString(name) {
    const val = this.fields[name];
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    if (val instanceof Date) return String(val.getTime());
    return String(val);
  }
}

function createMockWiki() {
  const store = new Map();

  return {
    store,
    addTiddler(tiddler) {
      if (tiddler && tiddler.fields && tiddler.fields.title != null) {
        store.set(String(tiddler.fields.title), tiddler);
      }
    },
    getTiddler(title) {
      return store.get(title) || null;
    },
    deleteTiddler(title) {
      store.delete(title);
    },
    tiddlerExists(title) {
      return store.has(title);
    },
    getTiddlersWithTag(tag) {
      const results = [];
      for (const [title, tiddler] of store) {
        const tags = parseTags(tiddler.getFieldString('tags'));
        if (tags.includes(tag)) {
          results.push(title);
        }
      }
      return results;
    },
    isSystemTiddler(title) {
      return typeof title === 'string' && title.startsWith('$:/');
    },
    isShadowTiddler() {
      return false;
    },
    getTiddlerText(title, defaultText) {
      const t = store.get(title);
      if (t) return t.getFieldString('text');
      return defaultText !== undefined ? defaultText : null;
    },
    filterTiddlers() {
      return [];
    },
    each(callback) {
      for (const [title, tiddler] of store) {
        callback(tiddler, title);
      }
    },
  };
}

function createMockTw() {
  const wiki = createMockWiki();

  return {
    Tiddler: MockTiddler,
    wiki,
    hooks: {
      _hooks: {},
      addHook(name, fn) {
        if (!this._hooks[name]) this._hooks[name] = [];
        this._hooks[name].push(fn);
      },
    },
    rootWidget: {
      _listeners: {},
      addEventListener(name, fn) {
        if (!this._listeners[name]) this._listeners[name] = [];
        this._listeners[name].push(fn);
      },
    },
    utils: {
      parseStringArray(str) {
        return parseTags(str);
      },
    },
  };
}

// Reset the wiki store and hooks (call in beforeEach)
function resetTw(tw) {
  tw.wiki.store.clear();
  tw.hooks._hooks = {};
  tw.rootWidget._listeners = {};
}

module.exports = { createMockTw, resetTw, MockTiddler, parseTags };
