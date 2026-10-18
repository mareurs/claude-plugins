// evidence.mjs — the effort-toggle run evidence: what one run's transcript and mod log say about the run.
//
//   mainRequests(transcriptText)  -> { index, messageId, effort, toolUses: { name, input }[] }[]   the main loop's requests
//   secondUserTurn(transcriptText) -> boolean   a user record that holds text after the first assistant record (spec C7)
//   firstEditIndex(transcriptText) -> number | null   the first request that edits a file
//   checkRun({ transcriptText, modLogText, mod, startEffort, timedOut })
//       -> { reasons, requests, shareXhigh, upSwitches, calls, callLog, secondTurn, broadAt, audit }
//
// Requests. Claude Code splits one API message over several assistant records that share a `message.id` (a thinking block in
// one, text or tool_use in a later one). mainRequests counts each id once, in first-appearance order from index 0, and gathers
// the tool uses over ALL records of the id (a tool_use id seen twice counts once). The request's `effort` is the top-level
// `effort` of the record with the LARGEST usage.output_tokens, the later one on a tie (the rule usage.mjs applies to usage, since
// early records can be partial); a missing or non-string effort is null. The records that count are S4's filter minus its
// usage requirement: not an API-error record (isApiErrorMessage, or model "<synthetic>"), a non-empty string message.id, role
// assistant or none, and not a sidechain record (isSidechain true is a subagent step, which the mod logs with request null). A torn
// line, a non-object line and a record with no `message` are skipped. `type: 'user'` records are never requests.
//
// secondUserTurn: a `type: 'user'` record after the first `type: 'assistant'` record whose content is a non-blank string or has
// a `text` block that is not blank. A user record of only `tool_result` blocks is not a turn.
//
// firstEditIndex: the first request with an Edit, Write or MultiEdit tool use, or a Bash command that holds `sed -i` (also
// `-i.bak`, `-ni`, `--in-place`), `cat >` or `cat >>` into a file (not /dev/null, not `2>&1`), `tee `, or a heredoc whose body
// calls `.write(`. Text rules over the command, as the plan states them: `grep "tee " f` or `cargo test | tee log` hit too.
//
// checkRun (rulings P2, P3, P20; P20 supersedes P1). The mod's log is JSONL (spikes/toggle/mod/hooks/register.ts): `step` lines (main requests carry
// `request` 0, 1, 2, ..., subagent steps `request: null`), `call`, `invalid` and `error` lines. `reasons`, in this order:
//   no_mod_log                the log is absent, null or blank; no other log check is made then
//   mod_error                 the log holds an `error` line
//   log_transcript_mismatch   a log line is not a JSON object (a torn line), or the log's main `step` lines (request not null)
//                             differ in count from mainRequests, or a main step's `request` is not its position, or its `after` is
//                             not a string equal to that request's transcript effort, or its `before` is neither a string nor null.
//                             A non-string effort in the log or in the transcript is therefore a mismatch.
//                             Ruling P27, `timedOut` true (the run was killed by the wall clock; optional, default false): exactly one
//                             extra TRAILING main step is no mismatch. The mod writes its step line before the request is sent and the
//                             transcript records the message when the response returns, so a kill mid-request leaves one line over.
//                             The first N steps (N = main requests) are checked as for any run, the extra step must be request N with
//                             a string `after` and a `before` that is a string or null; two or more extra steps, an extra step before
//                             the last one, a torn line and every other disagreement stay a mismatch. Only `timedOut === true` counts.
//   arm_mismatch              only when `mod` (the arm's registered mod: { mode, schedule? | random? }) is given and the log has a
//                             `step` line for a main request: the first main step's `before` is not `startEffort` (the arm's CLI
//                             effort), or a main step i's `after` is not the level the arm's mod must send (P20), over ALL the log's
//                             main steps, the P27 trailing step included (the mod's rule holds for the step it sent):
//                               schedule  schedule[min(i, length - 1)]
//                               placebo   `before` (the mod rewrites nothing), and `before` is `startEffort`
//                               toggle    the level of the last `call` line with `request < i` (the call made in the response to
//                                         request r, logged with request r, first applies to request r + 1), else `startEffort`
//                               random    randomLevels(pUp, pDown, seed, turnId of the first main step, n)[i], the mod's own chain
//                             A malformed `mod` or `startEffort` is a mismatch too. With `mod` null or absent (a reused row with no
//                             mod) none of this is checked. Order: log reasons, then arm_mismatch, then audit.
//   audit                     some tool use gave auditHits (the blinding audit); `audit` lists { request, tool, hits }
// `requests` is the number of main requests; `shareXhigh` the share of them whose transcript effort is 'xhigh' (0 when there are
// none); `upSwitches` the number of consecutive pairs of main requests going 'low' -> 'xhigh' in the transcript; `calls` the number
// of `call` lines and `callLog` those lines as [{ request, level, reason }]; `broadAt` the indices of the requests holding a Bash
// command that isBroadCheck. The log/transcript checks are the same in every mode; the arm check is what ties the run to its arm.
// Extra log fields (index, agentId, text) are ignored. checkRun never throws on any text, including empty, torn or non-string input.
//
// Pure functions over strings: no I/O. Never calls a model.

