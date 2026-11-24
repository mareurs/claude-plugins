
// SubagentStart hook — tell a coding subagent what codescout is, how to load it,
// how to enter the project, and which tool fits which kind of work.
// Port of subagent-guidance.sh, reshaped 2026-11-23.
//
// WHY A POINTER, NOT A DUMP. Subagents do not get codescout's server_instructions
// (claude-code#29655), so this hook is the only channel that reaches them BEFORE
// their first tool call. It used to push the project system-prompt verbatim plus the
// full memory-name list: 12.2 KB on the codescout repo. Claude Code replaces a hook
// payload of about 10 KB or more with a ~2 KB preview and a file path. Measured
// 2026-11-23 over 1,959 SubagentStart payloads from the last 10 days: 536 (27%) were
// replaced that way, and the preview ended inside the memory-name list, so the routing
// rules after it never arrived. The subagent then opened with a native Read, was
// denied six times, and lost its work.
//
// So: the payload is short and ordered by what a subagent needs FIRST (load the tools,
// enter the project, pick a tool by intent). Long, project-specific text is named by
// path, and the subagent reads it on demand. Output size must not depend on any file
// the user edits. tests/test-subagent-guidance.sh pins this.
import { realpathSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readInput, detectFor, git, emit } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const agentType = input.agent_type || '';
if (agentType === 'Bash' || agentType === 'statusline-setup' || agentType === 'claude-code-guide') {
  process.exit(0);
}

const cwd = input.cwd || '';
const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);

// Project root for the bootstrap directive. Raw cwd is NOT sufficient: a cwd
// inside a worktree SUBDIRECTORY would not match .cs-worktree-pending's
// location (worktree-write-guard puts it at --show-toplevel; cs-activate-project
// deletes it via a literal join on tool_input.path), so the injected activate
// would be obeyed and still leave writes blocked.
const root = (cwd && git(cwd, ['rev-parse', '--show-toplevel'])) || cwd;

// Where the open bugs are. A project that keeps its bugs in a bugs box has them as catalog kind `entry`,
// so `doc find kind="bug"` returns nothing for it (measured 2026-11-24, claude-plugins after its bug
// migration: 0 items for 3 live bugs, and a subagent was told that no bug was open). Every other project
// keeps bug files with kind bug. Both texts are the same size: the payload must not grow with a project.
const hasBugsBox = Boolean(root) && existsSync(join(root, 'docs/trackers/ledgers/bugs/readme.md'));
const bugLine = hasBugsBox
  ? `run_command(command="codescout box bugs list") lists the live bugs. "taken" (a live session holds it), "investigating" (no live owner) and "zombie" (a recurrence check, not a task) are open too.`
  : `doc(action="find", kind="bug", filter={"status": {"in": ["open", "taken", "investigating", "zombie"]}}) — status="open" alone hides "taken" (a live session holds it), "investigating" (no live owner) and "zombie" (a recurrence check, not a task).`;

// How many memory topics exist. The NAMES are not inlined any more: a project with
// 40 memories spent 2 KB on them, and the subagent still has to read the ones it
// needs. A count tells it whether the list call is worth making.
// CS_MEMORY_NAMES is space-separated with a trailing space — trim it. Guard on the
// TRIMMED value: a memory file named " .md" (leading space) makes detect.mjs report
// HAS_CS_MEMORIES='true' with a whitespace-only name. detect.mjs is parity-locked
// against scripts/detect.py and can't be touched, so the guard belongs here.
const memoryNames = (d.CS_MEMORY_NAMES || '').trim();
const memoryCount = d.HAS_CS_MEMORIES === 'true' && memoryNames ? memoryNames.split(/\s+/).length : 0;
const memoryLine =
  memoryCount > 0
    ? `${memoryCount} project memories exist: memory(action="list"), then memory(action="read", topic="…") for the ones that match your task (architecture and gotchas usually pay off).`
    : `memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).`;

// A linked worktree has git-common-dir != git-dir (the same test the
// worktree-write-guard uses). Compare RESOLVED paths: from a subdirectory of the
// main checkout git prints --git-dir absolute but --git-common-dir relative
// ("../../.git"), so a string compare would call that a worktree. Its subagents
// must PIN, not activate: activation is shared by every session of the codescout
// server, so subagents that each activate their own worktree race each other, and
// a pinned call needs no activation at all — worktree-write-guard accepts a write
// pinned to its own worktree.
const gitPath = (arg) => {
  const p = cwd ? git(cwd, ['rev-parse', arg]) : null;
  if (!p) return null;
  try {
    return realpathSync(resolve(cwd, p));
  } catch {
    return null;
  }
};
const gitCommon = gitPath('--git-common-dir');
const gitDir = gitPath('--git-dir');
const inLinkedWorktree = gitCommon !== null && gitDir !== null && gitCommon !== gitDir;

