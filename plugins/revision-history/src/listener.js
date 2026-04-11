"use strict";
import { Revisor, generateTag } from './revisor.js';

// Returns true if any meaningful field changed between oldTiddler and newTiddler.
// Skips fields that change automatically (timestamps, draft metadata, plugin-managed fields).
function tiddlerFieldsChanged(oldTiddler, newTiddler) {
	const skip = new Set([
		'title', 'modified', 'modifier', 'created', 'creator',
		'draft.of', 'draft.title', 'revision-tag'
	]);
	const allFields = new Set([
		...Object.keys(oldTiddler.fields),
		...Object.keys(newTiddler.fields)
	]);
	for (const field of allFields) {
		if (skip.has(field)) continue;
		if (oldTiddler.getFieldString(field) !== newTiddler.getFieldString(field))
			return true;
	}
	return false;
}

// Constructs a revisor and listens for changes to put in it
export function startup() {
	let revisor = new Revisor();
	$tw.hooks.addHook("th-saving-tiddler", (newTiddler, draft) => {
		if (!draft) return newTiddler; // Guard for TW < 5.3.x

		// Respect the global pause toggle
		const enabled = $tw.wiki.getTiddlerText("$:/config/mblackman/revision-history/enabled", "yes");
		if (enabled !== "yes") return newTiddler;

		// Not overwriting anything; no revision necessary!
		let oldTitle = draft.getFieldString("draft.of");
		if (!oldTitle) return newTiddler;
    	let oldTiddler = $tw.wiki.getTiddler(oldTitle);
    	if (!oldTiddler) return newTiddler;

    	let newTitle = newTiddler.getFieldString("title");

		if ($tw.wiki.isSystemTiddler(newTitle)) return newTiddler;
		if ($tw.wiki.isShadowTiddler(newTitle)) return newTiddler;
		if ($tw.wiki.isSystemTiddler(oldTitle)) return newTiddler;
		if ($tw.wiki.isShadowTiddler(oldTitle)) return newTiddler;

		// Per-tiddler exclusion filter
		const excludeFilter = $tw.wiki.getTiddlerText("$:/config/mblackman/revision-history/exclude-filter", "");
		if (excludeFilter && excludeFilter.trim()) {
			const excluded = $tw.wiki.filterTiddlers(excludeFilter);
			if (excluded.indexOf(newTitle) !== -1) return newTiddler;
		}

    	if (oldTitle != newTitle) {
    		revisor.renameHistory(oldTitle, newTitle);
    	}

        // Add the new title tag, since the title may have changed
    	newTiddler = new $tw.Tiddler(newTiddler, { "revision-tag": generateTag(newTitle)});

    	// If we're overwriting an existing tiddler via rename...
    	if (oldTitle != newTitle && $tw.wiki.tiddlerExists(newTitle)) {
    		revisor.addToHistory(newTitle, $tw.wiki.getTiddler(newTitle));
    	}

    	// No meaningful field changes — skip revision
    	if (!tiddlerFieldsChanged(oldTiddler, newTiddler)) {
    		return newTiddler;
    	}

    	revisor.addToHistory(newTitle, oldTiddler);

    	return newTiddler;
	});

	$tw.rootWidget.addEventListener("tm-restore-revision", function(event) {
		const revisionTitle = event.paramObject && event.paramObject.revisionTitle;
		if (revisionTitle) {
			revisor.restoreFromRevision(revisionTitle);
		}
	});

	$tw.rootWidget.addEventListener("tm-restore-deleted-tiddler", function(event) {
		const tiddlerName = event.paramObject && event.paramObject.tiddlerName;
		if (!tiddlerName) return;
		const revisionTitle = revisor.getLatestDeletedRevision(tiddlerName);
		if (revisionTitle) {
			revisor.restoreFromRevision(revisionTitle);
		}
	});

	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		if (!tiddler) return tiddler;
		const title = tiddler.fields.title;

		// Respect the global pause toggle
		const enabled = $tw.wiki.getTiddlerText("$:/config/mblackman/revision-history/enabled", "yes");
		if (enabled !== "yes") return tiddler;

		if ($tw.wiki.isSystemTiddler(title)) return tiddler;
		if ($tw.wiki.isShadowTiddler(title)) return tiddler;

		// Per-tiddler exclusion filter
		const excludeFilter = $tw.wiki.getTiddlerText("$:/config/mblackman/revision-history/exclude-filter", "");
		if (excludeFilter && excludeFilter.trim()) {
			const excluded = $tw.wiki.filterTiddlers(excludeFilter);
			if (excluded.indexOf(title) !== -1) return tiddler;
		}

		revisor.captureDeletedState(title, tiddler);
		return tiddler;
	});
}
