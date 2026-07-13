// PreToolUse hook — IL3 warn-first guard on mcp__*__run_command.
// Port of il3-warn-hook.sh. Advisory only: allows the call, injects a context
// line so Claude self-corrects. IL3: don't pipe run_command output to a
// log-trimmer — the @cmd_* buffer stores full output and accepts follow-up
// queries. codescout's own gate enforces server-side; this is a redundant echo.
import { readInput, contextPreToolUse } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const toolName = input.tool_name || '';
if (!/^mcp__.*__run_command$/.test(toolName)) process.exit(0);

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!cmd) process.exit(0);

// Buffer-op exemption: pre-pipe segment references a @cmd_/@bg_/@file_/@tool_/@ack_
// handle. Operating on already-buffered data costs nothing in context.
const prePipe = cmd.replace(/\s*\|[\s\S]*$/, '');
if (/@(cmd|bg|file|tool|ack)_[A-Za-z0-9_]+/.test(prePipe)) process.exit(0);

// IL3 detection: <LHS_CMD> ... | <DENY_PIPE>, anchored at line start.
const LHS = '(cargo|npm|pnpm|yarn|python|pytest|go|mvn|gradle|git|find|ls|grep|cat|diff|du|stat|rg|fd)';
const DENY = '(tail|head|grep|less|sed|awk|cut|sort|uniq|tr|fmt)';
const il3Re = new RegExp(`^\\s*${LHS}\\s[^\\n]*\\|\\s*${DENY}\\b`, 'm');
if (!il3Re.test(cmd)) process.exit(0);

// Pure aggregators SAVE context (collapse to a count): exempt a counting
// grep -c / --count when it is the only trimmer target (wc is not in DENY).
const hasNonGrepTrim = /\|\s*(tail|head|less|sed|awk|cut|sort|uniq|tr|fmt)\b/m.test(cmd);
const hasCountingGrep = /\|\s*grep\b[^|]*(--count|-[A-Za-z]*c[A-Za-z]*)/m.test(cmd);
if (!hasNonGrepTrim && hasCountingGrep) process.exit(0);

const lead = prePipe.replace(/\s*$/, '');

const reason = `IL3 warning — piped \`${cmd}\` to a log-trimmer.

The @cmd_* buffer system saves context tokens:
  1. run_command("${lead}")               — full output stored as @cmd_xxx
  2. grep PATTERN @cmd_xxx                 — query the buffer at any granularity
                                              (also: tail -20 @cmd_xxx, head -50 @cmd_xxx)

codescout's run_command gate already denies unbounded-LHS pipes
server-side — this hook is an advisory echo, not the enforcer. Run
bare and query @cmd_xxx; bounded-LHS pipes (ls/cat/awk/sed/find
-maxdepth N) pass through.`;

contextPreToolUse(reason);
process.exit(0);
