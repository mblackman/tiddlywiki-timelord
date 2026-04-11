// Structure of revision tiddlers:
// Title: $:/plugins/mblackman/revision-history/revisions/<hash>/<timestamp-ms>-<id>
//   where <hash> is the djb2 hex hash of the tiddler name — stable across renames
// Tag:   $:/plugins/mblackman/revision-history/revisions/<hash>
// Fields:
//   revision-of:            original tiddler name (the source of truth for lookup + restore)
//   revision-date:          modified timestamp in ms (used for sorting)
//   revision-data:          JSON of all original fields including text (authoritative for restore)
//   revision-storage:       "full" (snapshot) or "diff" (text in revision-data is a patch string)
//   revision-text-hash:     djb2 hash of the original full text (for dedup)
//   revision-deleted:       "yes" if this captures the final state before deletion

const baseName = "$:/plugins/mblackman/revision-history/revisions/";
const SNAPSHOT_INTERVAL = 10;

let _dmp = null;
function getDmp() {
	if (!_dmp) {
		const DMP = require("$:/core/modules/utils/diff-match-patch/diff_match_patch.js").diff_match_patch;
		_dmp = new DMP();
	}
	return _dmp;
}

// Serialize all tiddler fields (including text) into a consistently-ordered JSON string.
// Used as the authoritative record of full tiddler state for dedup and restore.
function serializeFields(tiddler) {
	const data = {};
	for (const key of Object.keys(tiddler.fields)) {
		data[key] = tiddler.getFieldString(key);
	}
	const sorted = {};
	for (const key of Object.keys(data).sort()) {
		sorted[key] = data[key];
	}
	return JSON.stringify(sorted);
}

export class Revisor {
	constructor() {}

	addToHistory(name, tiddler) {
		const candidateData = serializeFields(tiddler);
		const candidateText = tiddler.getFieldString("text");
		const candidateTextHash = hashName(candidateText);
		// Hash of the full state (all fields including text) before any diff compression.
		// Used for dedup — comparable regardless of whether a revision is stored as full or diff.
		const candidateFullHash = hashName(candidateData);

		// Dedup: skip if an identical revision already exists
		const isDuplicate = this.getHistory(name).some(title => {
			const rev = $tw.wiki.getTiddler(title);
			if (!rev) return false;
			// New format: compare full-state hash (works for both full and diff storage)
			const existingFullHash = rev.getFieldString("revision-full-hash");
			if (existingFullHash) {
				return existingFullHash === candidateFullHash;
			}
			// Old format: compare text only
			return rev.getFieldString("text") === candidateText;
		});
		if (isDuplicate) return;

		let modified = tiddler.fields.modified;
		if (modified == null) modified = tiddler.fields.created;
		if (modified == null) modified = new Date();

		// Determine storage mode: snapshot or diff
		const history = this.getHistory(name);
		let storedData = candidateData;
		let storageMode = "full";

		if (!this._shouldStoreSnapshot(history)) {
			const prevText = this._getPreviousRevisionText(history);
			if (prevText !== null) {
				const dmp = getDmp();
				const patches = dmp.patch_make(prevText, candidateText);
				const patchText = dmp.patch_toText(patches);
				// Only use diff if it's actually smaller than full text
				if (patchText.length < candidateText.length) {
					// Replace full text with patch in the stored JSON
					const dataObj = JSON.parse(candidateData);
					dataObj.text = patchText;
					storedData = JSON.stringify(dataObj);
					storageMode = "diff";
				}
			}
		}

		const entry = new $tw.Tiddler({
			title: generateTitle({ name, timestampMs: Date.now() }),
			type: tiddler.getFieldString("type") || "text/vnd.tiddlywiki",
			modified: modified,
			modifier: tiddler.getFieldString("modifier") || "<anon>",
			"revision-date": modified.getTime ? modified.getTime() : modified,
			"revision-of": name,
			"revision-data": storedData,
			"revision-storage": storageMode,
			"revision-text-hash": candidateTextHash,
			"revision-full-hash": candidateFullHash,
			tags: "[[" + generateTag(name) + "]]",
		});

		$tw.wiki.addTiddler(entry);
		console.log("Added tiddler to history:", name, "(" + storageMode + ")");
	}

