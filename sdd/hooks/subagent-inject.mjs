// SDD SubagentStart hook — injects SDD guidance tailored to the agent type.
// Port of subagent-inject.sh. All context strings use real newlines (the old
// Explore branch emitted literal "\n" text — normalized here to render correctly).
import { readInput, projectDir, hasConstitution, specNames, specPaths, planNames, emit } from './lib.mjs';

const input = readInput();
const agentType = input.agent_type || '';

// Skip agents that don't do code work (exact matches + episodic-memory* prefix).
if (
  agentType === 'Bash' ||
  agentType === 'statusline-setup' ||
  agentType === 'claude-code-guide' ||
  agentType.startsWith('episodic-memory')
) {
  process.exit(0);
}

const dir = projectDir(input);
if (!hasConstitution(dir)) process.exit(0);

const specs = specNames(dir);
const specsStr = specs.length ? specs.join(' ') : 'none';
const plans = planNames(dir);
const plansStr = plans.length ? plans.join(' ') : 'none';

let context;
switch (agentType) {
  case 'Plan':
    context = `SDD: Plan must stay within spec scope. Human approval required before execution.
Constitution: memory/constitution.md
Active specs: ${specsStr}
Active plans: ${plansStr}
Read the relevant spec before planning. Your plan output needs human approval before implementation begins.`;
    break;

  case 'general-purpose':
    context = `SDD: Follow the approved plan. Don't exceed spec scope.
Active specs: memory/specs/ → ${specsStr}
Approved plans: memory/plans/ → ${plansStr}
spec-guard will block writes without a spec.`;
    break;

  case 'superpowers:code-reviewer':
    context = `SDD: Review implementation against the spec, not just code quality.
Specs: memory/specs/ → ${specsStr}
Check: does implementation match acceptance criteria? Does it exceed scope?`;
    break;

  case 'Explore': {
    const paths = specPaths(dir);
    const specList = paths.length ? `\nSpec files:\n${paths.map((f) => `- ${f}`).join('\n')}\n` : '';
    context = `SDD PROJECT - EXPLORATION GUIDANCE

This project uses Specification-Driven Development.
Specs: memory/specs/ | Plans: memory/plans/ | Constitution: memory/constitution.md
${specList}
TOOL ROUTING (codescout MCP, when present):
- Source code: prefer codescout symbols/symbol_at/references/grep/semantic_search over native Read/Grep/Glob
- Markdown (.md): use read_markdown / edit_markdown — heading-aware, slice-able
- Other non-code (.json, .yaml, .toml, .sql): read_file is fine
- Structural code edits: edit_code (replace/insert/remove/rename) — never edit_file on function bodies

PHASES:
1. Semantic Discovery - semantic_search for concepts when name is unknown
2. Symbol Drill-down - symbols(name=..., include_body=true) for specific classes/methods
3. Cross-reference - references(symbol, path) or call_graph for usage patterns`;
    break;
  }

  default:
    process.exit(0);
}

emit({ hookSpecificOutput: { additionalContext: context } });
process.exit(0);
