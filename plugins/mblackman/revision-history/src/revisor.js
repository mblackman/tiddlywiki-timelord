// Structure of revision tiddlers:
// Title: $:/plugins/mblackman/revision-history/revisions/<hash>/<timestamp-ms>-<id>
//   where <hash> is the djb2 hex hash of the tiddler name — stable across renames
// Tag:   $:/plugins/mblackman/revision-history/revisions/<hash>
// Fields:
//   revision-of:            original tiddler name (the source of truth for lookup + restore)
//   revision-date:          modified timestamp in ms (used for sorting)
//   revision-data:          JSON of tiddler fields (see revision-storage for format)
//   revision-storage:       "full" (all fields, full text), "diff" (all fields, text is patch),
//                           or "delta" (only changed fields, text if present is a patch)
//   revision-text-hash:     djb2 hash of the original full text (for dedup)
//   revision-full-hash:     djb2 hash of full serialized field state (data integrity)
//   revision-content-hash:  djb2 hash of meaningful fields only (for dedup, ignores auto-fields)
//   revision-deleted:       "yes" if this captures the final state before deletion
//   revision-changed-fields: space-separated list of meaningful fields that changed
//   revision-number:        sequential revision number (1-based)
//   revision-version:       schema version this revision was written with (see SCHEMA_VERSION).
//                           Missing means pre-versioning (treat as "0"); future versions can
//                           branch reconstruction/migration logic on this value.
//   revision-renamed-from:  previous title, set on the revision captured at a rename event
//   revision-renamed-to:    new title, set on the revision captured at a rename event

const baseName = "$:/plugins/mblackman/revision-history/revisions/";
const SNAPSHOT_INTERVAL = 10;
// Bump when the on-disk revision schema changes in a non-backward-compatible way.
// Readers should treat missing revision-version as "0" (pre-versioning).
export const SCHEMA_VERSION = "1";

// Read the schema version of a revision tiddler. Returns "0" for pre-versioning revisions.
export function getRevisionVersion(revision) {
	if (!revision) return "0";
	return revision.getFieldString("revision-version") || "0";
}

let _dmp = null;
function getDmp() {
	if (!_dmp) {
		const DMP = require("$:/core/modules/utils/diff-match-patch/diff_match_patch.js").diff_match_patch;
		_dmp = new DMP();
	}
	return _dmp;
}

// Extract all tiddler fields as a plain object.
function extractFields(tiddler) {
	const data = {};
	for (const key of Object.keys(tiddler.fields)) {
		data[key] = tiddler.getFieldString(key);
	}
	return data;
}

// Serialize all tiddler fields (including text) into a consistently-ordered JSON string.
// Used as the authoritative data for storage and restore.
function serializeFields(tiddler) {
	const data = extractFields(tiddler);
	const sorted = {};
	for (const key of Object.keys(data).sort()) {
		sorted[key] = data[key];
	}
	return JSON.stringify(sorted);
}

// Fields that change automatically on every save — not considered "meaningful" changes.
const AUTO_FIELDS = new Set([
	'modified', 'modifier', 'created', 'creator',
	'draft.of', 'draft.title', 'revision-tag'
]);

// Serialize only meaningful fields (excluding auto-managed ones) into a consistently-ordered
// JSON string. Used for dedup — two tiddler states that differ only in auto-fields (modified,
// revision-tag, etc.) are considered identical for revision purposes.
function serializeContentFields(tiddler) {
	const data = extractFields(tiddler);
	const sorted = {};
	for (const key of Object.keys(data).sort()) {
		if (!AUTO_FIELDS.has(key)) {
			sorted[key] = data[key];
		}
	}
	return JSON.stringify(sorted);
}

export class Revisor {
	constructor() {}

