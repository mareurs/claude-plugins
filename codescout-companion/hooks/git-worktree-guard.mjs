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

// Split on shell command separators, keeping the separator that PRECEDED each
// segment. Splitting is quote-naive on purpose: a mis-split only ever produces
// SMALLER segments, which makes an exemption less likely to co-occur with a
// trigger — i.e. it fails toward blocking, never toward allowing.
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
const TRIGGER = /git\s+(commit|push|reset\s+--hard|rebase|merge|checkout\s+-b)\b/;
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
for (const seg of segments(stripHeredocs(cmd))) {
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
