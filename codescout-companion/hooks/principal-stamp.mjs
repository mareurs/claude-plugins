// PreToolUse hook — stamp the calling principal onto codescout tool arguments.
//
// WHY THIS EXISTS
// A subagent and its parent share CLAUDE_CODE_SESSION_ID, the OS process, the
// MCP connection and clientInfo, so nothing on the wire tells the codescout
// server which of the two it is currently serving. It therefore keeps one guide
// ledger for both, and a subagent's calls mark the parent's topics as delivered.
// Measured 2026-09-14 (codescout:context-injection-session-log:W-3): a single
// subagent dispatch cost the parent 2 re-deliveries of guides it already held --
// a full `tracker-conventions` body, then `librarian` section "Filter Syntax" --
// on an otherwise byte-identical repeated call. With this stamp: 0, over two
// dispatches, while the subagent still received its own guides.
//
// This hook supplies the identity. The server strips the key before any tool
// sees it (codescout:src/tools/session_key.rs::principal_from_arguments), so no
// tool's argument schema ever meets it.
//
// NO permissionDecision -- DELIBERATE, AND THE POINT IS EASY TO MISS.
// `updatedInput` is honored on its own. Verified 2026-09-14 against the shipped
// Claude Code 2.1.270 binary rather than the docs, which do not state it: the
// PreToolUse schema declares permissionDecision / permissionDecisionReason /
// updatedInput / additionalContext as four INDEPENDENT optionals, and both
// composition paths attach updatedInput without consulting the decision --
//     O = deny?{deny:..}:ask?{ask:..}:allow?{allow:!0}:{}; if(d) O.updatedInput=d;
// while the precedence map `{deny:3, ask:2, allow:1, none:0}` makes "no decision"
// a real state one rank BELOW allow.
//
// So emitting `permissionDecision:'allow'` here would not help the stamp land; it
// would silently auto-approve every codescout call this hook matches -- including
// run_command and edit_code -- and outrank every hook that correctly stays
// silent. Staying silent does not approve; "allow" does. A sibling hook
// (explore-inject.mjs) does pair the two, but it matches only `Agent`, where the
// blast radius is one dispatch rather than every tool call a subagent makes.
//
// EXCEPT IN AUTO MODE, where this hook stamps nothing -- see the guard below
// the agent_id check. There, a rewritten input voids auto mode's review.
//
// Fail-open throughout: a hook that broke a tool call over its own stamping
// would cost more than the over-delivery it prevents.
import { readInput, emit } from './lib.mjs';

// The argument key the server consumes and strips. Must stay byte-identical to
// codescout:src/tools/session_key.rs::PRINCIPAL_ARG_KEY.
const KEY = 'dev.codescout.mcp/agentId';

// Server-scoped, not tool-scoped, and the asymmetry is the reason.
// Missing a codescout server under a different name costs exactly the status quo
// (no stamp, over-delivery as before). Stamping a FOREIGN MCP server injects an
// unknown key into a tool input we do not own, which a strict schema may reject
// -- breaking a call that works today. Only one of those two errors is a
// regression, so the matcher refuses anything it cannot attribute to codescout.
// Override for an install that names the server differently; that is the escape
// hatch, since no in-band way exists to ask a tool name who serves it.
const SERVER = process.env.CS_PRINCIPAL_STAMP_SERVER || 'codescout';

const input = readInput();
if (!input) process.exit(0);

// `mcp__<server>__<tool>`. A server name may itself contain single underscores,
// so split on the double and read position 1 rather than matching a prefix.
const parts = String(input.tool_name || '').split('__');
if (parts.length < 3 || parts[0] !== 'mcp' || parts[1] !== SERVER) process.exit(0);

// No agent_id => this call is the session's own parent, and stamping NOTHING is
// the correct signal rather than a gap: the server reads absence as "restore the
// parent's own ledger" (principal_from_arguments' doc comment). A parent's
// PreToolUse payload carries no agent_id at all -- measured, not assumed.
const agentId = input.agent_id;
const sessionId = input.session_id;
if (!agentId || !sessionId) process.exit(0);

// AUTO MODE: STAMP NOTHING. Claude Code 2.1.326 can review a call server-side,
// exactly as the model wrote it; any updatedInput then voids that review
// (`server_input_rewritten`). On accounts without the local-classifier fallback
// the call is refused, and every retry is refused too, because this hook
// re-stamps it. A subagent then had no shell at all: Bash is routed to
// run_command, and run_command was refused. Reported 2026-11-17 on CC 2.1.326;
// the branch and its message text were read from that binary.
// Returning permissionDecision:'allow' is not a way out: depending on a server
// flag, it either skips the auto-mode safety review for every subagent call, or
// is funnelled back to the classifier and voided the same way.
// Cost: in auto mode a subagent shares its parent's guide ledger again (about
// 2 guide re-deliveries per dispatch, codescout:context-injection-session-log:W-3).
// A subagent's PreToolUse payload carries permission_mode "auto" -- measured
// 2026-11-17, not assumed.
if (input.permission_mode === 'auto') process.exit(0);

// Composed from BOTH ids because either alone is ambiguous: agent_id alone
// conflates two different sessions' parents, since both present as "no agent id"
// (codescout:context-injection-session-log:W-2). The server treats the result as
// opaque and does not re-derive the composition.
const updated = { ...(input.tool_input || {}) };
updated[KEY] = `${sessionId}/${agentId}`;

// updatedInput REPLACES tool_input rather than merging into it, which is why the
// original is spread above and not just the one key emitted.
emit({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: updated,
  },
});
