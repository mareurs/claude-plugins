// SDD SessionStart hook — announces SDD state when a constitution is present.
// Port of session-start.sh (cross-platform: no grep/sed/jq/compgen/xargs).
import { readInput, projectDir, hasConstitution, enforcement, specNames, emit } from './lib.mjs';

const input = readInput();
const dir = projectDir(input);
if (!hasConstitution(dir)) process.exit(0);

const enf = enforcement(dir);
const specs = specNames(dir);
const activeSpecs = specs.length ? specs.join(' ') : 'none — run /specify <feature> to start';

const context = [
  'SDD is active for this project.',
  'Commands: /specify, /plan, /review, /drift, /document',
  'Constitution: memory/constitution.md',
  `Enforcement: ${enf}`,
  `Active specs: ${activeSpecs}`,
  'Plans: memory/plans/',
  '',
  'Run /specify <feature> to start a new feature.',
  'Run /review before committing.',
].join('\n');

emit({ hookSpecificOutput: { additionalContext: context } });
process.exit(0);
