// sdd review-guard (PreToolUse on Bash / run_command): integration into the base
// branch needs the user's review approval record for the feature. Gated: commit or
// merge while on the base branch, push whose target is the base branch (or a ref-less
// push while on it), `gh pr create`, `gh pr merge`. Feature-branch commits pass.
// Any command naming `mark-reviewed` or the approval-record directory is denied.
// Exit 0 on every path; denials go through the JSON permissionDecision.
//
// Limits (not a sandbox): `sh -c '…'`, `cd x && git …`, aliases, `git pull`/`rebase`
// and shell writes are not followed. With no active plan there is no feature to review,
// so nothing is gated (spec and plan commits on the base branch must stay possible).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, denyPreToolUse, contextPreToolUse, normalizedToolName, isCodescoutTool,
  mainCheckout, currentBranch, loadConfig, activePlans, approvalsDir, featureFromSpecPath,
} from './lib.mjs';
import { gitIntents } from './git-intents.mjs';

const TAMPER_RE = /mark-reviewed|sdd\/approvals/;

export function reviewRecordPath(commonDir, feature) {
  return join(approvalsDir(commonDir), `${feature}.review.json`);
}

function hasRecord(commonDir, feature) {
  try {
    JSON.parse(readFileSync(reviewRecordPath(commonDir, feature), 'utf8'));
    return true;
  } catch {
    return false;
  }
}

function branchExists(commonDir, b) {
  if (existsSync(join(commonDir, 'refs', 'heads', b))) return true;
  try {
    return readFileSync(join(commonDir, 'packed-refs'), 'utf8')
      .split(/\r?\n/).some((l) => l.endsWith(` refs/heads/${b}`));
  } catch {
    return false;
  }
}

export function baseBranch(commonDir, cfg) {
  if (cfg && cfg.baseBranch) return cfg.baseBranch;
  if (branchExists(commonDir, 'main')) return 'main';
  if (branchExists(commonDir, 'master')) return 'master';
  return 'main';
}

const featureOf = (p) => p.fm.feature || featureFromSpecPath(p.specPath);

// -> {feature} | {ambiguous: [names]} | null (no active plan: nothing to review)
function pickFeature(plans, candidates) {
  if (!plans.length) return null;
  const hits = plans.filter((p) => p.fm.branch && candidates.includes(p.fm.branch));
  if (hits.length === 1) return { feature: featureOf(hits[0]) };
  if (hits.length > 1) return { ambiguous: hits.map(featureOf) };
  if (plans.length === 1) return { feature: featureOf(plans[0]) };
  return { ambiguous: plans.map(featureOf) };
}

// The directory the command runs in.
function effectiveCwd(input) {
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  if (isCodescoutTool(input, ['run_command'])) {
    if (ti.workspace) return resolvePath(cwd, ti.workspace, ti.cwd || '.');
    if (ti.cwd) return resolvePath(cwd, ti.cwd);
  }
  return resolvePath(cwd);
}

function main() {
  const input = readInput();
  if (!input) return;
  const isShell = normalizedToolName(input) === 'Bash' || isCodescoutTool(input, ['run_command']);
  if (!isShell) return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !command) return;

  const eff = effectiveCwd(input);
  const base0 = mainCheckout(eff) || mainCheckout(input.cwd || eff);
  if (!base0) return;
  const cfg0 = loadConfig(base0.root);
  if (!cfg0) return;
  const strict = cfg0.enforcement === 'strict';
  const report = (reason) => (strict ? denyPreToolUse(reason) : contextPreToolUse(reason));

  if (TAMPER_RE.test(command)) {
    denyPreToolUse('Review approval is user-only: the agent may not run mark-reviewed or touch the approval-record directory. Ask the user to run /sdd:approve review <feature>.');
    return;
  }

  for (const intent of gitIntents(command)) {
    const ctx = (intent.dir ? mainCheckout(resolvePath(eff, intent.dir)) : null) || base0;
    const cfg = loadConfig(ctx.root);
    if (!cfg) continue;
    const base = baseBranch(ctx.commonDir, cfg);
    const branch = currentBranch(ctx.gitDir);
    const onBase = branch !== null && branch === base;

    let candidates = branch ? [branch] : [];
    let gated;
    if (intent.kind === 'commit') gated = onBase;
    else if (intent.kind === 'merge') {
      gated = onBase;
      if (intent.mergeRef) candidates = [intent.mergeRef];
    } else if (intent.kind === 'push') {
      const target = intent.pushRef === 'HEAD' ? branch : intent.pushRef;
      gated = target === undefined ? onBase : target === base;
    } else gated = true; // pr-create, pr-merge

    if (!gated) continue;
    const pick = pickFeature(activePlans(ctx.root), candidates);
    if (!pick) continue;
    if (pick.ambiguous) {
      report(`Integration into ${base} needs a review approval, but more than one active plan applies (${pick.ambiguous.join(', ')}). Say which feature this is for, then ask the user to run /sdd:approve review <feature>.`);
      return;
    }
    if (!hasRecord(ctx.commonDir, pick.feature)) {
      report(`Integration into ${base} needs your review approval for feature "${pick.feature}". Ask the user to run /sdd:approve review ${pick.feature}.`);
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail open */ }
  process.exit(0);
}