	captureDeletedState(name, tiddler) {
		const candidateTextHash = hashName(tiddler.getFieldString("text"));
		// Record final content — dedup in addToHistory will skip if already captured
		this.addToHistory(name, tiddler);
		// Find the matching revision (by text hash) and mark it deleted.
		// Text hash is sufficient here — we just called addToHistory, so the
		// most recent revision with matching text is the right one.
		const history = this.getHistory(name);
		const matchingRevs = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(rev => {
				if (!rev) return false;
				const existingHash = rev.getFieldString("revision-text-hash");
				if (existingHash) return existingHash === candidateTextHash;
				// Old format: compare text directly
				return rev.getFieldString("text") === tiddler.getFieldString("text");
			})
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		if (matchingRevs.length > 0) {
			$tw.wiki.addTiddler(new $tw.Tiddler(matchingRevs[0], { "revision-deleted": "yes" }));
		}
		console.log("Captured deleted state for:", name);
	}

	renameHistory(oldName, newName) {
		if (oldName === newName) return;
		if (!oldName.trim() || !newName.trim()) return;
		let history = this.getHistory(oldName);
		if (history.length === 0) return;

		const newTag = generateTag(newName);
		for (let title of history) {
			let tiddler = $tw.wiki.getTiddler(title);
			// Update revision-of and retag — no need to retitle, the hash in the
			// title is just a unique identifier and does not need to match newName
			$tw.wiki.addTiddler(new $tw.Tiddler(tiddler, {
				"revision-of": newName,
				tags: "[[" + newTag + "]]",
			}));
		}

		console.log("Renamed history from", oldName, "to", newName);
	}

	// Returns a list of revision tiddler titles for the given tiddler name, sorted by TW
	getHistory(name) {
		return $tw.wiki.getTiddlersWithTag(generateTag(name));
	}

	// Returns whether history exists for this tiddler
	historyExists(name) {
		return this.getHistory(name).length !== 0;
	}

	// Returns the title of the most recent revision marked revision-deleted, or null if none
	getLatestDeletedRevision(name) {
		const history = this.getHistory(name);
		const deletedRevs = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(rev => rev && rev.fields["revision-deleted"])
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		return deletedRevs.length > 0 ? deletedRevs[0].fields.title : null;
	}

	restoreFromRevision(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return;

		const originalName = revision.fields["revision-of"];
		if (!originalName) return;

		// Snapshot current state first so the restore is undoable
		const currentTiddler = $tw.wiki.getTiddler(originalName);
		if (currentTiddler) {
			this.addToHistory(originalName, currentTiddler);
		}

		// Reconstruct the full text (resolves diffs if needed)
		const fullText = this.reconstructText(revisionTitle);

		// Try new format first (revision-data JSON)
		const revisionDataStr = revision.getFieldString("revision-data");
		let restoredFields;

		if (revisionDataStr) {
			const data = JSON.parse(revisionDataStr);
			restoredFields = Object.assign({}, data, {
				title: originalName,
				text: fullText,
				"revision-tag": generateTag(originalName),
			});
		} else {
			// Old format: copy fields directly from revision tiddler
			restoredFields = Object.assign({}, revision.fields, {
				title: originalName,
				text: fullText,
				tags: revision.fields["revision-original-tags"] || "",
				"revision-tag": generateTag(originalName),
			});
			delete restoredFields["revision-original-tags"];
		}

		// Strip revision-specific fields that should not appear on the live tiddler
		delete restoredFields["revision-date"];
		delete restoredFields["revision-of"];
		delete restoredFields["revision-data"];
		delete restoredFields["revision-storage"];
		delete restoredFields["revision-text-hash"];
		delete restoredFields["revision-full-hash"];
		delete restoredFields["revision-deleted"];

		$tw.wiki.addTiddler(new $tw.Tiddler(restoredFields));
		console.log("Restored:", revisionTitle, "→", originalName);
	}

