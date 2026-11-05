// sdd spec-guard (PreToolUse): source writes need an active plan (approved plan
// whose spec is approved); approval fields and the approval-record directory are
// user-only. Exit 0 on every path; denials go through the JSON permissionDecision.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, relative, isAbsolute, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, denyPreToolUse, contextPreToolUse, inputPath,
  isCodescoutTool, isWriteOperation, mainCheckout, currentBranch, loadConfig,
  listArtifacts, activePlans, approvalsDir, readFrontmatter,
} from './lib.mjs';

const EXEMPT_DIR_RE = /^(docs|\.sdd|\.claude|\.codescout)\//;
const EXEMPT_ANYWHERE_RE = /\/(docs|\.sdd|\.claude|\.codescout)\//;
const EXEMPT_EXT_RE = /\.(md|json|ya?ml|toml|ini|env)$/i;
const SPEC_PLAN_RE = /(^|\/)docs\/superpowers\/(specs|plans)\/[^/]+$/;
const APPROVAL_STATUS_RE = /^[ \t]*status[ \t]*:[ \t]*["']?(approved|implemented|done)["']?[ \t]*$/im;
const APPROVED_KEY_RE = /^[ \t]*approved[ \t]*:/im;
const APPROVAL_VALUE_RE = /^(approved|implemented|done)$/i;
const TEXT_KEYS = ['content', 'new_string', 'new_source', 'code', 'new_code', 'new_text', 'text', 'body'];
const APPROVALS_IN_PATH = '/.git/sdd/approvals/';
const REPORT_RE = /\/\.git\/sdd\/approvals\/[^/]+\.report\.json$/;

const norm = (p) => String(p).replace(/\\/g, '/');
const isForeignAbs = (p) => /^[A-Za-z]:\//.test(norm(p)) && !isAbsolute(p);
const isApprovalValue = (v) => APPROVAL_VALUE_RE.test(String(v ?? '').trim());

// relPath: path relative to the project root (or an absolute path of unknown root).
export function isExempt(relPath) {
  const p = norm(relPath).replace(/^\.\//, '');
  const absLike = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (EXEMPT_EXT_RE.test(p)) return true;
  return absLike ? EXEMPT_ANYWHERE_RE.test(p) : EXEMPT_DIR_RE.test(p);
}

function frontmatterParamApproves(fmParam) {
  if (!fmParam || typeof fmParam !== 'object') return false;
  const set = fmParam.set && typeof fmParam.set === 'object' ? fmParam.set : fmParam;
  if (Object.prototype.hasOwnProperty.call(set, 'approved')) return true;
  return isApprovalValue(set.status);
}

function textApproves(t) {
  return typeof t === 'string' && (APPROVAL_STATUS_RE.test(t) || APPROVED_KEY_RE.test(t));
}

// Frontmatter after adds or changes an approval field relative to before.
function fmApprovalChange(beforeText, afterText) {
  const b = readFrontmatter(beforeText);
  const a = readFrontmatter(afterText);
  if ('approved' in a && a.approved !== b.approved) return true;
  return isApprovalValue(a.status) && a.status !== b.status;
}

function readText(abs) {
  try { return readFileSync(abs, 'utf8'); } catch { return null; }
}

const normQuotes = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

// Replace oldS by newS in text, matching exactly first and otherwise modulo curly
// quotes and CRLF/LF (as the host's Edit does). Returns null when not found.
export function applyEdit(text, oldS, newS, all) {
  if (typeof oldS !== 'string' || typeof newS !== 'string' || oldS === '') return null;
  // 1. exact match first
  if (text.includes(oldS)) return all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
  // 2. LF-normalised copy of text with an index map back to the original; the
  // \n of a \r\n pair maps to the \r, so spans cover whole line endings.
  let lf = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    map.push(i);
    if (text[i] === '\r' && text[i + 1] === '\n') { lf += '\n'; i++; } else lf += text[i];
  }
  map.push(text.length);
  const hay = normQuotes(lf);
  const needle = normQuotes(oldS.replace(/\r\n/g, '\n'));
  const crlf = text.includes('\r\n');
  const rep = crlf ? newS.replace(/\r?\n/g, '\r\n') : newS;
  const spans = [];
  for (let from = 0; ;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    spans.push([map[i], map[i + needle.length]]);
    from = i + needle.length;
    if (!all) break;
  }
  if (!spans.length) return null;
  let out = text;
  for (let k = spans.length - 1; k >= 0; k--) out = out.slice(0, spans[k][0]) + rep + out.slice(spans[k][1]);
  return out;
}

// An approval word or key in text the guard could not simulate.
const approvalWords = (t) => typeof t === 'string' &&
  (/\b(approved|implemented|done)\b/i.test(t) || APPROVED_KEY_RE.test(t));
// A line that is only a frontmatter delimiter (optional BOM, trailing spaces/tabs and \r allowed).
const DELIM_LINE_RE = /^\uFEFF?---[ \t]*\r?$/m;
// Local copy of lib.mjs FM_RE (not exported): the frontmatter block at file start.
const FM_BLOCK_RE = /^(?<open>\uFEFF?---[ \t]*\r?\n)(?:(?<close2>---[ \t]*(?:\r?\n|$))|(?<inner>[\s\S]*?)(?<close>\r?\n---[ \t]*(?:\r?\n|$)))/;
const OPENER_LINE_RE = /^\uFEFF?---[ \t]*\r?(?:\n|$)/;
// Outside the block: a full or partial line-start approval field.
const PLANTED_STATUS_RE = /^\s*status\s*:\s*["']?(approved|implemented|done)/im;
const PLANTED_KEY_RE = /^[ \t]*approved[A-Za-z0-9_-]*[ \t]*:/im;
// Inside the block: a partial approval field only (an existing approval is not a precursor).
const PARTIAL_STATUS_RE = /^[ \t]*status[ \t]*:[ \t]*["']?(approved|implemented|done)(?!["']?[ \t]*\r?$)/im;
const PARTIAL_KEY_RE = /^[ \t]*approved[A-Za-z0-9_-]+[ \t]*:/im;

// Text that an unsimulable step could complete into an approval field: a planted
// field (full or partial) outside the frontmatter block, a partial one inside it,
// or an opener line with no closing delimiter.
function hasPrecursor(text) {
  if (typeof text !== 'string') return false;
  const m = text.match(FM_BLOCK_RE);
  if (!m) {
    if (OPENER_LINE_RE.test(text)) return true;
    return PLANTED_STATUS_RE.test(text) || PLANTED_KEY_RE.test(text);
  }
  const inner = m.groups.inner ?? '';
  if (PARTIAL_STATUS_RE.test(inner) || PARTIAL_KEY_RE.test(inner)) return true;
  const outside = text.slice(m[0].length);
  return PLANTED_STATUS_RE.test(outside) || PLANTED_KEY_RE.test(outside);
}

// True when the call sets an approval field. With absPath, text edits are
// simulated against the current file and the frontmatter compared before/after
// (so a value-only edit is caught and quoted text in a body is not). Carriers that
// cannot be simulated (edit_code, NotebookEdit, heading-grammar edits, an
// unreadable file) fall back to a text match on the new text; a call with any
// unsimulable step is also denied over a planted precursor (see hasPrecursor).
export function touchesApprovalFields(input, absPath) {
  const ti = (input && input.tool_input) || {};
  if (frontmatterParamApproves(ti.frontmatter)) return true;
  const edits = Array.isArray(ti.edits) ? ti.edits.filter((e) => e && typeof e === 'object') : [];
  for (const e of edits) if (frontmatterParamApproves(e.frontmatter)) return true;

  const before = absPath ? readText(absPath) : null;
  const isWholeFile = ti.content !== undefined && typeof ti.content === 'string' &&
    !edits.length && ti.old_string === undefined && ti.heading === undefined;
  const fallback = [];

  if (isWholeFile && (input.tool_name === 'Write' || isCodescoutTool(input, ['create_file']))) {
    if (absPath && before !== null) return fmApprovalChange(before, ti.content);
    if (absPath && !existsSync(absPath)) return fmApprovalChange('', ti.content);
    return textApproves(ti.content);
  }

  const simulable = before !== null && absPath;
  let cur = before;
  const steps = [];
  if (ti.old_string !== undefined || ti.new_string !== undefined || ti.insert !== undefined) {
    steps.push({ old_string: ti.old_string, new_string: ti.new_string, content: ti.content, insert: ti.insert, replace_all: ti.replace_all });
  }
  for (const e of edits) steps.push(e);
  if (!steps.length && ti.heading !== undefined) {
    // top-level heading grammar: one unsimulable step
    steps.push({ heading: ti.heading, action: ti.action, body: ti.body, content: ti.content });
  }
  if (!steps.length) {
    for (const k of TEXT_KEYS) fallback.push(ti[k]);
  }
  let unsimulated = false;
  // untrusted: an earlier step could not be simulated, so the host applies it and
  // cur no longer matches the real file. Later steps are still simulated against
  // cur (a forge may complete text already in the file) and, in addition, each is
  // denied if its new text has an approval word or a bare `---` line.
  let untrusted = !steps.length && fallback.some((t) => typeof t === 'string');
  for (const s of steps) {
    if (untrusted) {
      for (const k of TEXT_KEYS) if (approvalWords(s[k]) || (typeof s[k] === 'string' && DELIM_LINE_RE.test(s[k]))) unsimulated = true;
    }
    let next = null;
    if (simulable && cur !== null) {
      const ins = s.new_string ?? s.content;
      if (s.insert === 'prepend' && typeof ins === 'string') next = ins + cur;
      else if (s.insert === 'append' && typeof ins === 'string') next = cur + ins;
      else if (s.insert === undefined) next = applyEdit(cur, s.old_string, s.new_string, s.replace_all);
    }
    if (next !== null) {
      // A step that drops the frontmatter block is still simulated (cur stays accurate,
      // so the final compare sees a block rebuilt later), and its own new text gets
      // the approval-word check.
      if (Object.keys(readFrontmatter(cur)).length && !Object.keys(readFrontmatter(next)).length) {
        for (const k of TEXT_KEYS) if (approvalWords(s[k])) unsimulated = true;
      }
      cur = next;
    } else {
      // cannot simulate this step: fail closed on approval words in its new text
      for (const k of TEXT_KEYS) if (approvalWords(s[k])) unsimulated = true;
      for (const k of TEXT_KEYS) fallback.push(s[k]);
      untrusted = true;
    }
  }
  if (unsimulated) return true;
  // a call with any unsimulable step over a planted precursor is denied
  if (untrusted && hasPrecursor(before)) return true;
  if (simulable && cur !== before && fmApprovalChange(before, cur)) return true;
  return fallback.some(textApproves);
}

// codescout `doc` update/create: match parsed structure, never raw strings,
// so a `find` filter or prose is never mistaken for a write. Only `approved`
// (status or key) is denied: implemented/done close the gate (fail-closed) and
// `done` is an ordinary tracker status.
function docSetsApproval(ti) {
  const isApproved = (s) => String(s ?? '').trim().toLowerCase() === 'approved';
  const walk = (v, key) => {
    if (key === 'filter' || key === 'entry_filter') return false;
    if (Array.isArray(v)) return v.some((x) => walk(x, key));
    if (v && typeof v === 'object') {
      return Object.entries(v).some(([k, x]) =>
        k === 'approved' || (k === 'status' && isApproved(x)) || walk(x, k));
    }
    if (typeof v === 'string' && v.startsWith('---')) {
      const fm = readFrontmatter(v);
      return 'approved' in fm || isApproved(fm.status);
    }
    return false;
  };
  return walk(ti, '');
}

const WRITE_TOOLS = ['edit_code', 'edit_file', 'create_file'];
function isWriteCall(input) {
  const name = (input && input.tool_name) || '';
  return isWriteOperation(input) || name === 'MultiEdit' || name === 'NotebookEdit' ||
    isCodescoutTool(input, WRITE_TOOLS);
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

const APPROVE_REASON = 'Approval fields (status: approved/implemented/done, approved:) are user-only; tools may not set them. Ask the user to approve with /sdd:approve.';

function main() {
  const input = readInput();
  if (!input || typeof input !== 'object') return;

  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  const isCs = isCodescoutTool(input, [...WRITE_TOOLS, 'doc']);
  const baseDir = isCs && typeof ti.workspace === 'string' && ti.workspace ? ti.workspace : cwd;

  if (isCodescoutTool(input, ['doc'])) {
    if (ti.action !== 'update' && ti.action !== 'create') return;
    const c = mainCheckout(baseDir);
    if (!c || !loadConfig(c.root)) return;
    if (docSetsApproval(ti)) denyPreToolUse(APPROVE_REASON);
    return;
  }

  if (!isWriteCall(input)) return;
  const rawPath = inputPath(input) || ti.notebook_path || '';
  if (!rawPath) return;

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
  const n = '/' + norm(abs ?? rel);
  const ad = approvalsDir(ctx.commonDir);
  const underAd = abs !== null && (abs === ad || abs.startsWith(ad + sep));
  if (n.includes(APPROVALS_IN_PATH) || underAd) {
    const okReport = REPORT_RE.test(n) || (underAd && dirname(abs) === ad && /^[^/\\]+\.report\.json$/.test(basename(abs)));
    if (okReport) return;
    denyPreToolUse('The sdd approval-record directory is user-only; tools may not write it. Approvals are recorded only through /sdd:approve.');
    return;
  }

  // Approval fields in specs and plans: user-only, every mode.
  if (SPEC_PLAN_RE.test(rel) && touchesApprovalFields(input, abs)) {
    denyPreToolUse(APPROVE_REASON);
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
