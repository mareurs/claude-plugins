// sdd review-guard (PreToolUse on Bash / run_command): integration into the base
// branch needs the user's review approval record for the feature. Gated: commit or
// merge while on the base branch, a merge of a branch that an active plan owns (unless
// the command is known to run on another feature branch), push whose target is the
// base branch (or a ref-less push while on it), `gh pr create`, `gh pr merge`.
// Feature-branch commits pass. A command that runs `mark-reviewed` or writes into the
// approval-record directory is denied in every mode.
// Exit 0 on every path; denials go through the JSON permissionDecision.
//
// Directory and branch changes inside one command line (`cd`, `git checkout|switch`)
// are followed by git-intents.mjs; its header lists what is still not followed. With no
// active plan there is no feature to review, so nothing is gated (spec and plan commits
// on the base branch must stay possible).
import { existsSync, readFileSync } from 'node:fs';
import { join, basename, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, denyPreToolUse, contextPreToolUse, normalizedToolName, isCodescoutTool,
  mainCheckout, currentBranch, loadConfig, activePlans, approvalsDir, featureFromSpecPath,
} from './lib.mjs';
import { gitIntents, splitCommands, skipPrefix } from './git-intents.mjs';

const APPROVALS_RE = /sdd\/approvals/;
const WRITER_CMDS = new Set(['tee', 'cp', 'mv', 'mkdir', 'rm', 'touch', 'ln', 'install']);

export function reviewRecordPath(commonDir, feature) {
  return join(approvalsDir(commonDir), `${feature}.review.json`);
}

// Runs mark-reviewed, or writes into the approval-record directory (redirect target,
// tee/cp/mv/mkdir/rm/touch/ln argument). Reads and quoted mentions pass.
export function tampers(command) {
  for (const raw of splitCommands(command)) {
    if (raw.some((t) => basename(t).startsWith('mark-reviewed'))) return true;
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i].match(/^\d*>>?(.*)$/);
      if (m && APPROVALS_RE.test(m[1] || raw[i + 1] || '')) return true;
    }
    const toks = skipPrefix(raw);
    if (toks.length && WRITER_CMDS.has(basename(toks[0])) && toks.slice(1).some((a) => APPROVALS_RE.test(a))) return true;
  }
  return false;
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

// refs/heads/x -> x; origin/x -> x when x is a plan branch.
function normalizeRef(ref, plans) {
  const r = ref.replace(/^refs\/(heads|remotes)\//, '');
  if (plans.some((p) => p.fm.branch === r)) return r;
  const i = r.indexOf('/');
  if (i > 0 && plans.some((p) => p.fm.branch === r.slice(i + 1))) return r.slice(i + 1);
  return r;
}

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

  if (tampers(command)) {
    denyPreToolUse('Review approval is user-only: the agent may not run mark-reviewed or touch the approval-record directory. Ask the user to run /sdd:approve review <feature>.');
    return;
  }

  for (const intent of gitIntents(command)) {
    const ctx = (intent.dir ? mainCheckout(resolvePath(eff, intent.dir)) : null) || base0;
    const cfg = loadConfig(ctx.root);
    if (!cfg) continue;
    const base = baseBranch(ctx.commonDir, cfg);
    const assumed = intent.assumedBranch && (intent.assumedNew || branchExists(ctx.commonDir, intent.assumedBranch))
      ? intent.assumedBranch : null;
    const branch = assumed ?? currentBranch(ctx.gitDir);
    const onBase = branch !== null && branch === base;
    const plans = activePlans(ctx.root);

    let candidates = branch ? [branch] : [];
    let gated;
    if (intent.kind === 'commit') gated = onBase;
    else if (intent.kind === 'merge') {
      gated = onBase;
      if (intent.mergeRef) {
        const ref = normalizeRef(intent.mergeRef, plans);
        candidates = [ref];
        if (plans.some((p) => p.fm.branch === ref)) {
          // A plan-owned branch is being merged. Not gated only when the command is
          // known to run on some other feature branch (a branch cannot merge into itself,
          // so branch === ref means the cwd is stale).
          const known = assumed ?? (intent.dirUnknown ? null : currentBranch(ctx.gitDir));
          gated = !(known && known !== base && known !== ref);
        }
      }
    } else if (intent.kind === 'push') {
      const target = intent.pushRef === 'HEAD' ? branch : intent.pushRef;
      gated = target === undefined ? onBase : target === base;
    } else gated = true; // pr-create, pr-merge

    if (!gated) continue;
    const pick = pickFeature(plans, candidates);
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
