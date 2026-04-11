// Structure of revision tiddlers:
// Title: $:/plugins/mblackman/revision-history/revisions/<hash>/<timestamp-ms>-<id>
//   where <hash> is the djb2 hex hash of the tiddler name — stable across renames
// Tag:   $:/plugins/mblackman/revision-history/revisions/<hash>
// Fields:
//   revision-of:            original tiddler name (the source of truth for lookup + restore)
//   revision-date:          modified timestamp in ms (used for sorting)
//   revision-original-tags: tags field of the original tiddler (restored on restore)

const baseName = "$:/plugins/mblackman/revision-history/revisions/";

export class Revisor {
	constructor() {}

	addToHistory(name, tiddler) {
		const newText = tiddler.getFieldString("text");
		const isDuplicate = this.getHistory(name).some(title => {
			const rev = $tw.wiki.getTiddler(title);
			return rev && rev.getFieldString("text") === newText;
		});
		if (isDuplicate) return;

		let modified = tiddler.fields.modified;
		if (modified == null) modified = tiddler.fields.created;
		if (modified == null) modified = new Date();

		let author = tiddler.getFieldString("modifier");
		if (!author) author = "<anon>";

		let entry = new $tw.Tiddler(tiddler, {
			title: generateTitle({ name, timestampMs: Date.now() }),
			"revision-date": modified.getTime(),
			"revision-of": name,
			tags: "[[" + generateTag(name) + "]]",
			"revision-original-tags": tiddler.getFieldString("tags"),
		});

		$tw.wiki.addTiddler(entry);
		console.log("Added tiddler to history:", name);
	}

	captureDeletedState(name, tiddler) {
		const newText = tiddler.getFieldString("text");
		// Try to record final content — dedup in addToHistory will skip if already captured
		this.addToHistory(name, tiddler);
		// Find the revision whose text matches the final state and mark it deleted
		const history = this.getHistory(name);
		const matchingRevs = history
			.map(title => $tw.wiki.getTiddler(title))
			.filter(rev => rev && rev.getFieldString("text") === newText)
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

		// Copy all fields from revision, then fix up for the live tiddler
		const restoredFields = Object.assign({}, revision.fields, {
			title: originalName,
			tags: revision.fields["revision-original-tags"] || "",
			"revision-tag": generateTag(originalName),
		});
		delete restoredFields["revision-date"];
		delete restoredFields["revision-of"];
		delete restoredFields["revision-original-tags"];
		delete restoredFields["revision-deleted"];

		$tw.wiki.addTiddler(new $tw.Tiddler(restoredFields));
		console.log("Restored:", revisionTitle, "→", originalName);
	}

	// Removes all revision history for this tiddler
	removeHistory(name) {
		if (!name.trim()) return;
		for (let title of this.getHistory(name)) {
			$tw.wiki.deleteTiddler(title);
		}
		console.log("Removed history:", name);
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