import { auditHits, isBroadCheck } from './commands.mjs';
import { randomLevels } from './mod/hooks/register.ts';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
// A usable count, the same test s4-rows.mjs and usage.mjs apply.
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

// Every JSON line that is an object, in file order. A torn, blank or non-object line is skipped; `skipped` counts the non-blank
// lines that were not objects. Anything but a string is read as the empty text.
function parseJsonl(text) {
  const out = [];
  let skipped = 0;
  for (const line of isString(text) ? text.split('\n') : []) {
    if (line.trim() === '') continue;
    try {
      const v = JSON.parse(line);
      if (isObject(v)) out.push(v);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { records: out, skipped };
}

const isApiError = (obj) => obj.isApiErrorMessage === true || (isObject(obj.message) && obj.message.model === '<synthetic>');

// ---- requests -----------------------------------------------------------------------------------------------------------

// The tool_use blocks of a message's content, as { id, name, input }; a block without a string name is not one.
function toolUseBlocks(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (isObject(b) && b.type === 'tool_use' && isString(b.name)) out.push({ id: isString(b.id) ? b.id : null, name: b.name, input: isObject(b.input) ? b.input : {} });
  }
  return out;
}

export function mainRequests(transcriptText) {
  const byId = new Map();
  const out = [];
  for (const obj of parseJsonl(transcriptText).records) {
    if (obj.type !== undefined && obj.type !== 'assistant') continue;
    if (isApiError(obj) || obj.isSidechain === true) continue;
    const msg = obj.message;
    if (!isObject(msg) || !isString(msg.id) || msg.id === '') continue;
    if (msg.role !== undefined && msg.role !== 'assistant') continue;
    let req = byId.get(msg.id);
    if (req === undefined) {
      req = { index: out.length, messageId: msg.id, effort: null, toolUses: [], bestOut: -1, seenUse: new Set() };
      byId.set(msg.id, req);
      out.push(req);
    }
    const outTokens = count(isObject(msg.usage) ? msg.usage.output_tokens : undefined);
    if (outTokens >= req.bestOut) {
      req.bestOut = outTokens;
      req.effort = isString(obj.effort) ? obj.effort : null;
    }
    for (const { id, name, input } of toolUseBlocks(msg.content)) {
      if (id !== null) {
        if (req.seenUse.has(id)) continue;
        req.seenUse.add(id);
      }
      req.toolUses.push({ name, input });
    }
  }
  return out.map(({ index, messageId, effort, toolUses }) => ({ index, messageId, effort, toolUses }));
}

// ---- second turn --------------------------------------------------------------------------------------------------------

const holdsText = (content) =>
  isString(content)
    ? content.trim() !== ''
    : Array.isArray(content) && content.some((b) => isObject(b) && b.type === 'text' && isString(b.text) && b.text.trim() !== '');

export function secondUserTurn(transcriptText) {
  let seenAssistant = false;
  for (const obj of parseJsonl(transcriptText).records) {
    if (obj.type === 'assistant') seenAssistant = true;
    else if (obj.type === 'user' && seenAssistant && isObject(obj.message) && holdsText(obj.message.content)) return true;
  }
  return false;
}

// ---- first edit ---------------------------------------------------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
// `sed` with a cluster of short flags holding i (-i, -i.bak, -ni, -Ei) or --in-place, in the same simple command.
const SED_INPLACE = /\bsed\b[^\n|;&]*?\s(?:-[A-Za-z]*i|--in-place)/;
// `cat` with a redirection into a file: not `2>/dev/null`, `>&2` (removed first) or `> /dev/null`.
const CAT_REDIRECT = /\bcat\b[^\n|;&]*?(?<![0-9&])>>?(?!\s*\/dev\/null)/;
const TEE = /(?<![\w./-])tee\s/;
const HEREDOC = /<<-?\s*(['"]?)\\?[A-Za-z_]\w*\1/;

function bashEdits(command) {
  const c = command.replace(/\d*>&\d*-?/g, ' '); // `2>&1`, `>&2`: descriptor copies, not file writes
  if (SED_INPLACE.test(c) || CAT_REDIRECT.test(c) || TEE.test(c)) return true;
  const h = HEREDOC.exec(c);
  return h !== null && c.slice(h.index + h[0].length).includes('.write(');
}

const isEdit = (u) => EDIT_TOOLS.has(u.name) || (u.name === 'Bash' && isString(u.input.command) && bashEdits(u.input.command));

export function firstEditIndex(transcriptText) {
  const hit = mainRequests(transcriptText).find((r) => r.toolUses.some(isEdit));
  return hit === undefined ? null : hit.index;
}

// ---- checkRun -----------------------------------------------------------------------------------------------------------

// Whether the log's main steps disagree with the transcript's main requests. With `timedOut` (P27) the log may hold exactly ONE
// main step more than the transcript has requests, as the LAST main step: the mod writes a step line before it sends the request, the
// transcript records the message only when the response returns, so a wall-clock kill mid-request leaves that one line over. That
// trailing step must be well formed (request number N, a string `after`, `before` a string or null); the first N steps are checked
// exactly as for any run. Two or more extra steps, an extra step anywhere else and a torn line stay a mismatch.
function logMismatch(mainSteps, reqs, skippedLines, timedOut) {
  if (skippedLines > 0) return true;
  let steps = mainSteps;
  if (timedOut === true && mainSteps.length === reqs.length + 1) {
    const last = mainSteps[reqs.length];
    if (last.request !== reqs.length || !isString(last.after) || !(isString(last.before) || last.before === null)) return true;
    steps = mainSteps.slice(0, reqs.length);
  }
  if (steps.length !== reqs.length) return true;
  return steps.some((s, i) => s.request !== i || !isString(s.after) || s.after !== reqs[i].effort || !(isString(s.before) || s.before === null));
}

const isLevel = (v) => v === 'low' || v === 'xhigh';
const isProb = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

// Ruling P20: whether the log's main steps differ from what the arm's `mod` must send, starting at `startEffort`. `records` are all
// the log's objects (the `call` lines drive the toggle), `mainSteps` its main `step` lines in order.
function armMismatch(mod, startEffort, mainSteps, records) {
  if (!isObject(mod) || !isLevel(startEffort)) return true;
  if (mainSteps.length === 0) return false;
  if (mainSteps[0].before !== startEffort) return true;
  let expected; // the level main step i must send, or null for "after must equal before and before the start effort"
  if (mod.mode === 'schedule') {
    const s = mod.schedule;
    if (!Array.isArray(s) || s.length === 0 || !s.every(isLevel)) return true;
    expected = (i) => s[Math.min(i, s.length - 1)];
  } else if (mod.mode === 'placebo') {
    return mainSteps.some((st) => st.after !== st.before || st.before !== startEffort);
  } else if (mod.mode === 'toggle') {
    const calls = records.filter((e) => e.type === 'call' && isLevel(e.level) && typeof e.request === 'number');
    expected = (i) => {
      let level = startEffort;
      for (const c of calls) if (c.request < i) level = c.level;
      return level;
    };
  } else if (mod.mode === 'random') {
    const r = mod.random;
    const turnId = mainSteps[0].turnId;
    if (!isObject(r) || !isProb(r.pUp) || !isProb(r.pDown) || !Number.isSafeInteger(r.seed) || !isString(turnId)) return true;
    const levels = randomLevels(r.pUp, r.pDown, r.seed, turnId, mainSteps.length);
    expected = (i) => levels[i];
  } else {
    return true;
  }
  return mainSteps.some((st, i) => st.after !== expected(i));
}

export function checkRun(args) {
  const { transcriptText, modLogText, mod, startEffort, timedOut } = isObject(args) ? args : {};
  const reqs = mainRequests(transcriptText);
  const reasons = [];
  let calls = 0;
  let callLog = [];
  let armBad = false;

  if (!isString(modLogText) || modLogText.trim() === '') {
    reasons.push('no_mod_log');
  } else {
    const { records, skipped } = parseJsonl(modLogText);
    const callLines = records.filter((e) => e.type === 'call');
    calls = callLines.length;
    callLog = callLines.map((e) => ({ request: e.request, level: e.level, reason: e.reason }));
    if (records.some((e) => e.type === 'error')) reasons.push('mod_error');
    const mainSteps = records.filter((e) => e.type === 'step' && e.request !== null);
    if (logMismatch(mainSteps, reqs, skipped, timedOut)) reasons.push('log_transcript_mismatch');
    if (mod !== undefined && mod !== null) armBad = armMismatch(mod, startEffort, mainSteps, records);
  }
  if (armBad) reasons.push('arm_mismatch');

  const audit = [];
  const broadAt = [];
  for (const r of reqs) {
    for (const u of r.toolUses) {
      const hits = auditHits(u.name, u.input);
      if (hits.length > 0) audit.push({ request: r.index, tool: u.name, hits });
    }
    if (r.toolUses.some((u) => u.name === 'Bash' && isString(u.input.command) && isBroadCheck(u.input.command))) broadAt.push(r.index);
  }
  if (audit.length > 0) reasons.push('audit');

  let upSwitches = 0;
  for (let i = 1; i < reqs.length; i += 1) if (reqs[i - 1].effort === 'low' && reqs[i].effort === 'xhigh') upSwitches += 1;
  const xhigh = reqs.filter((r) => r.effort === 'xhigh').length;

  return {
    reasons,
    requests: reqs.length,
    shareXhigh: reqs.length === 0 ? 0 : xhigh / reqs.length,
    upSwitches,
    calls,
    callLog,
    secondTurn: secondUserTurn(transcriptText),
    broadAt,
    audit,
  };
}
