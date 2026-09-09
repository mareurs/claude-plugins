// PostToolUse hook — when a line-oriented search returns nothing AND its
// selector encodes an assumption about line structure, say so.
//
// THE CLASS
// ---------
// `grep`, `awk` and `sed` match LINE BY LINE. A phrase that wraps across a
// newline cannot match however present the text is; a range expression
// (/a/,/b/) fails the same way when either endpoint is not a line of its own.
// The result is a WELL-FORMED ZERO that reads as "not present" when it means
// "the selector could not express the target". codescout tracks this as
// IC-18 (selector-narrower-than-its-population), whose author-facing half has
// no mechanism: an ad-hoc grep typed into a shell has no output surface on
// which to annotate its own scope. A PostToolUse hook IS that surface.
//
// WHY IT DOES NOT FIRE ON EVERY ZERO
// ----------------------------------
// codescout's ADR-2026-08-27 (negative results name their scope) clause 2:
// "a warning on every zero is equivalent to no warning", and its Alternative 3
// pre-rejects a blanket every-zero annotation because no mechanical check can
// decide which negatives are trustworthy. So this does not try. It fires only
// where the selector itself carries a line-structure assumption — a multi-word
// phrase, or a range — which is narrow, and is exactly the shape of both
// measured cases. An ordinary single-token miss is silent.
//
// MEASURED, 2026-09-09, twice in one evening in two sessions:
//   * grep for a phrase that wrapped in the file -> 0. Diagnosed "wrong tree".
//     Right tree.
//   * awk '/^## IC-18/,/^## IC-19/' over an INDEX file whose entries live in
//     22 per-class files -> 0. Diagnosed "IC-18 is a table row". The file has
//     no entry sections at all.
// Neither was resolved by a better selector; both by opening the artifact,
// after a second party intervened. Both wrong diagnoses were plausible enough
// to stop the search, which is what makes this worth a mechanism rather than
// a resolution to be careful.
//
// CEILING: it reads the command TEXT. A pattern built in a variable, or one
// this parser cannot confidently extract, is silent by design — parsing shell
// is the hazard four gates in this repo have each got wrong separately, so
// ambiguity resolves to silence, never to a guess.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readInput, contextPostToolUse, resolveProjectRoot } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);
if ((input.tool_name || '') !== 'Bash') process.exit(0);

const command = (input.tool_input && input.tool_input.command) || '';
if (!command) process.exit(0);

// --- the result. Absent means unknown, and unknown says nothing.
const tr = input.tool_response;
if (tr === undefined || tr === null) process.exit(0);
let stdout;
if (typeof tr === 'string') stdout = tr;
else if (typeof tr === 'object' && typeof tr.stdout === 'string') stdout = tr.stdout;
else if (typeof tr === 'object' && typeof tr.output === 'string') stdout = tr.output;
else process.exit(0);
if (stdout.trim() !== '') process.exit(0);

// --- is a line-oriented searcher the thing that produced the nothing?
const TOOL = /(^|[|;&\s])(grep|egrep|fgrep|rg|awk|sed)\b/;
const m = TOOL.exec(command);
if (!m) process.exit(0);

// --- the pattern. Only a quoted literal is read. An unquoted or constructed
// pattern is ambiguous, and ambiguity resolves to silence.
const after = command.slice(m.index + m[0].length);
const quoted = /'([^']*)'|"([^"]*)"/.exec(after);
if (!quoted) process.exit(0);
const pattern = quoted[1] !== undefined ? quoted[1] : quoted[2];
if (!pattern) process.exit(0);

// --- does the selector assume something about line structure?
const isPhrase = /\s/.test(pattern);
const isRange = /\/[^/]*\/\s*,\s*\/[^/]*\//.test(pattern);
if (!isPhrase && !isRange) process.exit(0);

// --- one advisory per selector per session. Not one per session: a second,
// genuinely different suspicious zero is a second event and deserves saying.
const marker = join(
  resolveProjectRoot(input.cwd || process.cwd()),
  '.buddy',
  input.session_id || 'no-session',
  `zero-hint-${createHash('sha256').update(pattern).digest('hex').slice(0, 16)}`,
);
if (existsSync(marker)) process.exit(0);
try {
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, '');
} catch {
  /* best-effort; a failed write re-warns, which is the safe direction */
}

const why = isRange
  ? 'a range expression — each endpoint must be a line of its own'
  : 'a multi-word phrase — it cannot match if the text wraps across a newline';

contextPostToolUse(
  `[cs-hint] That zero came from a line-oriented search with ${why}.\n` +
    `\n` +
    `\`grep\`, \`awk\` and \`sed\` match LINE BY LINE, so this result is as much about the\n` +
    `SELECTOR as about the corpus: "not present" and "could not be expressed" look identical.\n` +
    `\n` +
    `Run a control before concluding the text is absent — a strictly broader selector over\n` +
    `the same corpus:\n` +
    `\n` +
    `    grep -c '<shortest distinctive token>' <same path>\n` +
    `\n` +
    `Two predicates disagreeing localises the fault: a non-zero control means the pattern is\n` +
    `wrong, a zero control means the path or corpus is. Measured twice on 2026-09-09 in two\n` +
    `sessions an hour apart — in both, the wrong diagnosis was plausible enough to stop the\n` +
    `search, and what ended it was opening the artifact rather than refining the selector.`,
);
process.exit(0);