// Pin argument for the system-prompt pointer: a worktree subagent never activates, so
// every call it makes carries workspace=.
const pin = root && inLinkedWorktree ? `, workspace="${root}"` : '';

let msg = `codescout is available in this project: an MCP server for code intelligence. Use it for source code and markdown instead of native Read, Grep, Glob or Bash. Native calls on source are blocked, and your profile may deny native Write, Edit and Bash as well.

STEP 1 — load the tools. If no mcp__codescout__* tool is in your tool list, they are deferred. Load them with ONE ToolSearch call: select:mcp__codescout__symbols,mcp__codescout__read_file,mcp__codescout__grep,mcp__codescout__semantic_search,mcp__codescout__run_command,mcp__codescout__memory,mcp__codescout__workspace,mcp__codescout__get_guide
Add mcp__codescout__edit_code,mcp__codescout__edit_file,mcp__codescout__create_file if you must write, and mcp__codescout__doc for bugs, specs and trackers. Do this even when your brief names only Read and Write.

STEP 2 — enter the project. `;

// Soft-conditional on purpose: SubagentStart cannot see the dispatch prompt, so
// a foreign-targeted subagent (explore-inject prepended its own root directive
// to the prompt) must be able to override this. Do NOT "simplify" to an
// unconditional activate — that reintroduces the conflict.
if (root && inLinkedWorktree) {
  msg += `PROJECT BOOTSTRAP: you are in a linked git worktree at ${root}. Do NOT call
workspace(action="activate") — activation is shared by every session of the codescout
server, so parallel subagents that each activate their own worktree overwrite one
another. Instead pin EVERY codescout call with workspace="${root}" — reads and the
write tools (edit_code, edit_file, create_file) alike. A pinned call needs no activation
and is not blocked by the worktree write guard. Pass paths relative to ${root}, and check
that they exist in this worktree's commit: a path the parent saw in the main checkout may
be absent here. Exception: if your task names a different project root, follow that
directive instead and pin every call with workspace="<that root>".`;
} else if (root) {
  msg += `PROJECT BOOTSTRAP: workspace(action="activate", path="${root}") is your FIRST
codescout call. It prewarms LSP, registers dependencies, and returns project_hints
(primary language, entry points, build commands). Exception: if your task names a different project root,
follow that directive instead and pin every call with workspace="<that root>".`;
} else {
  msg += 'Call workspace(action="activate", path="<project root>") first.';
}

msg += `

STEP 3 — pick the tool by what you do:
• Find or understand code: symbols(path=…) outline of a file; symbols(name=…, include_body=true) one body; semantic_search(query) by concept; grep(pattern) exact text; references(symbol, path) who calls X.
• Read: read_file on markdown returns a heading map; add heading="## Section" for one section. For source, use symbols first and read_file only with start_line and end_line.
• Write: edit_code (symbol-level, LSP-aware), edit_file (text, imports, markdown by heading), create_file (a new file). They work when native Write and Edit are denied.
• Run: run_command. Output lands in an @cmd_* buffer: query it with grep or read_file, never pipe unbounded output. No wake message reaches you, so run a long command in the foreground with timeout_secs. Do not start it with run_in_background and then poll.
• Know the project: ${memoryLine} For bug or regression work: ${bugLine} Do not re-report a filed bug: mark it KNOWN with its ledger path.

STEP 4 — read what the project already wrote, on demand:`;

if (d.HAS_CS_SYSTEM_PROMPT === 'true') {
  msg += `
• Entry points, navigation strategy and project rules: read_file(path=".codescout/system-prompt.md"${pin}) — a heading map first, then heading="## Section".`;
}
msg += `
• Orientation: get_guide("project-activation-bootstrap"). If a get_guide topic matches your area (error-handling, progressive-disclosure, workspace-state, librarian, tracker-conventions, untrusted-content), CALL get_guide on it, even if your brief says it is "already loaded": that is true of your parent's context, not yours, and an explicit get_guide always returns the full body.

Verify at the bytes: a finding needs lines you read, not a grep hit alone. For a claim about how a tool behaves, run the call once and read the real output. Cite file:line for every finding. For bug hunts, end your report with "Ledger checked: <bug ids seen | none>".`;

// Let Node drain stdout before exiting: an immediate process.exit() can cut
// a piped payload mid-JSON when the consumer applies backpressure.
emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: msg } });
