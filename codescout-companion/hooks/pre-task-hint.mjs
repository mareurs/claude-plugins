// PreToolUse hook on Agent — emit a reconnaissance pointer on the first Agent
// dispatch this session (dedup via .buddy/<sid>/hint-emitted-recon).
// Port of pre-task-hint.sh.
import { readInput, detectFor, emitSkillHint } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const cwd = input.cwd || '';
const sessionId = input.session_id || '';

if (detectFor(cwd).HAS_CODESCOUT === 'false') process.exit(0);

emitSkillHint(
  cwd,
  sessionId,
  'recon',
  "First Agent dispatch this session. Reconnaissance recommended before subagent work — call Skill('codescout-companion:reconnaissance') for the full method unless this seam has already been scouted.",
);
process.exit(0);
