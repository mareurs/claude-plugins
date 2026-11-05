// sdd review-guard (PreToolUse on Bash / run_command): integration into the base
// branch needs the user's review approval record for the feature. Gated: commit or
// merge while on the base branch, a merge of a branch that an active plan owns (unless
// the command is known to run on another feature branch), push whose target is the
// base branch (or a ref-less push while on it), `gh pr create`, `gh pr merge`.
// Feature-branch commits pass. A command that runs `mark-reviewed` or writes into the
// approval-record directory is denied in every mode.
// The review record counts only while its `head` is the current tip of the plan's
// `branch:` (commits added after /sdd:approve review need a new review); a plan with
// no `branch:` is checked for the record's existence only.
// Exit 0 on every path; denials go through the JSON permissionDecision.
//
// Directory and branch changes inside one command line (`cd`, `git checkout|switch`)
// are followed by git-intents.mjs; its header lists what is still not followed. With no
// active plan there is no feature to review, so nothing is gated (spec and plan commits
// on the base branch must stay possible).
import { readFileSync, statSync } from 'node:fs';
import { join, basename, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, denyPreToolUse, contextPreToolUse, normalizedToolName, isCodescoutTool,
  mainCheckout, currentBranch, loadConfig, activePlans, approvalsDir, featureFromSpecPath, readRef,
} from './lib.mjs';
import { gitIntents, traverse, skipPrefix } from './git-intents.mjs';

const APPROVALS_RE = /sdd[\\/]approvals/;
const WRITER_CMDS = new Set(['tee', 'cp', 'mv', 'mkdir', 'rm', 'touch', 'ln', 'install', 'sed', 'rsync', 'dd', 'truncate']);
const INTERPRETERS = new Set(['node', 'sh', 'bash', 'zsh', 'python', 'python3', 'deno', 'bun']);

export function reviewRecordPath(commonDir, feature) {
  return join(approvalsDir(commonDir), `${feature}.review.json`);
}

// Runs mark-reviewed (as the command word, or the script an interpreter runs), or
// writes into the approval-record directory: a redirect target or a writer command's
// argument containing sdd/approvals, or any redirect/writer while the tracked cwd is
// inside it. Reads and quoted mentions pass.
export function tampers(command) {
  let found = false;
  traverse(command, (raw, st) => {
    if (found) return;
    const toks = skipPrefix(raw);
    if (!toks.length) return;
    const word = basename(toks[0]);
    if (word.startsWith('mark-reviewed')) { found = true; return; }
    if (INTERPRETERS.has(word)) {
      const script = toks.slice(1).find((a) => !a.startsWith('-'));
      if (script && basename(script).startsWith('mark-reviewed')) { found = true; return; }
    }
    const inApprovals = typeof st.cwd === 'string' && APPROVALS_RE.test(`${st.cwd}/`);
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i].match(/^\d*>>?(.*)$/);
      if (m && (inApprovals || APPROVALS_RE.test(m[1] || raw[i + 1] || ''))) { found = true; return; }
    }
    if (WRITER_CMDS.has(word) && (inApprovals || toks.slice(1).some((a) => APPROVALS_RE.test(a)))) found = true;
  });
  return found;
}

// The review record for a feature, or null when it is absent or not a JSON object.
function readRecord(commonDir, feature) {
  try {
    const r = JSON.parse(readFileSync(reviewRecordPath(commonDir, feature), 'utf8'));
    return r && typeof r === 'object' ? r : null;
  } catch {
    return null;
  }
}


function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function branchExists(commonDir, b) {
  if (isFile(join(commonDir, 'refs', 'heads', b))) return true;
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
// The reason the review record does not cover the plan's feature, or null when it
// does. The record must exist and its head must be the current tip of the plan's
// `branch:` — whichever branch the command runs on, so the approval frontmatter commit
// on the base branch (whose HEAD is not the feature tip) is judged like the merge.
// A plan with no `branch:` names no tip to compare against: only the record's
// existence is checked for it.
function recordProblem(commonDir, plan, base) {
  const feature = featureOf(plan);
  const rec = readRecord(commonDir, feature);
  if (!rec) return `Integration into ${base} needs your review approval for feature "${feature}". Ask the user to run /sdd:approve review ${feature}.`;
  const branch = plan.fm.branch;
  if (!branch) return null;
  const tipRef = readRef(commonDir, `refs/heads/${branch}`);
  if (!tipRef) {
    return `Integration into ${base} needs a review approval that matches the tip of branch ${branch} (feature "${feature}"), but that branch cannot be read. If it was merged and deleted, ask the user to run /sdd:approve done ${feature}; otherwise restore the branch.`;
  }
  if (rec.head !== tipRef) {
    return `Commits were added to ${branch} after the review approval for "${feature}" (the review record does not name its current tip): re-run the review, then ask the user to run /sdd:approve review ${feature}.`;
  }
  return null;
}

// refs/heads/x -> x; origin/x -> x when x is a plan branch. viaRemote: a remote
// prefix was stripped (the merge pulls the remote copy of the branch).
function normalizeRef(ref, plans) {
  if (/^refs\/remotes\//.test(ref)) {
    const r = ref.replace(/^refs\/remotes\/[^/]+\//, '');
    return { ref: r, viaRemote: true };
  }
  const r = ref.replace(/^refs\/heads\//, '');
  if (plans.some((p) => p.fm.branch === r)) return { ref: r, viaRemote: false };
  const i = r.indexOf('/');
  if (i > 0 && plans.some((p) => p.fm.branch === r.slice(i + 1))) return { ref: r.slice(i + 1), viaRemote: true };
  return { ref: r, viaRemote: false };
}

// -> {feature} | {ambiguous: [names]} | null (no active plan: nothing to review)
// -> {plan} | {ambiguous: [plans]} | null (no active plan: nothing to review)
function pickFeature(plans, candidates) {
  if (!plans.length) return null;
  const hits = plans.filter((p) => p.fm.branch && candidates.includes(p.fm.branch));
  if (hits.length === 1) return { plan: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  if (plans.length === 1) return { plan: plans[0] };
  return { ambiguous: plans };
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
        const { ref, viaRemote } = normalizeRef(intent.mergeRef, plans);
        candidates = [ref];
        if (plans.some((p) => p.fm.branch === ref)) {
          // A plan-owned branch is being merged. Not gated only when the command is
          // known to run on some other feature branch. A branch cannot merge into
          // itself, so known === ref means the cwd is stale, unless the ref came from
          // a remote (a sync of the branch from its remote: judged normally).
          const known = assumed ?? (intent.dirUnknown ? null : currentBranch(ctx.gitDir));
          if (viaRemote && known === ref) gated = onBase;
          else gated = !(known && known !== base && known !== ref);
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
      // A commit or push on the base branch with several features in flight (none
      // owning the base branch) passes when every one of them has a valid record.
      const lacking = pick.ambiguous.filter((p) => recordProblem(ctx.commonDir, p, base) !== null);
      if ((intent.kind === 'commit' || intent.kind === 'push') && !lacking.length) continue;
      const names = pick.ambiguous.map(featureOf).join(', ');
      const missing = lacking.length ? ` ${lacking.map(featureOf).join(', ')} ${lacking.length === 1 ? 'has' : 'have'} no review approval matching the branch tip.` : '';
      report(`Integration into ${base} needs a review approval, but more than one active plan applies (${names}).${missing} Say which feature this is for, then ask the user to run /sdd:approve review <feature>.`);
      return;
    }
    const problem = recordProblem(ctx.commonDir, pick.plan, base);
    if (problem) {
      report(problem);
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail open */ }
  process.exit(0);
}