	// Reconstruct the full text of a revision, resolving diff chains as needed.
	// Text is stored inside the revision-data JSON field.
	// For "full" or old-format revisions, returns text directly.
	// For "diff" revisions, walks back to the nearest snapshot and applies patches forward.
	reconstructText(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return "";

		const storage = revision.getFieldString("revision-storage");
		const textFromRevision = this._getRevisionText(revision);

		if (storage !== "diff") {
			return textFromRevision;
		}

		// Need to walk back to nearest snapshot and apply patches forward
		const name = revision.getFieldString("revision-of");
		const history = this.getHistory(name);
		const sorted = history
			.map(t => $tw.wiki.getTiddler(t))
			.filter(t => t != null)
			.sort((a, b) => (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0));
		// sorted is now oldest-first

		const targetIdx = sorted.findIndex(t => t.fields.title === revisionTitle);
		if (targetIdx === -1) return textFromRevision;

		// Walk backward to find nearest snapshot
		let snapshotIdx = targetIdx;
		while (snapshotIdx >= 0 && sorted[snapshotIdx].getFieldString("revision-storage") === "diff") {
			snapshotIdx--;
		}

		if (snapshotIdx < 0) {
			console.warn("No snapshot found for revision chain:", revisionTitle);
			return textFromRevision;
		}

		let text = this._getRevisionText(sorted[snapshotIdx]);
		const dmp = getDmp();

		for (let i = snapshotIdx + 1; i <= targetIdx; i++) {
			const patchText = this._getRevisionText(sorted[i]);
			const patches = dmp.patch_fromText(patchText);
			const [newText, results] = dmp.patch_apply(patches, text);
			if (results.some(r => !r)) {
				console.warn("Patch application partially failed for:", sorted[i].fields.title);
			}
			text = newText;
		}

		return text;
	}

	// Extract the text value from a revision tiddler.
	// New format: reads from revision-data JSON. Old format: reads tiddler's text field.
	_getRevisionText(revision) {
		const dataStr = revision.getFieldString("revision-data");
		if (dataStr) {
			try {
				return JSON.parse(dataStr).text || "";
			} catch (e) {
				return "";
			}
		}
		// Old format fallback
		return revision.getFieldString("text");
	}

	// Removes all revision history for this tiddler
	removeHistory(name) {
		if (!name.trim()) return;
		for (let title of this.getHistory(name)) {
			$tw.wiki.deleteTiddler(title);
		}
		console.log("Removed history:", name);
	}

	// --- Private helpers ---

	_shouldStoreSnapshot(history) {
		if (history.length === 0) return true;
		// Sort newest-first and count consecutive diffs since last snapshot
		const sorted = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(t => t != null)
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		let countSinceSnapshot = 0;
		for (const rev of sorted) {
			if (rev.getFieldString("revision-storage") !== "diff") break;
			countSinceSnapshot++;
		}
		return countSinceSnapshot >= SNAPSHOT_INTERVAL - 1;
	}

	_getPreviousRevisionText(history) {
		if (history.length === 0) return null;
		// Most recent revision is the "previous" one we diff against
		const sorted = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(t => t != null)
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		if (sorted.length === 0) return null;
		return this.reconstructText(sorted[0].fields.title);
	}
}

// djb2 hash of a string, returned as an 8-char lowercase hex string.
// Used to produce a path-safe, rename-stable segment for revision tiddler titles and tags.
function hashName(name) {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateTitle({ name, timestampMs }) {
	let id = 0;
	let title;
	do {
		title = `${baseName}${hashName(name)}/${timestampMs}-${id}`;
		id++;
	} while ($tw.wiki.tiddlerExists(title));
	return title;
}

export function generateTag(name) {
	return `${baseName}${hashName(name)}`;
}

export function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
