#!/usr/bin/env node
// UserPromptSubmit hook: the user-only approval channel. The model cannot trigger
// UserPromptSubmit, so a `/sdd:approve <kind> <target>` that reaches here was typed
// by the user. This hook itself writes the approval (spec/plan frontmatter, or the
// review record); the PreToolUse guards deny tools that try to write the same fields.
// No codescout call and no git spawn: fast, and works without the binary.
//
//   spec <path|feature>   draft spec -> approved, approved: <today>, kind, feature
//   plan <feature>        draft plan -> approved; refused unless its spec is approved
//   review <feature>      record {feature,date,session_id,head}; needs report go/go
//   done <feature|path>   approved spec -> implemented, approved plan -> done
//
// A feature target must be a plain slug; a path target must resolve (symlinks
// followed) inside docs/superpowers/<specs|plans>/. Candidates are filtered to the
// status the action applies to; more than one left is refused, never guessed.

import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve as resolvePath, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, contextEvent, mainCheckout, loadConfig,
  writeFrontmatterFields, listArtifacts, specPointer, approvalsDir, featureFromSpecPath,
} from './lib.mjs';
import { reviewRecordPath } from './review-guard.mjs';

const RE = /^(?:\/sdd:approve|\/approve|sdd approve)[ \t]+(spec|plan|review|done)[ \t]+(\S+)$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseApproval(prompt) {
  if (typeof prompt !== 'string') return null;
  const m = prompt.trim().match(RE);
  return m ? { kind: m[1], target: m[2] } : null;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const say = (t) => contextEvent('UserPromptSubmit', t);
const status = (a) => a.fm.status || 'draft';
const isPathTarget = (t) => /[\\/]/.test(t) || t.endsWith('.md');
const validSlug = (t) => SLUG_RE.test(t) && !t.includes('..');
const specFeature = (s) => s.fm.feature || featureFromSpecPath(s.path);

// Artifacts whose real path (symlinks resolved) stays inside the real kind dir.
function safeList(root, sub) {
  let realDir;
  try { realDir = realpathSync(join(root, 'docs', 'superpowers', sub)); } catch { return []; }
  return listArtifacts(root, sub).filter((a) => {
    try { return realpathSync(a.path).startsWith(realDir + sep); } catch { return false; }
  });
}

// Lexical path of a path-like target inside <root>/docs/superpowers/<sub>/, or null.
function targetPath(root, sub, target) {
  const dir = resolvePath(root, 'docs', 'superpowers', sub);
  const bare = !/[\\/]/.test(target);
  const abs = bare ? join(dir, target)
    : isAbsolute(target) ? resolvePath(target) : resolvePath(root, target);
  return abs.startsWith(dir + sep) ? abs : null;
}

// All specs matching a target -> {matches} | {err}.
function specMatches(root, target) {
  const list = safeList(root, 'specs');
  if (isPathTarget(target)) {
    const abs = targetPath(root, 'specs', target);
    if (!abs) return { err: `"${target}" is not inside docs/superpowers/specs/. Nothing was written.` };
    return { matches: list.filter((s) => s.path === abs) };
  }
  if (!validSlug(target)) return { err: `Invalid target "${target}": expected a feature slug or a path. Nothing was written.` };
  return { matches: list.filter((s) => specFeature(s) === target) };
}

// The spec a plan points at (inside specs/ only).
function planSpec(root, plan) {
  const ptr = specPointer(plan.body);
  if (!ptr) return null;
  const abs = targetPath(root, 'specs', ptr);
  return abs ? safeList(root, 'specs').find((s) => s.path === abs) || null : null;
}

function planMatchesFeature(root, p, feature) {
  if (p.fm.feature === feature) return true;
  const s = planSpec(root, p);
  if (s) return specFeature(s) === feature;
  const ptr = specPointer(p.body);
  return !p.fm.feature && !!ptr && featureFromSpecPath(ptr) === feature;
}

function planFeature(root, p) {
  if (p.fm.feature) return p.fm.feature;
  const s = planSpec(root, p);
  if (s) return specFeature(s);
  const ptr = specPointer(p.body);
  return ptr ? featureFromSpecPath(ptr) : null;
}

function planMatches(root, target) {
  const list = safeList(root, 'plans');
  if (isPathTarget(target)) {
    const abs = targetPath(root, 'plans', target);
    if (!abs) return { err: `"${target}" is not inside docs/superpowers/plans/. Nothing was written.` };
    return { matches: list.filter((p) => p.path === abs) };
  }
  if (!validSlug(target)) return { err: `Invalid target "${target}": expected a feature slug or a path. Nothing was written.` };
  return { matches: list.filter((p) => planMatchesFeature(root, p, target)) };
}

// Pick the single candidate whose status is allowed -> {item} | {msg}.
function pickOne(res, allowed, kind, target) {
  if (res.err) return { msg: res.err };
  const { matches } = res;
  if (!matches.length) return { msg: `No ${kind} found for "${target}". Nothing was written.` };
  const c = matches.filter((a) => allowed.includes(status(a)));
  if (!c.length) {
    return { msg: `Found ${kind} for "${target}" but its status (${matches.map(status).join(', ')}) is not ${allowed.join(' or ')}. Nothing was written.` };
  }
  if (c.length > 1) {
    return { msg: `More than one ${kind} for "${target}" is ${allowed.join(' or ')}: ${c.map((a) => a.path).join(', ')}. Pass the path of the one you mean. Nothing was written.` };
  }
  return { item: c[0] };
}

function readRef(dir, ref) {
  try {
    const v = readFileSync(join(dir, ref), 'utf8').trim();
    if (/^[0-9a-f]{40,64}$/.test(v)) return v;
  } catch { /* fall through */ }
  try {
    for (const l of readFileSync(join(dir, 'packed-refs'), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([0-9a-f]{40,64}) (.+)$/);
      if (m && m[2] === ref) return m[1];
    }
  } catch { /* none */ }
  return null;
}

function cwdHead(co) {
  try {
    const head = readFileSync(join(co.gitDir, 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*(refs\/.+)$/);
    if (!m) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
    return readRef(co.commonDir, m[1]) || readRef(co.gitDir, m[1]);
  } catch {
    return null;
  }
}

function approveFile(path, extra) {
  writeFrontmatterFields(path, { status: 'approved', approved: today(), ...extra });
}

function doSpec(root, target) {
  const r = pickOne(specMatches(root, target), ['draft'], 'spec', target);
  if (r.msg) return r.msg;
  const feature = specFeature(r.item);
  approveFile(r.item.path, { kind: 'spec', feature });
  return `sdd: spec "${feature}" approved (${today()}).`;
}

function doPlan(root, target) {
  const r = pickOne(planMatches(root, target), ['draft'], 'plan', target);
  if (r.msg) return r.msg;
  const p = r.item;
  const feature = planFeature(root, p) || target;
  const s = planSpec(root, p);
  if (!s || status(s) !== 'approved') {
    return `Plan "${feature}" not approved: its spec is not approved (or its **Spec:** pointer does not resolve). Run /sdd:approve spec ${feature} first. Nothing was written.`;
  }
  const fields = { kind: 'plan' };
  if (!p.fm.feature) fields.feature = feature;
  approveFile(p.path, fields);
  return `sdd: plan "${feature}" approved (${today()}).`;
}

function doReview(co, input, target) {
  if (!validSlug(target)) return `Review approval refused: invalid feature "${target}" (a plain slug is required). Nothing was written.`;
  const dir = approvalsDir(co.commonDir);
  let report = null;
  try { report = JSON.parse(readFileSync(join(dir, `${target}.report.json`), 'utf8')); } catch { /* refused below */ }
  if (!report || typeof report !== 'object' || report.outcome !== 'go' || report.drift_outcome !== 'go') {
    return `Review approval for "${target}" refused: no readable ${target}.report.json with outcome go and drift_outcome go. Run the review command first.`;
  }
  const plans = planMatches(co.root, target).matches || [];
  const live = plans.filter((p) => status(p) === 'approved');
  let head = null;
  if (live.length === 1 && live[0].fm.branch) head = readRef(co.commonDir, `refs/heads/${live[0].fm.branch}`);
  if (!head) head = cwdHead(co);
  mkdirSync(dir, { recursive: true });
  writeFileSync(reviewRecordPath(co.commonDir, target), JSON.stringify({
    feature: target, date: today(), session_id: input.session_id ?? null, head,
  }, null, 2) + '\n');
  return `sdd: review for "${target}" approved (${today()}).`;
}

function doDone(root, target) {
  const sr = pickOne(specMatches(root, target), ['approved'], 'spec', target);
  if (sr.msg) return sr.msg;
  const feature = specFeature(sr.item);
  const pr = pickOne(planMatches(root, feature), ['approved'], 'plan', feature);
  if (pr.msg) return pr.msg;
  writeFrontmatterFields(sr.item.path, { status: 'implemented' });
  writeFrontmatterFields(pr.item.path, { status: 'done' });
  return `sdd: "${feature}": spec implemented, plan done.`;
}

function main() {
  const input = readInput();
  if (!input) return;
  const parsed = parseApproval(input.prompt);
  if (!parsed) return;
  const co = mainCheckout(input.cwd || process.cwd());
  if (!co || !loadConfig(co.root)) {
    say('sdd is not initialised here (no .sdd/config.json at the main checkout); nothing was approved. Run /sdd-init first.');
    return;
  }
  let msg;
  try {
    if (parsed.kind === 'spec') msg = doSpec(co.root, parsed.target);
    else if (parsed.kind === 'plan') msg = doPlan(co.root, parsed.target);
    else if (parsed.kind === 'review') msg = doReview(co, input, parsed.target);
    else msg = doDone(co.root, parsed.target);
  } catch (e) {
    msg = `sdd approve ${parsed.kind} ${parsed.target} failed: ${e && e.message ? e.message : e}. Nothing further was written.`;
  }
  say(msg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail open */ }
  process.exit(0);
}
