// PreToolUse hook — deny worktree-ambiguous git mutations from Bash.
// Port of git-worktree-guard.sh. Each Bash call spawns a fresh shell from CC's
// frozen PWD; a bare destructive git verb lands on whatever branch PWD points
// at, not the worktree the agent thinks they're in. Fires only when the repo
// has ≥2 worktrees (single-worktree carve-out).
//
// Detection is per-COMMAND, not per-string. The four original regexes ran over
// the whole command as one flat blob, which failed in both directions from one
// root: a heredoc body containing `git commit` was blocked (its content is data,
// not syntax), and — worse — any substring matching the `git -C <path> <verb>`
// escape exited the hook 0 for the ENTIRE call, so a bare `git commit` alongside
// it ran unguarded. A mere mention inside an `echo` string was enough to disarm
// the guard. See docs/issues/archive/2026-09-01-worktree-guard-scans-the-whole-command-
// so-a-heredoc-blocks-and-a-mention-disarms.md
import { readInput, git, denyPreToolUse } from './lib.mjs';

// Heredoc bodies are data by definition — drop them before any command test.
// `<<-` permits a tab-indented terminator, so the terminator match is trimmed.
// `<<<` (herestring) is deliberately not matched: `[A-Za-z_]` cannot match `<`.
function stripHeredocs(s) {
  const out = [];
  let term = null;
  for (const line of s.split('\n')) {
    if (term !== null) {
      if (line.trim() === term) term = null; // terminator line, also dropped
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) term = m[2];
  }
  return out.join('\n');
}

// Quoted spans are DATA, not syntax — the same claim stripHeredocs makes about
// heredoc bodies, and the half it left uncovered. Each COMPLETE '...' or "..."
// span collapses to one inert token, so a `|` inside a regex alternation cannot
// split the command and a verb inside a pattern cannot be read as one.
//
// A TOKEN rather than a deletion, and that is load-bearing: `git -C "<path>"
// commit` and `cd "<path>"` both need the path to survive as a single `\S+`
// word, or EXPLICIT_C and CD_TO_PATH stop matching and the escapes break.
//
// An UNTERMINATED quote is left as ordinary text rather than blanking to
// end-of-string. Blanking would hide a real mutation sitting after a stray
// delimiter, and that is the one direction this guard must never fail in.
function stripQuoted(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const q = s[i];
    if (q === "'" || q === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== q) j += (q === '"' && s[j] === '\\') ? 2 : 1;
      if (j < s.length) { out += 'Q'; i = j + 1; continue; }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

// Split on shell command separators, keeping the separator that PRECEDED each
// segment. Splitting is naive about every construct EXCEPT quotes and heredocs,
// which are stripped first. The original rationale for being naive about quotes
// too — "a mis-split only ever produces SMALLER segments … it fails toward
// blocking, never toward allowing" — was true as written and still wrong: it
// prices a false refusal at zero, and the mis-split does not merely narrow a
// segment, it MANUFACTURES the end-of-segment boundary TRIGGER requires. See
// docs/issues/2026-09-16-worktree-guard-reads-a-quoted-regex-alternation-as-a-bare-git-verb.md
function segments(s) {
  const parts = [];
  const re = /(\|\||&&|;|\||\n)/;
  let rest = s;
  let sep = '';
  for (;;) {
    const m = rest.match(re);
    if (!m) { parts.push({ sep, text: rest }); return parts; }
    parts.push({ sep, text: rest.slice(0, m.index) });
    sep = m[1];
    rest = rest.slice(m.index + m[1].length);
  }
}

const input = readInput();
if (!input) process.exit(0);

if ((input.tool_name || '') !== 'Bash') process.exit(0);

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!cmd) process.exit(0);

const cwd = input.cwd || '';
if (!cwd) process.exit(0);

// Destructive git verbs (bare `git checkout <ref>` is read-mostly, skipped).
// Boundary is whitespace-or-end, not \b: a hyphen is a non-word character, so
// \b let `merge-base`/`commit-tree`-style read-only plumbing match a bare verb
// stem and be refused as a destructive mutation.
const TRIGGER = /git\s+(commit|push|reset\s+--hard|rebase|merge|checkout\s+-b)(\s|$)/;
// Allow: explicit `git -C <path> <verb>` — in THIS segment only.
const EXPLICIT_C = /git\s+-C\s+\S+\s+(commit|push|reset|rebase|merge|checkout)\b/;
// Allow: a segment that is exactly `cd <path>`. Quote-naive like the original
// (`cd "/path with space"` is not recognised) — parity, not an improvement.
const CD_TO_PATH = /^\s*cd\s+\S+\s*$/;

// A `cd` persists for the remainder of the shell invocation, so it exempts every
// LATER segment — that keeps the documented `cd /p && git commit && git push`
// workaround working, which a strict adjacency rule would have broken. It does
// NOT exempt earlier ones: `git commit && cd /p` really did run the commit in the
// ambiguous cwd.
let violating = null;
let cdApplied = false;
for (const seg of segments(stripQuoted(stripHeredocs(cmd)))) {
  if (CD_TO_PATH.test(seg.text)) { cdApplied = true; continue; }
  if (!TRIGGER.test(seg.text)) continue;
  if (EXPLICIT_C.test(seg.text)) continue;
  if (cdApplied) continue;
  violating = seg.text.trim();
  break;
}
if (!violating) process.exit(0);

// Skip if cwd is not inside a git repo.
if (git(cwd, ['rev-parse', '--is-inside-work-tree']) === null) process.exit(0);

// Single-worktree carve-out: count `worktree <path>` porcelain lines.
const porcelain = git(cwd, ['worktree', 'list', '--porcelain']) || '';
const wtCount = (porcelain.match(/^worktree /gm) || []).length;
if (wtCount < 2) process.exit(0);

const wtList = git(cwd, ['worktree', 'list']) || '';

const reason = `⛔ Worktree-ambiguous git mutation. BLOCKED.

Command : ${cmd}
Offender: ${violating}
CC PWD  : ${cwd}
Worktrees (${wtCount}):
${wtList}

Each Bash call starts a fresh shell from CC's PWD — a prior 'cd' does NOT
carry over. Bare 'git commit/push/reset/rebase/merge/checkout -b' lands on
whatever branch CC's PWD points at, not the worktree you think you're in.

This regressed real work (MRV-poc 2026-05-18, commit landed on 'dev'
instead of the worktree branch).

Fix one of:
  • Use explicit path:      git -C /full/worktree/path commit ...
  • Chain cd in same call:  cd /full/worktree/path && git commit ...

Only the offending command is judged — a heredoc body or a quoted mention of
the escape neither blocks nor disarms this guard.

The carve-out skips single-worktree repos — this only fires when ambiguity
actually exists.`;

denyPreToolUse(reason);
process.exit(0);
