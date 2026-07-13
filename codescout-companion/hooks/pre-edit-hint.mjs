// PreToolUse hook on mcp__codescout__edit_code — emit a recon-for-shape-changes
// pointer on the first shape-changing edit this session (dedup via
// .buddy/<sid>/hint-emitted-recon-edit). Port of pre-edit-hint.sh.
import { readInput, detectFor, emitSkillHint } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const cwd = input.cwd || '';
const sessionId = input.session_id || '';

if (detectFor(cwd).HAS_CODESCOUT === 'false') process.exit(0);

emitSkillHint(
  cwd,
  sessionId,
  'recon-edit',
  "Before this shape-changing edit (edit_code): if the change touches struct fields, function signatures, or API contracts not yet scouted this session, call Skill('codescout-companion:reconnaissance') first to capture friction and wins.",
);
process.exit(0);
