// SDD SubagentStart hook: tells implementer subagents which approved plan and spec
// bind them. Tool-routing text is the companion plugin's job, not ours.
import { relative } from 'node:path';
import { readInput, contextEvent, mainCheckout, currentBranch, loadConfig, activePlans } from './lib.mjs';

const IMPLEMENTERS = new Set(['general-purpose', 'Plan', 'claude']);

function main() {
  const input = readInput();
  if (!input || !IMPLEMENTERS.has(input.agent_type)) return;
  const ctx = mainCheckout(input.cwd || process.cwd());
  if (!ctx) return;
  if (!loadConfig(ctx.root)) return;

  let plans = activePlans(ctx.root);
  if (plans.length === 0) return;
  const branch = currentBranch(ctx.gitDir);
  const onBranch = branch ? plans.filter((p) => p.fm.branch === branch) : [];
  if (onBranch.length > 0) plans = onBranch;

  const rel = (p) => relative(ctx.root, p).split('\\').join('/');
  const lines = ['SDD: this project is under strict spec-driven development.'];
  for (const p of plans) {
    lines.push(`- Plan: ${rel(p.path)}`);
    lines.push(`  Spec: ${rel(p.specPath)}`);
  }
  lines.push('Stay inside the spec: implement only what the plan and spec bind you to. If the work needs something the spec does not cover, stop and report it instead of widening scope.');
  contextEvent('SubagentStart', lines.join('\n'));
}

try { main(); } catch { /* fail open */ }
process.exit(0);
