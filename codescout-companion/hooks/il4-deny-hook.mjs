// PreToolUse hook — IL4 deny guard on mcp__*__read_file for markdown paths.
// Port of il4-deny-hook.sh. IL4: markdown must use read_markdown, never read_file.
// The in-server gate also rejects read_file(*.md); this catches it pre-call to
// save the round-trip. Direct-deny (no warn stage): the predicate has zero FP risk.
import { readInput, denyPreToolUse } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const toolName = input.tool_name || '';
if (!/^mcp__.*__read_file$/.test(toolName)) process.exit(0);

const pathArg = (input.tool_input && input.tool_input.path) || '';
if (!pathArg) process.exit(0);

// .md suffix, case-insensitive (.md/.MD/.Md/.mD). Narrow: not .markdown/.mdx.
if (!/\.md$/i.test(pathArg)) process.exit(0);

const reason = `IL4 violation — \`read_file(path="${pathArg}")\` on markdown. BLOCKED.

Markdown files must use \`read_markdown(path)\` — heading-addressed,
size-adaptive, slice-able. \`read_file\` on \`.md\` is also hard-rejected by
the in-server gate; calling it costs a wasted round-trip and a
\`tool_calls\` row.

Use \`read_markdown\` first try:
  • read_markdown(path)                              — heading map
  • read_markdown(path, heading="## Section")        — single section
  • read_markdown(path, headings=["## A", "## B"])  — multi-section
  • read_markdown(path, start_line=N, end_line=M)    — line slice`;

denyPreToolUse(reason);
process.exit(0);
