// SDD PreToolUse hook — requires constitutional review before `git commit`.
// Port of review-guard.sh. The review marker is shared with mark-reviewed.mjs
// (written by /review) via lib.reviewMarker — both sides must use it.
//
// NOTE (pre-existing, preserved): the strict-deny payload uses the key
// `message` (spec-guard uses `permissionDecisionReason`). Kept verbatim for
// behavior parity; flagged for a separate follow-up, not fixed in this port.
import { existsSync } from 'node:fs';
import { readInput, projectDir, hasConstitution, enforcement, reviewMarker, emit } from './lib.mjs';

const input = readInput();
if (input.tool_name !== 'Bash') process.exit(0);

const command = (input.tool_input && input.tool_input.command) || '';
const dir = projectDir(input);
if (!hasConstitution(dir)) process.exit(0);
if (!command.includes('git commit')) process.exit(0);

// Review already recorded → allow.
if (existsSync(reviewMarker(dir))) process.exit(0);

const warning =
  'Constitutional review not performed this session. Run /review before committing. (Article III: Constitutional Review Before Commit)';

if (enforcement(dir) === 'strict') {
  emit({ permissionDecision: 'deny', message: warning });
} else {
  emit({ additionalContext: warning });
}
process.exit(0);