	addToHistory(name, tiddler, options) {
		const renamedFrom = options && options.renamedFrom;
		const renamedTo = options && options.renamedTo;
		const candidateFields = extractFields(tiddler);
		const candidateData = serializeFields(tiddler);
		const candidateText = candidateFields.text || "";
		const candidateTextHash = hashName(candidateText);
		// Hash of the full state (all fields including text) — stored on the revision for reference.
		const candidateFullHash = hashName(candidateData);
		// Hash of only meaningful fields (excluding auto-managed ones like modified, revision-tag).
		// Used for dedup — a tiddler restored from an old revision should match the original revision
		// even though auto-fields differ.
		const candidateContentHash = hashName(serializeContentFields(tiddler));

		// Dedup: skip if a revision with identical meaningful content already exists
		const isDuplicate = this.getHistory(name).some(title => {
			const rev = $tw.wiki.getTiddler(title);
			if (!rev) return false;
			// Prefer content hash (ignores auto-fields) for accurate dedup
			const existingContentHash = rev.getFieldString("revision-content-hash");
			if (existingContentHash) {
				return existingContentHash === candidateContentHash;
			}
			// Fall back to full hash for revisions created before content hash existed
			const existingFullHash = rev.getFieldString("revision-full-hash");
			if (existingFullHash) {
				return existingFullHash === candidateFullHash;
			}
			// Old format: compare text only
			return rev.getFieldString("text") === candidateText;
		});
		if (isDuplicate) return;

		// revision-date and the revision tiddler's modified field always reflect
		// when the revision was captured, not the original tiddler's modification time.
		// The original modified timestamp is preserved inside revision-data.
		const capturedAt = new Date();

		const history = this.getHistory(name);
		const revisionNumber = history.length + 1;

		// Get previous revision's full field state for delta computation
		const prevFields = history.length > 0 ? this._getPreviousRevisionFields(history) : null;

		// Compute which meaningful fields changed (for display metadata).
		// Renames are surfaced via revision-renamed-from/to below — no synthetic "title" entry.
		const changedFieldNames = this._getChangedFieldNames(candidateFields, prevFields);

		let storedData, storageMode;

		if (this._shouldStoreSnapshot(history) || prevFields === null) {
			// Full snapshot: store all fields with full text
			storedData = candidateData;
			storageMode = "full";
		} else {
			// Delta: store only changed fields, text as a patch
			const delta = {};
			const allKeys = new Set([...Object.keys(candidateFields), ...Object.keys(prevFields)]);
			for (const key of allKeys) {
				const oldVal = prevFields[key];
				const newVal = candidateFields[key];
				if (oldVal !== newVal) {
					delta[key] = newVal !== undefined ? newVal : null; // null = field removed
				}
			}

			// Text diff compression
			if (delta.hasOwnProperty("text") && delta.text !== null) {
				const prevText = prevFields.text || "";
				const dmp = getDmp();
				const patches = dmp.patch_make(prevText, delta.text);
				const patchText = dmp.patch_toText(patches);
				if (patchText.length < delta.text.length) {
					delta.text = patchText;
					storedData = JSON.stringify(delta);
					storageMode = "delta";
				} else {
					// Patch larger than full text — fall back to full snapshot
					storedData = candidateData;
					storageMode = "full";
				}
			} else {
				// Text didn't change (or was removed) — store delta as-is
				storedData = JSON.stringify(delta);
				storageMode = "delta";
			}
		}

		const entryFields = {
			title: generateTitle({ name, timestampMs: Date.now() }),
			type: tiddler.getFieldString("type") || "text/vnd.tiddlywiki",
			modified: capturedAt,
			modifier: tiddler.getFieldString("modifier") || "<anon>",
			"revision-date": capturedAt.getTime(),
			"revision-of": name,
			"revision-data": storedData,
			"revision-storage": storageMode,
			"revision-text-hash": candidateTextHash,
			"revision-full-hash": candidateFullHash,
			"revision-content-hash": candidateContentHash,
			"revision-changed-fields": changedFieldNames.join(" "),
			"revision-number": revisionNumber,
			"revision-version": SCHEMA_VERSION,
			tags: "[[" + generateTag(name) + "]]",
		};
		if (renamedFrom && renamedTo && renamedFrom !== renamedTo) {
			entryFields["revision-renamed-from"] = renamedFrom;
			entryFields["revision-renamed-to"] = renamedTo;
		}
		const entry = new $tw.Tiddler(entryFields);

		$tw.wiki.addTiddler(entry);
		console.log("Added tiddler to history:", name, "(" + storageMode + ", rev #" + revisionNumber + ")");
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

		// Reconstruct the full field state (handles full/diff/delta chains)
		const fullFields = this.reconstructAllFields(revisionTitle);

		const targetTitle = fullFields.title || originalName;

		const restoredFields = Object.assign({}, fullFields, {
			title: targetTitle,
			"revision-tag": generateTag(targetTitle),
		});

		// Strip revision-specific fields that should not appear on the live tiddler
		delete restoredFields["revision-date"];
		delete restoredFields["revision-of"];
		delete restoredFields["revision-data"];
		delete restoredFields["revision-storage"];
		delete restoredFields["revision-text-hash"];
		delete restoredFields["revision-full-hash"];
		delete restoredFields["revision-content-hash"];
		delete restoredFields["revision-deleted"];
		delete restoredFields["revision-changed-fields"];
		delete restoredFields["revision-number"];
		delete restoredFields["revision-version"];
		delete restoredFields["revision-renamed-from"];
		delete restoredFields["revision-renamed-to"];

		const wasEnabled = $tw.wiki.getTiddlerText("$:/config/mblackman/revision-history/enabled", "yes");
		if (wasEnabled === "yes") {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/config/mblackman/revision-history/enabled", text: "no" }));
		}

		if (targetTitle !== originalName) {
			$tw.wiki.deleteTiddler(originalName);
			this.renameHistory(originalName, targetTitle);

			// Update story list replacing originalName with targetTitle
			const storyList = $tw.wiki.getTiddlerList("$:/StoryList");
			const index = storyList.indexOf(originalName);
			if (index !== -1) {
				storyList[index] = targetTitle;
				$tw.wiki.addTiddler(new $tw.Tiddler({title: "$:/StoryList", list: storyList}));
			}
		}

		$tw.wiki.addTiddler(new $tw.Tiddler(restoredFields));

		if (wasEnabled === "yes") {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/config/mblackman/revision-history/enabled", text: "yes" }));
		}

		console.log("Restored:", revisionTitle, "→", targetTitle);
		return targetTitle;
	}

