"use strict";
import { Revisor } from './revisor.js';

// Filter operator: reconstructtext
// Usage in wikitext: [<revisionTitle>reconstructtext[]]
// Returns the reconstructed full text for revision tiddlers,
// resolving diff-compressed storage as needed.
// For non-revision tiddlers, returns the text field directly.

const revisor = new Revisor();

export const reconstructtext = function(source, operator, options) {
	const results = [];
	source(function(tiddler, title) {
		if (!tiddler || !tiddler.fields["revision-of"]) {
			// Not a revision tiddler — return text directly
			results.push(tiddler ? tiddler.getFieldString("text") : "");
			return;
		}
		results.push(revisor.reconstructText(title));
	});
	return results;
};
