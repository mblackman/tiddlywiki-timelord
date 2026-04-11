// Shim that adapts the npm diff-match-patch package to TiddlyWiki's expected export format.
// TW requires: require("$:/core/...").diff_match_patch  →  the DMP class constructor
const diff_match_patch = require('diff-match-patch');
module.exports = { diff_match_patch };
