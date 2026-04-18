// Structure of revision tiddlers:
// Title: $:/plugins/mblackman/timelord/revisions/<hash>/<timestamp-ms>-<id>
//   where <hash> is the djb2 hex hash of the tiddler name — stable across renames
// Tag:   $:/plugins/mblackman/timelord/revisions/<hash>
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
//   revision-text-length:   length of the original full text at write time (avoids
//                           reconstructing the chain just to compute char count)
//   revision-summary:       optional edit summary describing why the change was made
//   revision-broken-chain:  "yes" if chain-integrity check determined this revision is
//                           unreconstructable (missing base, patch failure, or hash mismatch)

const baseName = "$:/plugins/mblackman/timelord/revisions/";
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
let _dmpWarned = false;
function getDmp() {
	if (!_dmp) {
		try {
			const DMP = require("$:/core/modules/utils/diff-match-patch/diff_match_patch.js").diff_match_patch;
			_dmp = new DMP();
		} catch (e) {
			if (!_dmpWarned) {
				_dmpWarned = true;
				console.error("Timelord: diff-match-patch module not found. Revision diff compression will be disabled.");
				if (typeof $tw !== 'undefined' && $tw.wiki && $tw.wiki.addTiddler && $tw.Tiddler) {
					$tw.wiki.addTiddler(new $tw.Tiddler({
						title: "$:/temp/mblackman/timelord/dmp-missing",
						text: "⚠️ Timelord: The diff-match-patch library was not found in your TiddlyWiki core. " +
							"Diff compression is disabled — all revisions will be stored as full snapshots. " +
							"Please ensure you are running TiddlyWiki >= 5.3.0 with the standard core.",
						tags: "$:/tags/Alert",
					}));
				}
			}
			return null;
		}
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

// Produce a consistently-ordered JSON string from a plain fields object.
// Sorting keys is required so two equivalent states hash identically.
function serializeFieldsObject(fields) {
	const sorted = {};
	for (const key of Object.keys(fields).sort()) {
		sorted[key] = fields[key];
	}
	return JSON.stringify(sorted);
}

// Serialize all tiddler fields (including text) into a consistently-ordered JSON string.
// Used as the authoritative data for storage and restore.
function serializeFields(tiddler) {
	return serializeFieldsObject(extractFields(tiddler));
}

// Fields that change automatically on every save — not considered "meaningful" changes.
export const AUTO_FIELDS = new Set([
	'modified', 'modifier', 'created', 'creator',
	'draft.of', 'draft.title', 'revision-tag', 'edit-summary'
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
		const summary = options && options.summary;
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

		// Single getHistory call — reused for dedup, snapshot decision, and delta computation
		const history = this.getHistory(name);

		// Dedup: skip if a revision with identical meaningful content already exists
		const isDuplicate = history.some(title => {
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
				if (!dmp) {
					// diff-match-patch unavailable — fall back to full snapshot
					storedData = candidateData;
					storageMode = "full";
				} else {
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
			"revision-text-length": candidateText.length,
			"revision-changed-fields": changedFieldNames.join(" "),
			"revision-number": revisionNumber,
			"revision-version": SCHEMA_VERSION,
			tags: "[[" + generateTag(name) + "]]",
		};
		if (renamedFrom && renamedTo && renamedFrom !== renamedTo) {
			entryFields["revision-renamed-from"] = renamedFrom;
			entryFields["revision-renamed-to"] = renamedTo;
		}
		if (summary) {
			entryFields["revision-summary"] = summary;
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
		delete restoredFields["revision-summary"];

		const wasEnabled = $tw.wiki.getTiddlerText("$:/config/mblackman/timelord/enabled", "yes");
		if (wasEnabled === "yes") {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/config/mblackman/timelord/enabled", text: "no" }));
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
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/config/mblackman/timelord/enabled", text: "yes" }));
		}

		console.log("Restored:", revisionTitle, "→", targetTitle);
		return targetTitle;
	}

	// Reconstruct the full text of a revision, resolving diff/delta chains as needed.
	// For "full" or old-format revisions, returns text directly.
	// For "diff" revisions, walks back to the nearest snapshot and applies patches forward.
	// For "delta" revisions, text may be absent (didn't change) — carries forward from previous.
	reconstructText(revisionTitle) {
		return this._reconstructTextTracked(revisionTitle).text;
	}

	// Returns { text, patchFailures, missingSnapshot, parseFailures } describing how
	// confidently the chain could be reconstructed. reconstructText discards the status;
	// verification paths consume it to detect broken chains.
	_reconstructTextTracked(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return { text: "", patchFailures: 0, missingSnapshot: false, parseFailures: 0 };

		const storage = revision.getFieldString("revision-storage");

		if (storage !== "diff" && storage !== "delta") {
			return { text: this._getRevisionText(revision), patchFailures: 0, missingSnapshot: false, parseFailures: 0 };
		}

		const name = revision.getFieldString("revision-of");
		const history = this.getHistory(name);
		const sorted = history
			.map(t => $tw.wiki.getTiddler(t))
			.filter(t => t != null)
			.sort((a, b) => (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0));

		const targetIdx = sorted.findIndex(t => t.fields.title === revisionTitle);
		if (targetIdx === -1) {
			return { text: this._getRevisionText(revision), patchFailures: 0, missingSnapshot: false, parseFailures: 0 };
		}

		let snapshotIdx = targetIdx;
		while (snapshotIdx >= 0) {
			const s = sorted[snapshotIdx].getFieldString("revision-storage");
			if (s !== "diff" && s !== "delta") break;
			snapshotIdx--;
		}

		if (snapshotIdx < 0) {
			console.warn("No snapshot found for revision chain:", revisionTitle);
			return { text: this._getRevisionText(revision), patchFailures: 0, missingSnapshot: true, parseFailures: 0 };
		}

		let text = this._getRevisionText(sorted[snapshotIdx]);
		let patchFailures = 0;
		let parseFailures = 0;
		const dmp = getDmp();
		if (!dmp) {
			// diff-match-patch unavailable — cannot reconstruct diff/delta chains
			console.warn("Cannot reconstruct text: diff-match-patch unavailable");
			return { text: this._getRevisionText(revision), patchFailures: 0, missingSnapshot: false, parseFailures: 1 };
		}

		for (let i = snapshotIdx + 1; i <= targetIdx; i++) {
			const rev = sorted[i];
			const revStorage = rev.getFieldString("revision-storage");

			if (revStorage === "delta") {
				const dataStr = rev.getFieldString("revision-data");
				if (dataStr) {
					try {
						const data = JSON.parse(dataStr);
						if (data.hasOwnProperty("text") && data.text !== null) {
							const patches = dmp.patch_fromText(data.text);
							const [newText, results] = dmp.patch_apply(patches, text);
							if (results.some(r => !r)) {
								console.warn("Patch partially failed:", rev.fields.title);
								patchFailures++;
							}
							text = newText;
						}
					} catch (e) {
						console.warn("Failed to parse delta revision-data:", rev.fields.title);
						parseFailures++;
					}
				}
			} else {
				const patchText = this._getRevisionText(rev);
				try {
					const patches = dmp.patch_fromText(patchText);
					const [newText, results] = dmp.patch_apply(patches, text);
					if (results.some(r => !r)) {
						console.warn("Patch partially failed:", rev.fields.title);
						patchFailures++;
					}
					text = newText;
				} catch (e) {
					console.warn("Failed to apply diff patch:", rev.fields.title);
					parseFailures++;
				}
			}
		}

		return { text, patchFailures, missingSnapshot: false, parseFailures };
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

	// Removes all timelord for this tiddler
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

	// Verify a single revision: reconstruct its full state, compare against stored hash.
	// Returns { ok, storedHash, computedHash, reason }. Old-format revisions without
	// a stored hash are considered ok ("legacy"); no data is available to cross-check.
	verifyRevisionIntegrity(revisionTitle) {
		const revision = $tw.wiki.getTiddler(revisionTitle);
		if (!revision) return { ok: false, reason: "not found" };

		const storedHash = revision.getFieldString("revision-full-hash");
		if (!storedHash) return { ok: true, reason: "legacy (no stored hash)" };

		try {
			const fields = this.reconstructAllFields(revisionTitle);
			const serialized = serializeFieldsObject(fields);
			const computedHash = contentHash(serialized);
			return {
				ok: computedHash === storedHash,
				storedHash,
				computedHash,
				reason: computedHash === storedHash ? null : "hash mismatch",
			};
		} catch (e) {
			return { ok: false, storedHash, reason: "reconstruction failed: " + e.message };
		}
	}

	// Walk the chain for a given tiddler name and report each revision's integrity status.
	// Returns { name, revisions: [{ title, storage, status, reason }], brokenCount, status }.
	// A chain is "broken" if any revision in it fails verification.
	verifyChain(name) {
		const history = this.getHistory(name);
		if (history.length === 0) {
			return { name, revisions: [], status: "empty", brokenCount: 0 };
		}

		const sorted = history
			.map(t => $tw.wiki.getTiddler(t))
			.filter(t => t != null)
			.sort((a, b) => (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0));

		const revisions = [];
		let hasFullSnapshot = false;
		let brokenCount = 0;

		for (const rev of sorted) {
			const title = rev.fields.title;
			const storage = rev.getFieldString("revision-storage");
			let status = "ok";
			let reason = null;

			if (storage !== "delta" && storage !== "diff") {
				hasFullSnapshot = true;
			}

			if ((storage === "delta" || storage === "diff") && !hasFullSnapshot) {
				status = "broken";
				reason = "no preceding full snapshot";
			}

			if (status === "ok" && (storage === "delta" || storage === "diff")) {
				const textResult = this._reconstructTextTracked(title);
				if (textResult.missingSnapshot) {
					status = "broken";
					reason = "snapshot unreachable";
				} else if (textResult.patchFailures > 0) {
					status = "broken";
					reason = textResult.patchFailures + " patch failure(s)";
				} else if (textResult.parseFailures > 0) {
					status = "broken";
					reason = "delta parse failure";
				}
			}

			if (status === "ok") {
				const integrity = this.verifyRevisionIntegrity(title);
				if (!integrity.ok) {
					status = "broken";
					reason = integrity.reason || "hash mismatch";
				}
			}

			if (status === "broken") brokenCount++;
			revisions.push({ title, storage: storage || "full", status, reason });
		}

		return {
			name,
			revisions,
			status: brokenCount === 0 ? "ok" : "broken",
			brokenCount,
		};
	}

	// Scan every revision tiddler in the wiki and verify all chains found.
	// Returns { chains: [...], summary: { totalChains, okChains, brokenChains, totalRevisions, brokenRevisions } }.
	verifyAllChains() {
		const names = new Set();
		const each = $tw.wiki.each && $tw.wiki.each.bind($tw.wiki);
		if (each) {
			each((tiddler, title) => {
				if (title && title.indexOf(baseName) === 0) {
					const revOf = tiddler.getFieldString && tiddler.getFieldString("revision-of");
					if (revOf) names.add(revOf);
				}
			});
		}

		const chains = [];
		let okChains = 0;
		let brokenChains = 0;
		let totalRevisions = 0;
		let brokenRevisions = 0;

		for (const name of names) {
			const result = this.verifyChain(name);
			chains.push(result);
			if (result.status === "ok" || result.status === "empty") okChains++;
			else brokenChains++;
			totalRevisions += result.revisions.length;
			brokenRevisions += result.brokenCount;
		}

		return {
			chains,
			summary: {
				totalChains: chains.length,
				okChains,
				brokenChains,
				totalRevisions,
				brokenRevisions,
			},
		};
	}

	// Repair a broken chain: flag every broken revision with revision-broken-chain:yes
	// so UI can surface it, and promote the earliest still-reconstructable delta/diff
	// revision after a break to a "full" snapshot — this gives the downstream chain a
	// stable anchor that won't be destroyed if more revisions are lost later.
	// Returns { name, marked, promoted, total }.
	repairChain(name) {
		const verification = this.verifyChain(name);
		let marked = 0;
		let promoted = 0;

		for (const r of verification.revisions) {
			if (r.status !== "broken") continue;
			const rev = $tw.wiki.getTiddler(r.title);
			if (!rev) continue;
			if (rev.getFieldString("revision-broken-chain") === "yes") continue;
			$tw.wiki.addTiddler(new $tw.Tiddler(rev, { "revision-broken-chain": "yes" }));
			marked++;
		}

		const firstBrokenIdx = verification.revisions.findIndex(r => r.status === "broken");
		if (firstBrokenIdx !== -1) {
			for (let i = firstBrokenIdx + 1; i < verification.revisions.length; i++) {
				const r = verification.revisions[i];
				if (r.status !== "ok") continue;
				if (r.storage === "full" || r.storage === "") break;
				const rev = $tw.wiki.getTiddler(r.title);
				if (!rev) break;
				try {
					const fields = this.reconstructAllFields(r.title);
					const fullData = serializeFieldsObject(fields);
					const newHash = hashName(fullData);
					$tw.wiki.addTiddler(new $tw.Tiddler(rev, {
						"revision-data": fullData,
						"revision-storage": "full",
						"revision-full-hash": newHash,
					}));
					promoted++;
				} catch (e) {
					console.warn("Failed to promote revision:", r.title, e.message);
				}
				break;
			}
		}

		return { name, marked, promoted, total: verification.revisions.length };
	}

	// Aggregate statistics about revision storage across the wiki.
	// Returns { totalRevisions, totalBytes, chainsCount, brokenRevisions, topByCount }.
	// `totalBytes` is the sum of revision-data string length across every revision tiddler
	// (approximate — metadata fields aren't counted, but revision-data dominates).
	// `topByCount` is up to 10 entries of { name, count, bytes } sorted by count descending.
	getStats(limit) {
		const top = limit || 10;
		const perChain = new Map();
		let totalRevisions = 0;
		let totalBytes = 0;
		let brokenRevisions = 0;

		const each = $tw.wiki.each && $tw.wiki.each.bind($tw.wiki);
		if (each) {
			each((tiddler, title) => {
				if (!title || title.indexOf(baseName) !== 0) return;
				if (!tiddler || !tiddler.getFieldString) return;
				const revOf = tiddler.getFieldString("revision-of");
				if (!revOf) return;

				totalRevisions++;
				const dataLen = (tiddler.getFieldString("revision-data") || "").length;
				totalBytes += dataLen;
				if (tiddler.getFieldString("revision-broken-chain") === "yes") brokenRevisions++;

				const entry = perChain.get(revOf) || { count: 0, bytes: 0 };
				entry.count++;
				entry.bytes += dataLen;
				perChain.set(revOf, entry);
			});
		}

		const topByCount = Array.from(perChain.entries())
			.map(([name, v]) => ({ name, count: v.count, bytes: v.bytes }))
			.sort((a, b) => b.count - a.count || b.bytes - a.bytes)
			.slice(0, top);

		return {
			totalRevisions,
			totalBytes,
			chainsCount: perChain.size,
			brokenRevisions,
			topByCount,
		};
	}

	// Remove timelord for every tiddler name that the filter matches AND has a chain.
	// Returns { deletedChains, deletedRevisions, names } where `names` is the list of
	// tiddler names whose history was removed. An empty or whitespace-only filter is a no-op.
	removeHistoryMatchingFilter(filter) {
		if (!filter || !filter.trim()) {
			return { deletedChains: 0, deletedRevisions: 0, names: [] };
		}

		const chainNames = new Set();
		const each = $tw.wiki.each && $tw.wiki.each.bind($tw.wiki);
		if (each) {
			each((tiddler, title) => {
				if (!title || title.indexOf(baseName) !== 0) return;
				const revOf = tiddler.getFieldString && tiddler.getFieldString("revision-of");
				if (revOf) chainNames.add(revOf);
			});
		}

		const matched = $tw.wiki.filterTiddlers ? $tw.wiki.filterTiddlers(filter) : [];
		const removed = [];
		let deletedRevisions = 0;
		for (const name of matched) {
			if (!chainNames.has(name)) continue;
			const history = this.getHistory(name);
			if (history.length === 0) continue;
			deletedRevisions += history.length;
			for (const t of history) $tw.wiki.deleteTiddler(t);
			removed.push(name);
		}

		return { deletedChains: removed.length, deletedRevisions, names: removed };
	}

	// Repair every broken chain in the wiki. Returns a summary with per-chain results.
	repairAllChains() {
		const verification = this.verifyAllChains();
		const results = [];
		let totalMarked = 0;
		let totalPromoted = 0;

		for (const chain of verification.chains) {
			if (chain.status !== "broken") continue;
			const r = this.repairChain(chain.name);
			results.push(r);
			totalMarked += r.marked;
			totalPromoted += r.promoted;
		}

		return {
			results,
			summary: {
				chainsRepaired: results.length,
				totalMarked,
				totalPromoted,
			},
		};
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

// SHA-256 hash of a string, returned as a 64-character lowercase hex string.
// Uses TiddlyWiki's built-in $tw.utils.sha256 (backed by the SJCL library).
// Used for content dedup and integrity verification where collisions would mean data loss.
export function contentHash(name) {
	return $tw.utils.sha256(name, { length: 64 });
}

// djb2 hash of a string, returned as an 8-char lowercase hex string.
// Used ONLY for revision tiddler title/tag path segments — a lightweight,
// stable identifier for grouping revisions by tiddler name.
// Changing this function would orphan every existing revision chain, so it is
// intentionally kept as the original djb2 even though SHA-256 is used elsewhere.
export function pathHash(name) {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

// Backward-compatible alias — existing callers (tests, seed scripts, filters)
// that hash content for dedup/integrity now get SHA-256.
export const hashName = contentHash;

export function generateTitle({ name, timestampMs }) {
	let id = 0;
	let title;
	do {
		title = `${baseName}${pathHash(name)}/${timestampMs}-${id}`;
		id++;
	} while ($tw.wiki.tiddlerExists(title));
	return title;
}

export function generateTag(name) {
	return `${baseName}${pathHash(name)}`;
}

export function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
