// SDD SessionStart hook: one short banner with the enforcement mode, the active
// feature(s) and the next gate. Silent when the project has no .sdd/config.json.
import { readInput, contextEvent, mainCheckout, loadConfig, activePlans, featureFromSpecPath } from './lib.mjs';
import { baseBranch } from './review-guard.mjs';

function main() {
  const input = readInput();
  if (!input) return;
  const ctx = mainCheckout(input.cwd || process.cwd());
  if (!ctx) return;
  const cfg = loadConfig(ctx.root);
  if (!cfg) return;

  const plans = activePlans(ctx.root);
  const base = baseBranch(ctx.commonDir, cfg);
  const features = plans.map((p) => p.fm.feature || featureFromSpecPath(p.specPath));

  const lines = [];
  lines.push(cfg.error === 'unreadable'
    ? 'SDD: .sdd/config.json is unreadable; enforcement is warn.'
    : `SDD enforcement: ${cfg.enforcement}.`);
  if (features.length === 0) {
    lines.push('Active features: none. Approve a spec and plan with /sdd:approve before source edits.');
  } else {
    lines.push(`Active features: ${features.join(', ')}.`);
    lines.push(`Integration into ${base} needs /sdd:approve review ${features.join(' | ')}.`);
  }
  contextEvent('SessionStart', lines.join('\n'));
}

try { main(); } catch { /* fail open */ }
process.exit(0);
