// SDD PreToolUse hook — warns or blocks source-code writes when no specs exist.
// Port of spec-guard.sh. Output shape preserved verbatim (top-level
// permissionDecision / permissionDecisionReason) for behavior parity.
import { readInput, projectDir, hasConstitution, enforcement, specNames, emit } from './lib.mjs';

const input = readInput();
if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') process.exit(0);

const filePath = (input.tool_input && input.tool_input.file_path) || '';
if (!filePath) process.exit(0);

const dir = projectDir(input);
if (!hasConstitution(dir)) process.exit(0);

// Allow non-source locations (handles both / and \ separators).
if (/[\\/](memory|\.claude|docs|\.serena|\.claude-plugin)[\\/]/.test(filePath)) process.exit(0);
// Allow non-source extensions.
if (/\.(md|json|ya?ml|toml|cfg|ini|gitignore|env)$/.test(filePath)) process.exit(0);

// Specs exist → allow.
if (specNames(dir).length) process.exit(0);

const warning =
  'No specifications found in memory/specs/. Consider running /specify <feature> before writing code. (Article I: Specification-First Development)';

if (enforcement(dir) === 'strict') {
  emit({ permissionDecision: 'deny', permissionDecisionReason: warning });
} else {
  emit({ additionalContext: warning });
}
process.exit(0);
