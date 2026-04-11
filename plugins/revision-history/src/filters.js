"use strict";
import { Revisor, generateTag } from './revisor.js';

const revisor = new Revisor();

// Fields that change automatically on every save — excluded from change summaries.
const AUTO_FIELDS = new Set([
	'title', 'modified', 'modifier', 'created', 'creator',
	'draft.of', 'draft.title', 'revision-tag'
]);

// Filter operator: reconstructtext
// Usage in wikitext: [<revisionTitle>reconstructtext[]]
// Returns the reconstructed full text for revision tiddlers,
// resolving diff-compressed storage as needed.
// For non-revision tiddlers, returns the text field directly.
export const reconstructtext = function(source, operator, options) {
	const results = [];
	source(function(tiddler, title) {
		if (!tiddler || !tiddler.fields["revision-of"]) {
			results.push(tiddler ? tiddler.getFieldString("text") : "");
			return;
		}
		results.push(revisor.reconstructText(title));
	});
	return results;
};

// Filter operator: revisionchangedfields
// Usage: [<revisionTitle>revisionchangedfields[]]
// Returns the list of meaningful field names that changed in this revision.
// Uses stored metadata when available, computes on-the-fly for older revisions.
export const revisionchangedfields = function(source, operator, options) {
	const results = [];
	source(function(tiddler, title) {
		if (!tiddler || !tiddler.fields["revision-of"]) return;

		// Try stored metadata first
		const stored = tiddler.getFieldString("revision-changed-fields");
		if (stored && stored.trim()) {
			stored.trim().split(" ").filter(function(f) { return f; }).forEach(function(f) { results.push(f); });
			return;
		}

		// Compute on-the-fly for old revisions without stored metadata
		const name = tiddler.getFieldString("revision-of");
		const tag = generateTag(name);
		const history = $tw.wiki.getTiddlersWithTag(tag);
		const sorted = history
			.map(function(t) { return $tw.wiki.getTiddler(t); })
			.filter(function(t) { return t != null; })
			.sort(function(a, b) { return (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0); });

		const idx = sorted.findIndex(function(t) { return t.fields.title === title; });
		if (idx <= 0) return; // first revision or not found

		const currentFields = revisor.reconstructAllFields(title);
		const prevFields = revisor.reconstructAllFields(sorted[idx - 1].fields.title);

		const allKeys = new Set([...Object.keys(currentFields), ...Object.keys(prevFields)]);
		for (const key of allKeys) {
			if (AUTO_FIELDS.has(key)) continue;
			if ((currentFields[key] || "") !== (prevFields[key] || "")) {
				results.push(key);
			}
		}
	});
	return results;
};

// Filter operator: revisionchanges
// Usage: [<revisionTitle>revisionchanges[]]
// Returns formatted descriptions of non-text field changes, one string per field.
// Tags get special formatting showing added/removed tags.
export const revisionchanges = function(source, operator, options) {
	const results = [];
	source(function(tiddler, title) {
		if (!tiddler || !tiddler.fields["revision-of"]) return;

		const name = tiddler.getFieldString("revision-of");
		const tag = generateTag(name);
		const history = $tw.wiki.getTiddlersWithTag(tag);
		const sorted = history
			.map(function(t) { return $tw.wiki.getTiddler(t); })
			.filter(function(t) { return t != null; })
			.sort(function(a, b) { return (a.fields["revision-date"] || 0) - (b.fields["revision-date"] || 0); });

		const idx = sorted.findIndex(function(t) { return t.fields.title === title; });
		if (idx <= 0) return;

		const currentFields = revisor.reconstructAllFields(title);
		const prevFields = revisor.reconstructAllFields(sorted[idx - 1].fields.title);

		const allKeys = new Set([...Object.keys(currentFields), ...Object.keys(prevFields)]);
		for (const key of allKeys) {
			if (AUTO_FIELDS.has(key)) continue;
			if (key === "text") continue; // text diffs shown via <$diff-text>
			const oldVal = prevFields[key] || "";
			const newVal = currentFields[key] || "";
			if (oldVal === newVal) continue;

			if (key === "tags") {
				const oldTags = $tw.utils.parseStringArray(oldVal) || [];
				const newTags = $tw.utils.parseStringArray(newVal) || [];
				const added = newTags.filter(function(t) { return oldTags.indexOf(t) === -1; });
				const removed = oldTags.filter(function(t) { return newTags.indexOf(t) === -1; });
				const parts = [];
				if (added.length) parts.push(added.map(function(t) { return "+[[" + t + "]]"; }).join(" "));
				if (removed.length) parts.push(removed.map(function(t) { return "-[[" + t + "]]"; }).join(" "));
				results.push("tags: " + parts.join(" "));
			} else if (!oldVal) {
				results.push(key + ": (added) " + newVal);
			} else if (!newVal) {
				results.push(key + ": (removed)");
			} else {
				results.push(key + ": " + oldVal + " → " + newVal);
			}
		}
	});
	return results;
};
