"use strict";
import { Revisor, generateTag } from './revisor.js';

// Reads the per-tiddler `timelord-track` override.
// Returns "force-skip" for falsy values (no/false/0), "force-track" for truthy
// values (yes/true/1), or null when the field is absent or unrecognized.
// A force-track override wins over the exclude filter; a force-skip override
// wins over the include filter.
function getTrackOverride(tiddler) {
	if (!tiddler) return null;
	const v = tiddler.getFieldString("timelord-track");
	if (!v) return null;
	const lower = v.toLowerCase().trim();
	if (lower === "no" || lower === "false" || lower === "0") return "force-skip";
	if (lower === "yes" || lower === "true" || lower === "1") return "force-track";
	return null;
}

// Decides whether a tiddler should be tracked. Resolves the per-tiddler
// override first, then applies the configured filter mode (exclude or include).
function shouldTrack(title, tiddler) {
	const override = getTrackOverride(tiddler);
	if (override === "force-skip") return false;
	if (override === "force-track") return true;

	const mode = ($tw.wiki.getTiddlerText(
		"$:/config/mblackman/timelord/filter-mode", "exclude"
	) || "exclude").trim().toLowerCase();

	if (mode === "include") {
		const includeFilter = $tw.wiki.getTiddlerText(
			"$:/config/mblackman/timelord/include-filter", ""
		);
		if (!includeFilter || !includeFilter.trim()) return false;
		const matched = $tw.wiki.filterTiddlers(includeFilter);
		return matched.indexOf(title) !== -1;
	}

	const excludeFilter = $tw.wiki.getTiddlerText(
		"$:/config/mblackman/timelord/exclude-filter", ""
	);
	if (!excludeFilter || !excludeFilter.trim()) return true;
	const excluded = $tw.wiki.filterTiddlers(excludeFilter);
	return excluded.indexOf(title) === -1;
}

