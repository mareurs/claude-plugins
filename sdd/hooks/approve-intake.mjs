#!/usr/bin/env node
// UserPromptSubmit hook: the user-only approval channel. The model cannot trigger
// UserPromptSubmit, so a `/sdd:approve <kind> <target>` that reaches here was typed
// by the user. This hook itself writes the approval (spec/plan frontmatter, or the
// review record); the PreToolUse guards deny tools that try to write the same fields.
// No codescout call and no git spawn: fast, and works without the binary.
//
//   spec <path|feature>   status: approved, approved: <today>, kind, feature
//   plan <feature>        same, refused unless the plan's spec is approved
//   review <feature>      record {feature,date,session_id,head}; needs report go/go
//   done <feature>        spec -> implemented, plan -> done

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInput, contextEvent, mainCheckout, loadConfig, readFrontmatter,
  writeFrontmatterFields, listArtifacts, specPointer, approvalsDir, featureFromSpecPath,
} from './lib.mjs';
import { reviewRecordPath } from './review-guard.mjs';

const RE = /^(?:\/sdd:approve|\/approve|sdd approve)[ \t]+(spec|plan|review|done)[ \t]+(\S+)$/;

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
const specFeature = (s) => s.fm.feature || featureFromSpecPath(s.path);

function underDir(root, sub, p) {
  const dir = resolvePath(root, 'docs', 'superpowers', sub);
  const abs = isAbsolute(p) ? resolvePath(p) : resolvePath(root, p);
  return abs.startsWith(dir + sep) ? abs : null;
}

function findArtifact(root, sub, target) {
  const list = listArtifacts(root, sub);
  if (/[\\/]/.test(target) || target.endsWith('.md')) {
    const abs = underDir(root, sub, target);
    return abs ? list.find((a) => a.path === abs) || null : null;
  }
  if (sub === 'specs') return list.find((s) => specFeature(s) === target) || null;
  return null;
}

// The spec a plan points at (inside specs/ only), as a listed artifact.
function planSpec(root, plan) {
  const ptr = specPointer(plan.body);
  if (!ptr) return null;
  const abs = underDir(root, 'specs', ptr);
  return abs ? listArtifacts(root, 'specs').find((s) => s.path === abs) || null : null;
}

function findPlan(root, feature) {
  const plans = listArtifacts(root, 'plans');
  const own = plans.find((p) => p.fm.feature === feature);
  if (own) return own;
  return plans.find((p) => {
    const s = planSpec(root, p);
    if (s) return specFeature(s) === feature;
    const ptr = specPointer(p.body);
    return !p.fm.feature && ptr && featureFromSpecPath(ptr) === feature;
  }) || null;
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

function branchTip(commonDir, b) {
  return readRef(commonDir, `refs/heads/${b}`);
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
  const s = findArtifact(root, 'specs', target);
  if (!s) return `No spec found for "${target}" under docs/superpowers/specs/. Nothing was approved.`;
  const feature = specFeature(s);
  approveFile(s.path, { kind: 'spec', feature });
  return `sdd: spec "${feature}" approved (${today()}).`;
}

function doPlan(root, target) {
  const p = findPlan(root, target);
  if (!p) return `No plan found for feature "${target}" under docs/superpowers/plans/. Nothing was approved.`;
  const s = planSpec(root, p);
  if (!s || s.fm.status !== 'approved') {
    return `Plan for "${target}" not approved: its spec is not approved (or its **Spec:** pointer does not resolve). Run /sdd:approve spec ${target} first.`;
  }
  const fields = { kind: 'plan' };
  if (!p.fm.feature) fields.feature = target;
  approveFile(p.path, fields);
  return `sdd: plan "${target}" approved (${today()}).`;
}

function doReview(co, input, target) {
  const dir = approvalsDir(co.commonDir);
  let report = null;
  try { report = JSON.parse(readFileSync(join(dir, `${target}.report.json`), 'utf8')); } catch { /* refused below */ }
  if (!report || typeof report !== 'object' || report.outcome !== 'go' || report.drift_outcome !== 'go') {
    return `Review approval for "${target}" refused: no readable ${target}.report.json with outcome go and drift_outcome go. Run the review command first.`;
  }
  const plan = findPlan(co.root, target);
  let head = null;
  if (plan && plan.fm.branch) head = branchTip(co.commonDir, plan.fm.branch);
  if (!head) {
    const cwdCo = mainCheckout(input.cwd || process.cwd()) || co;
    head = cwdHead(cwdCo);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(reviewRecordPath(co.commonDir, target), JSON.stringify({
    feature: target, date: today(), session_id: input.session_id ?? null, head,
  }, null, 2) + '\n');
  return `sdd: review for "${target}" approved (${today()}).`;
}

function doDone(root, target) {
  const s = findArtifact(root, 'specs', target);
  const p = findPlan(root, target);
  if (!s && !p) return `Nothing to finish: no spec or plan found for "${target}".`;
  const done = [];
  if (s) { writeFrontmatterFields(s.path, { status: 'implemented' }); done.push('spec implemented'); }
  if (p) { writeFrontmatterFields(p.path, { status: 'done' }); done.push('plan done'); }
  return `sdd: "${target}": ${done.join(', ')}.`;
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