	// Reconstruct the full text of a revision, resolving diff/delta chains as needed.
	// For "full" or old-format revisions, returns text directly.
	// For "diff" revisions, walks back to the nearest snapshot and applies patches forward.
	// For "delta" revisions, text may be absent (didn't change) — carries forward from previous.
	reconstructText(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return "";

		const storage = revision.getFieldString("revision-storage");

		if (storage !== "diff" && storage !== "delta") {
			return this._getRevisionText(revision);
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
		if (targetIdx === -1) return this._getRevisionText(revision);

		// Walk backward to find nearest full snapshot
		let snapshotIdx = targetIdx;
		while (snapshotIdx >= 0) {
			const s = sorted[snapshotIdx].getFieldString("revision-storage");
			if (s !== "diff" && s !== "delta") break;
			snapshotIdx--;
		}

		if (snapshotIdx < 0) {
			console.warn("No snapshot found for revision chain:", revisionTitle);
			return this._getRevisionText(revision);
		}

		let text = this._getRevisionText(sorted[snapshotIdx]);
		const dmp = getDmp();

		for (let i = snapshotIdx + 1; i <= targetIdx; i++) {
			const rev = sorted[i];
			const revStorage = rev.getFieldString("revision-storage");

			if (revStorage === "delta") {
				// Delta: text key may or may not be present in revision-data
				const dataStr = rev.getFieldString("revision-data");
				if (dataStr) {
					try {
						const data = JSON.parse(dataStr);
						if (data.hasOwnProperty("text") && data.text !== null) {
							const patches = dmp.patch_fromText(data.text);
							const [newText, results] = dmp.patch_apply(patches, text);
							if (results.some(r => !r)) {
								console.warn("Patch partially failed:", rev.fields.title);
							}
							text = newText;
						}
						// else: text didn't change in this delta, carry forward
					} catch (e) {
						console.warn("Failed to parse delta revision-data:", rev.fields.title);
					}
				}
			} else {
				// "diff" (old format): text is always a patch
				const patchText = this._getRevisionText(rev);
				const patches = dmp.patch_fromText(patchText);
				const [newText, results] = dmp.patch_apply(patches, text);
				if (results.some(r => !r)) {
					console.warn("Patch partially failed:", rev.fields.title);
				}
				text = newText;
			}
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

	// Reconstruct the full field state of a revision, resolving delta/diff chains.
	// Returns a plain object with all original tiddler fields.
	reconstructAllFields(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return {};

		const storage = revision.getFieldString("revision-storage");
		const dataStr = revision.getFieldString("revision-data");

		// Old format (no revision-data): read fields from tiddler itself
		if (!dataStr) {
			const fields = {};
			for (const key of Object.keys(revision.fields)) {
				fields[key] = revision.getFieldString(key);
			}
			return fields;
		}

		if (storage === "full" || storage === "" || storage === "diff") {
			// All fields present in revision-data
			const fields = JSON.parse(dataStr);
			if (storage === "diff") {
				fields.text = this.reconstructText(revisionTitle);
			}
			return fields;
		}

		if (storage === "delta") {
			// Walk back to nearest non-delta revision and apply deltas forward
			const name = revision.getFieldString("revision-of");
			const history = this.getHistory(name);
			const sorted = history
				.map(t => $tw.wiki.getTiddler(t))
				.filter(t => t != null)
				.sort((a, b) => (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0));

			const targetIdx = sorted.findIndex(t => t.fields.title === revisionTitle);
			if (targetIdx === -1) return JSON.parse(dataStr);

			// Walk backward to nearest non-delta revision
			let baseIdx = targetIdx;
			while (baseIdx >= 0 && sorted[baseIdx].getFieldString("revision-storage") === "delta") {
				baseIdx--;
			}

			if (baseIdx < 0) {
				console.warn("No base revision found for delta chain:", revisionTitle);
				return JSON.parse(dataStr);
			}

			// Get base revision's full fields (handles "full" and "diff")
			let fields = this.reconstructAllFields(sorted[baseIdx].fields.title);

			// Apply deltas forward (non-text fields only; text handled by reconstructText)
			for (let i = baseIdx + 1; i <= targetIdx; i++) {
				const rev = sorted[i];
				if (rev.getFieldString("revision-storage") !== "delta") continue;
				try {
					const deltaData = JSON.parse(rev.getFieldString("revision-data"));
					for (const key of Object.keys(deltaData)) {
						if (key === "text") continue;
						if (deltaData[key] === null) {
							delete fields[key];
						} else {
							fields[key] = deltaData[key];
						}
					}
				} catch (e) {
					console.warn("Failed to parse delta:", rev.fields.title);
				}
			}

			// Resolve text via chain-walking
			fields.text = this.reconstructText(revisionTitle);
			return fields;
		}

		// Unknown storage mode — best effort
		return JSON.parse(dataStr);
	}

	// --- Private helpers ---

	_shouldStoreSnapshot(history) {
		if (history.length === 0) return true;
		// Sort newest-first and count consecutive non-snapshot revisions since last snapshot
		const sorted = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(t => t != null)
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		let countSinceSnapshot = 0;
		for (const rev of sorted) {
			const s = rev.getFieldString("revision-storage");
			if (s !== "diff" && s !== "delta") break;
			countSinceSnapshot++;
		}
		return countSinceSnapshot >= SNAPSHOT_INTERVAL - 1;
	}

	_getPreviousRevisionFields(history) {
		if (history.length === 0) return null;
		const sorted = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(t => t != null)
			.sort((a, b) => (b.fields["revision-date"] || 0) - (a.fields["revision-date"] || 0));
		if (sorted.length === 0) return null;
		return this.reconstructAllFields(sorted[0].fields.title);
	}

	_getChangedFieldNames(currentFields, prevFields) {
		const changed = [];
		if (!prevFields) {
			// First revision — all non-auto fields are "new"
			for (const key of Object.keys(currentFields)) {
				if (!AUTO_FIELDS.has(key)) changed.push(key);
			}
			return changed;
		}
		const allKeys = new Set([...Object.keys(currentFields), ...Object.keys(prevFields)]);
		for (const key of allKeys) {
			if (AUTO_FIELDS.has(key)) continue;
			if ((currentFields[key] || "") !== (prevFields[key] || "")) {
				changed.push(key);
			}
		}
		return changed;
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