// Returns true if any meaningful field changed between oldTiddler and newTiddler.
// Skips fields that change automatically (timestamps, draft metadata, plugin-managed fields).
function tiddlerFieldsChanged(oldTiddler, newTiddler) {
	const skip = new Set([
		'modified', 'modifier', 'created', 'creator',
		'draft.of', 'draft.title', 'revision-tag', 'timelord-track'
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

		// Extract and clear edit-summary — it's ephemeral, never persisted on the live tiddler
		const editSummary = newTiddler.getFieldString("edit-summary") || "";
		if (editSummary) {
			newTiddler = new $tw.Tiddler(newTiddler, { "edit-summary": undefined });
		}

		// Respect the global pause toggle
		const enabled = $tw.wiki.getTiddlerText("$:/config/mblackman/timelord/enabled", "yes");
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

		if (!shouldTrack(newTitle, newTiddler)) return newTiddler;

    	const isRename = oldTitle != newTitle;
    	if (isRename) {
    		revisor.renameHistory(oldTitle, newTitle);
    	}

        // Add the new title tag, since the title may have changed
    	newTiddler = new $tw.Tiddler(newTiddler, { "revision-tag": generateTag(newTitle)});

    	// If we're overwriting an existing tiddler via rename...
    	if (isRename && $tw.wiki.tiddlerExists(newTitle)) {
    		revisor.addToHistory(newTitle, $tw.wiki.getTiddler(newTitle));
    	}

    	// No meaningful field changes — skip revision
    	if (!tiddlerFieldsChanged(oldTiddler, newTiddler)) {
    		return newTiddler;
    	}

    	const opts = isRename ? { renamedFrom: oldTitle, renamedTo: newTitle } : {};
    	if (editSummary) {
    		opts.summary = editSummary;
    	}
    	revisor.addToHistory(newTitle, oldTiddler, Object.keys(opts).length > 0 ? opts : undefined);

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

	$tw.rootWidget.addEventListener("tm-verify-revision-chains", function() {
		const result = revisor.verifyAllChains();
		const s = result.summary;
		const lines = [
			"Scanned " + s.totalChains + " chain(s), " + s.totalRevisions + " revision(s).",
			s.brokenChains === 0
				? "All chains verified OK."
				: s.brokenChains + " broken chain(s); " + s.brokenRevisions + " broken revision(s).",
		];
		if (s.brokenChains > 0) {
			lines.push("");
			lines.push("! Broken chains");
			for (const chain of result.chains) {
				if (chain.status === "ok" || chain.status === "empty") continue;
				lines.push("");
				lines.push("!! " + chain.name + " (" + chain.brokenCount + "/" + chain.revisions.length + " broken)");
				for (const r of chain.revisions) {
					if (r.status !== "broken") continue;
					lines.push("* " + r.title + " — " + (r.reason || "unknown"));
				}
			}
		}
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/mblackman/timelord/verify-report",
			text: lines.join("\n"),
			"scan-time": String(Date.now()),
			"broken-chains": String(s.brokenChains),
			"total-chains": String(s.totalChains),
			"broken-revisions": String(s.brokenRevisions),
			"total-revisions": String(s.totalRevisions),
		}));
	});

	$tw.rootWidget.addEventListener("tm-compute-revision-stats", function() {
		const stats = revisor.getStats(10);
		const report = {
			title: "$:/temp/mblackman/timelord/stats",
			text: "Computed at " + new Date().toISOString(),
			"total-revisions": String(stats.totalRevisions),
			"total-bytes": String(stats.totalBytes),
			"chains-count": String(stats.chainsCount),
			"broken-revisions": String(stats.brokenRevisions),
			"top-by-count": JSON.stringify(stats.topByCount),
		};
		$tw.wiki.addTiddler(new $tw.Tiddler(report));

		// Write one small tiddler per top entry so the UI can list them with filters
		// without needing a JSON parser. Clear any prior top-N tiddlers first.
		const prefix = "$:/temp/mblackman/timelord/stats/top/";
		const stale = [];
		if ($tw.wiki.each) {
			$tw.wiki.each(function(_t, title) {
				if (title && title.indexOf(prefix) === 0) stale.push(title);
			});
		}
		for (const t of stale) $tw.wiki.deleteTiddler(t);
		stats.topByCount.forEach(function(entry, idx) {
			const rank = String(idx + 1).padStart(2, "0");
			$tw.wiki.addTiddler(new $tw.Tiddler({
				title: prefix + rank,
				text: entry.name,
				rank: String(idx + 1),
				"tiddler-name": entry.name,
				"revision-count": String(entry.count),
				"revision-bytes": String(entry.bytes),
			}));
		});
	});

	$tw.rootWidget.addEventListener("tm-delete-timelord", function(event) {
		const tiddlerName = event.paramObject && event.paramObject.tiddlerName;
		if (!tiddlerName) return;
		revisor.removeHistory(tiddlerName);
	});

	$tw.rootWidget.addEventListener("tm-delete-history-matching", function(event) {
		const filter = event.paramObject && event.paramObject.filter;
		if (!filter || !filter.trim()) return;
		const result = revisor.removeHistoryMatchingFilter(filter);
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/mblackman/timelord/prune-report",
			text: "Removed history for " + result.deletedChains + " tiddler(s); "
				+ result.deletedRevisions + " revision(s) deleted.",
			"deleted-chains": String(result.deletedChains),
			"deleted-revisions": String(result.deletedRevisions),
			"deleted-names": result.names.join("\n"),
			"prune-time": String(Date.now()),
		}));
	});

	$tw.rootWidget.addEventListener("tm-repair-revision-chains", function() {
		const result = revisor.repairAllChains();
		const s = result.summary;
		const lines = [
			"Repaired " + s.chainsRepaired + " chain(s).",
			"Marked " + s.totalMarked + " broken revision(s). Promoted " + s.totalPromoted + " revision(s) to full snapshots.",
		];
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/mblackman/timelord/verify-report",
			text: lines.join("\n"),
			"repair-time": String(Date.now()),
			"chains-repaired": String(s.chainsRepaired),
			"marked": String(s.totalMarked),
			"promoted": String(s.totalPromoted),
		}));
	});

	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		if (!tiddler) return tiddler;
		const title = tiddler.fields.title;

		// Respect the global pause toggle
		const enabled = $tw.wiki.getTiddlerText("$:/config/mblackman/timelord/enabled", "yes");
		if (enabled !== "yes") return tiddler;

		if ($tw.wiki.isSystemTiddler(title)) return tiddler;
		if ($tw.wiki.isShadowTiddler(title)) return tiddler;

		if (!shouldTrack(title, tiddler)) return tiddler;

		revisor.captureDeletedState(title, tiddler);
		return tiddler;
	});
}
