// SubagentStart hook — inject codescout guidance into coding subagents.
// Port of subagent-guidance.sh. Delivers the project bootstrap + exploration
// protocol + Iron-Laws reminder + the project system-prompt verbatim (the ONLY
// channel that reaches subagents — they don't get codescout's
// server_instructions, claude-code#29655).
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

let msg = '';

// Soft-conditional on purpose: SubagentStart cannot see the dispatch prompt, so
// a foreign-targeted subagent (explore-inject prepended its own root directive
// to the prompt) must be able to override this. Do NOT "simplify" to an
// unconditional activate — that reintroduces the conflict.
if (root) {
  msg += `PROJECT BOOTSTRAP: unless the task below names a different project root, your
FIRST codescout action is workspace(action="activate", path="${root}") — it
prewarms LSP, auto-registers dependencies, and returns project_hints (primary
language, entry points, build commands). If the task DOES name another repo,
follow that directive instead and pin every call with workspace="<that root>".

`;
}

msg += `codescout EXPLORATION PROTOCOL — before exploring or auditing code:

Phase 0 — load what the project already knows (do FIRST):
• memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).
• Bug/regression hunts: artifact(action="find", kind="bug", status="open") — the known-bug ledger. Don't re-report a filed bug as new; mark rediscoveries KNOWN with the ledger path.
• If a get_guide topic matches your area (error-handling, progressive-disclosure, workspace-state, librarian, tracker-conventions), read it — it states the contract whose violations you hunt.

Phase 1 — route each lookup by what you know:
symbol name → symbols(name=X) | concept → semantic_search(query) | exact string → grep(pattern) | who calls X → references(symbol, path), never grep for callers.

Phase 2 — verify at the bytes, not from belief:
• A finding needs lines you actually read (symbols include_body / read_file), not a grep hit alone.
• For a claim about how a TOOL behaves, run the call once and read the real output — reading the source alone misses runtime shape.
• A comment / doc / README the code contradicts is itself a finding (doc-vs-code drift).

Report contract: cite file:line for every finding; end with "Ledger checked: <bug ids seen | none>". If you skipped Phase 0, say so.`;

msg += `

CODESCOUT RULES (compression-resilient reminder):
• Source code: symbols (list + find), NOT read_file/Read
• Code edits: edit_code (LSP-aware; action=replace/insert/remove/rename), NOT edit_file/Edit for structural changes
• Shell commands: run_command, NOT Bash — output buffers save tokens
• Markdown: read_markdown/edit_markdown, NOT read_file/edit_file
• Never pipe unbounded run_command output — run bare, query @cmd_* buffer (bounded LHS like ls, cat, awk, sed, find -maxdepth N is OK)`;

if (d.HAS_CS_SYSTEM_PROMPT === 'true' && d.CS_SYSTEM_PROMPT) {
  msg += `

${d.CS_SYSTEM_PROMPT}`;
}

emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: msg } });
process.exit(0);
