// sdd spec-guard (PreToolUse): source writes need an active plan (approved plan
// whose spec is approved); approval fields and the approval-record directory are
// user-only. Exit 0 on every path; denials go through the JSON permissionDecision.
import { existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, relative, isAbsolute, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, denyPreToolUse, contextPreToolUse, inputPath,
  isCodescoutTool, isWriteOperation, mainCheckout, currentBranch, loadConfig,
  listArtifacts, activePlans, approvalsDir,
} from './lib.mjs';

const EXEMPT_DIR_RE = /^(docs|\.sdd|\.claude|\.codescout)\//;
const EXEMPT_ANYWHERE_RE = /\/(docs|\.sdd|\.claude|\.codescout)\//;
const EXEMPT_EXT_RE = /\.(md|json|ya?ml|toml|ini|env)$/i;
const SPEC_PLAN_RE = /(^|\/)docs\/superpowers\/(specs|plans)\/[^/]+$/;
const APPROVAL_STATUS_RE = /^[ \t]*status[ \t]*:[ \t]*["']?(approved|implemented|done)["']?[ \t]*$/im;
const APPROVED_KEY_RE = /^[ \t]*approved[ \t]*:/im;
const TEXT_KEYS = ['content', 'new_string', 'new_source', 'code', 'new_code', 'new_text', 'text', 'body'];

const norm = (p) => String(p).replace(/\\/g, '/');
const isForeignAbs = (p) => /^[A-Za-z]:\//.test(norm(p)) && !isAbsolute(p);

// relPath: path relative to the project root (or an absolute path of unknown root).
export function isExempt(relPath) {
  let p = norm(relPath).replace(/^\.\//, '');
  const absLike = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (EXEMPT_EXT_RE.test(p)) return true;
  return absLike ? EXEMPT_ANYWHERE_RE.test(p) : EXEMPT_DIR_RE.test(p);
}

function frontmatterParamApproves(fmParam) {
  if (!fmParam || typeof fmParam !== 'object') return false;
  const set = fmParam.set && typeof fmParam.set === 'object' ? fmParam.set : fmParam;
  if (Object.prototype.hasOwnProperty.call(set, 'approved')) return true;
  return /^(approved|implemented|done)$/i.test(String(set.status ?? '').trim());
}

function textApproves(t) {
  return typeof t === 'string' && (APPROVAL_STATUS_RE.test(t) || APPROVED_KEY_RE.test(t));
}

// True when the call carries new text that sets an approval field.
export function touchesApprovalFields(input) {
  const ti = (input && input.tool_input) || {};
  for (const k of TEXT_KEYS) if (textApproves(ti[k])) return true;
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) {
      if (!e || typeof e !== 'object') continue;
      for (const k of TEXT_KEYS) if (textApproves(e[k])) return true;
      if (frontmatterParamApproves(e.frontmatter)) return true;
    }
  }
  return frontmatterParamApproves(ti.frontmatter);
}

function isWriteCall(input) {
  const name = (input && input.tool_name) || '';
  return isWriteOperation(input) || name === 'MultiEdit' || name === 'NotebookEdit' ||
    isCodescoutTool(input, ['edit_code', 'edit_file', 'create_file']);
}

// Walk up from dir to the directory holding `.git` (worktree root).
function workingTreeRoot(dir) {
  let d = resolvePath(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function main() {
  const input = readInput();
  if (!input || typeof input !== 'object') return;
  if (!isWriteCall(input)) return;

  const ti = input.tool_input || {};
  const rawPath = inputPath(input) || ti.notebook_path || '';
  if (!rawPath) return;

  const cwd = input.cwd || process.cwd();
  const baseDir = isCodescoutTool(input, ['edit_code', 'edit_file', 'create_file']) &&
    typeof ti.workspace === 'string' && ti.workspace ? ti.workspace : cwd;

  let ctx;
  let abs = null;
  let rel;
  if (isForeignAbs(rawPath)) {
    ctx = mainCheckout(cwd);
    rel = norm(rawPath);
  } else {
    abs = resolvePath(baseDir, norm(rawPath));
    ctx = mainCheckout(dirname(abs));
    if (!ctx) return; // outside any repository
    const wt = workingTreeRoot(dirname(abs));
    rel = norm(relative(wt || ctx.root, abs));
  }
  if (!ctx) return;

  const cfg = loadConfig(ctx.root);
  if (!cfg) return;
  const strict = cfg.enforcement === 'strict';

  // Approval-record directory: user-only, except the review command's report.
  if (abs) {
    const ad = approvalsDir(ctx.commonDir);
    if (abs === ad || abs.startsWith(ad + sep)) {
      if (dirname(abs) === ad && /^[^/\\]+\.report\.json$/.test(basename(abs))) return;
      denyPreToolUse('The sdd approval-record directory is user-only; tools may not write it. Approvals are recorded only through /sdd:approve.');
      return;
    }
  }

  // Approval fields in specs and plans: user-only, every mode.
  if (SPEC_PLAN_RE.test(rel) && touchesApprovalFields(input)) {
    denyPreToolUse('Approval fields (status: approved/implemented/done, approved:) are user-only; tools may not set them. Ask the user to approve with /sdd:approve.');
    return;
  }

  if (isExempt(rel)) return;

  const branch = currentBranch(ctx.gitDir);
  const active = activePlans(ctx.root);
  let ok;
  const branchPlans = branch ? listArtifacts(ctx.root, 'plans').filter((p) => p.fm.branch === branch) : [];
  if (branchPlans.length) {
    ok = branchPlans.some((bp) => active.some((a) => a.path === bp.path));
  } else {
    ok = active.length > 0;
  }
  if (ok) return;

  const reason = branchPlans.length
    ? `Plan for branch ${branch} is not approved yet. Source writes need an approved spec and plan: run /sdd:approve.`
    : 'No active plan: source writes need an approved spec and an approved plan. Write them, then run /sdd:approve.';
  if (strict) denyPreToolUse(reason);
  else contextPreToolUse(reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail open */ }
  process.exit(0);
}
