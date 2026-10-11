// plan-limit.mjs — the detector for a spent Claude subscription, shared by the S5 batch (s5/run.mjs) and the S4 run (s4-run.mjs). Pure: no file,
// no clock, no network, no model. Rulings R-PL1 and R-PL2 (R-PL3..R-PL8 are the consumers' and live in their headers).
//
// WHY. `claude -p` on a subscription whose plan usage is spent does not fail in a way a harness notices: the CLI prints a refusal such as
// `You've hit your limit · resets 3pm` and, in at least one reported case (prompt-engineering OP-11, 2026-08-21), returns it as the ordinary
// response. A trial harness then grades the refusal as a model failure. In the S5 study the xhigh arms burn the most plan usage, so a limit hit
// would fabricate a loss for exactly the arms under test. A hit is a STOP, not a result.
//
// R-PL1. Pure and total. `detectPlanLimit` never throws, whatever it is given (undefined, null, a number, an array, a Buffer, a torn transcript):
// a field of the wrong type is simply no hit. `assertNoPlanLimit` is the throwing form (`PlanLimitError`, with the verdict in `.hit`).
//
// R-PL2. A TEXT channel matches only when its text, after trimming LEADING whitespace, is at most MAX_REFUSAL_CHARS (600) characters AND starts
// (index 0, no multiline flag) with one of the five anchored patterns below. Agent prose that merely mentions a limit, a refusal quoted in the
// middle of a paragraph, and a long answer that happens to begin with one all miss. Trailing whitespace is not trimmed, so it counts toward the cap.
//
// THE FIVE PATTERNS (case-sensitive; ASCII ' and the typographic ’). They cover the message family the CLI builds in versions 2.1.292 and 2.1.296:
//   1. /^You['’]ve hit your /                        `You've hit your ${limitName}${suffix}`; limit names seen: limit, usage limit, fast limit,
//                                                    monthly spend limit, org's monthly spend limit, channel's monthly spend limit, team's shared
//                                                    budget, session limit, weekly limit; suffixes seen: ` · resets 3pm`, ` · raise it at …`,
//                                                    ` · progress saved`
//   2. /^You['’]ve reached your [^\n]{0,60}? limit/  `You've reached your Fable limit`
//   3. /^You['’]re out of (?:extra usage|usage credits)/
//   4. /^Your org(?:anization)? is out of usage/     `Your org is out of usage · contact your admin`, `Your organization is out of usage credits. …`
//   5. /^Usage limit reached/                        also `Usage limit reached again · continuing automatically …`
// NEVER matched (each has its own test): `Approaching your 5-hour usage limit — Claude will wrap up the current step.` (a warning),
// `Server is temporarily limiting requests (not your usage limit)` (a transient, retryable overload; 80 such records exist in the operator's own
// transcripts), `Context limit reached`, `Fable limit reached · continuing on …` and `Fast limit reached and temporarily disabled …` (notices:
// the CLI continues), and `Failed to authenticate. API Error: 401 Invalid bearer token` (an authentication failure: it stays infrastructure
// `api_error` in S5).
//
// THE CHANNELS, in this order, first hit wins:
//   (1) envelope.api_error === 'usage_limit_reached'  the typed field of the CLI's SDK schema. Needs neither the anchor nor the cap: the type is
//                                                     authoritative. If the envelope also has a non-blank `result` string, that text (cut to
//                                                     200 characters) is `matched`; otherwise `matched` is 'usage_limit_reached'.
//   (2) envelope.result   when a string               (3) stdout   (4) stderr   (5) the text of the LAST assistant record of the transcript
// `envelope` must be a plain object (a string or an array is ignored). No channel depends on `is_error`: the verified API-error envelope has
// `is_error: true` but also `subtype: "success"`, and a refusal can come back as an ordinary `is_error: false` result.
//
// THE HIT. { source, matched, resetHint, rateLimitType, resetsAt }.
//   source         'envelope_api_error' | 'envelope_result' | 'stdout' | 'stderr' | 'transcript'
//   matched        the candidate text after the leading whitespace, cut to 200 characters (a consumer redacts a token before it stores it)
//   resetHint      the first match of /\bresets?\b[^\n]{0,80}/ in `matched` (case-sensitive; so at most 80 characters follow the word), else null
//   rateLimitType  envelope.api_error_params.rate_limit_info.rateLimitType when it is a member of RATE_LIMIT_TYPES, else null
//   resetsAt       the same object's resetsAt when it is a finite number, else null (each field is judged on its own; the unit is not verified)
// The two rate-limit fields come from the envelope whatever channel hit; with no envelope they are null.
//
// The last assistant record (`lastAssistantRecordText`) is read here on purpose, API-error records INCLUDED. s5/usage.mjs `assistantBlocks` skips
// them (it counts usage), so the final text it shows never contains a refusal; this module must not reuse it.
//
// VERIFIED, from real bytes (the CLI binary, string extraction in s5-work/briefs/limit-strings-*.txt; a real transcript record):
//   - the message texts above, in 2.1.292 and 2.1.296 (only the minified variable names differ between them);
//   - the typed `api_error` kind `usage_limit_reached`, with `api_error_params.rate_limit_info` (`rateLimitType` in five_hour, seven_day,
//     seven_day_opus, seven_day_sonnet, seven_day_overage_included, overage; `resetsAt`) in the SDK schema strings;
//   - the shape of a transcript API-error record (the 401 record in the tests): type assistant, isSidechain false, isApiErrorMessage true,
//     error "authentication_failed", apiErrorStatus 401, message.model "<synthetic>", message.content [{type:'text', text}].
// NOT VERIFIED, and every test that builds one says SYNTHETIC or RECONSTRUCTED:
//   - the envelope and the transcript of a REAL plan-limit hit (none exists on this host); that one has `error: "rate_limit"` is a guess;
//   - that `--output-format json` puts `api_error` / `api_error_params` on the result envelope: the typed channel is an optional extra, used when
//     present and never required;
//   - that in plain `-p` text mode the refusal goes to stdout and not stderr (both are read).
// KNOWN GAPS, read from the same binary and not matched by the five patterns, so a harness that meets one still grades it as a model failure:
//   `Your seat type doesn't include extra usage` (in the CLI's own list of limit prefixes) and `<Fable|Haiku|Mythos|Opus|Sonnet>[ …] requires usage
//   credits.` (a regex the CLI keeps beside that list), and `You've reached your limit` with no qualifier (pattern 2 needs a word between "your"
//   and " limit"; the binary has no such text). Add a pattern AND a test for one of them if a batch should stop on it.
//
// RE-VERIFY A CLI VERSION before adding it to VERIFIED_CLI_VERSIONS (read-only; never run the binary to do it, and never with a real token):
//   grep -a -o -E "(You've hit your|You've reached your|You're out of (extra usage|usage credits)|Your org(anization)? is out of usage|Usage limit reached).{0,80}" \
//     ~/.local/share/claude/versions/<version> | cat -v
// and check that every message the five patterns rely on is still there. Then add the version string to VERIFIED_CLI_VERSIONS below.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The CLI versions whose refusal texts were read (see RE-VERIFY above). S5's batchPreflight refuses a registration for any other version.
export const VERIFIED_CLI_VERSIONS = ['2.1.292', '2.1.296'];

// R-PL2: the longest text (after the leading whitespace) that can be a refusal.
export const MAX_REFUSAL_CHARS = 600;

// The `rateLimitType` values of the CLI's SDK schema (api_error_params.rate_limit_info).
export const RATE_LIMIT_TYPES = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'];

// How much of the matched text a Hit keeps, and the reset phrase in it.
const MATCHED_CHARS = 200;
const RESET_HINT = /\bresets?\b[^\n]{0,80}/;

// R-PL2: no `g`, `y` or `m` flag on any of these (a stateful or line-anchored regex would change the verdict).
const REFUSAL_PATTERNS = [
  /^You['’]ve hit your /,
  /^You['’]ve reached your [^\n]{0,60}? limit/,
  /^You['’]re out of (?:extra usage|usage credits)/,
  /^Your org(?:anization)? is out of usage/,
  /^Usage limit reached/,
];

export class PlanLimitError extends Error {
  constructor(hit) {
    super(`plan limit: ${hit.source}: ${hit.matched}`);
    this.name = 'PlanLimitError';
    this.hit = hit;
  }
}

// The text of a content value: a string as it is, or the `text` of every {type:'text'} block joined with a newline; null when there is none.
function contentText(content) {
  if (typeof content === 'string') return content === '' ? null : content;
  if (!Array.isArray(content)) return null;
  const joined = content.filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return joined === '' ? null : joined;
}

// The text of the LAST main-chain assistant record of a transcript (JSONL), API-error records included; null when there is none or it has no
// text. A blank, torn or non-JSON line (JSON.parse of a blank line throws like any other), and a JSON value that is no record, is skipped. The
// last assistant record decides: an earlier one is not consulted when the last has no text. Read from the end, so only the tail of a long
// transcript is parsed.
export function lastAssistantRecordText(transcriptText) {
  if (typeof transcriptText !== 'string') return null;
  const lines = transcriptText.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let record;
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!isObject(record) || record.type !== 'assistant' || record.isSidechain === true) continue;
    return contentText(isObject(record.message) ? record.message.content : undefined);
  }
  return null;
}

// R-PL2: the candidate after its leading whitespace when it is a refusal (a string, at most MAX_REFUSAL_CHARS, anchored); else null.
function refusalText(candidate) {
  if (typeof candidate !== 'string') return null;
  const text = candidate.trimStart();
  if (text.length > MAX_REFUSAL_CHARS) return null;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text)) ? text : null;
}

// { rateLimitType, resetsAt } of the envelope's api_error_params.rate_limit_info, each field null unless well formed.
function rateLimitInfo(envelope) {
  const info = envelope !== null && isObject(envelope.api_error_params) ? envelope.api_error_params.rate_limit_info : null;
  if (!isObject(info)) return { rateLimitType: null, resetsAt: null };
  return {
    rateLimitType: RATE_LIMIT_TYPES.includes(info.rateLimitType) ? info.rateLimitType : null,
    resetsAt: typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt) ? info.resetsAt : null,
  };
}

function hitOf(source, text, envelope) {
  const matched = text.slice(0, MATCHED_CHARS);
  const reset = RESET_HINT.exec(matched);
  return { source, matched, resetHint: reset === null ? null : reset[0], ...rateLimitInfo(envelope) };
}

// null, or the Hit of the first channel that carries a refusal. Never throws (R-PL1).
export function detectPlanLimit(input) {
  const { envelope: rawEnvelope, stdout, stderr, transcript } = isObject(input) ? input : {};
  const envelope = isObject(rawEnvelope) ? rawEnvelope : null;

  if (envelope !== null && envelope.api_error === 'usage_limit_reached') {
    const text = typeof envelope.result === 'string' ? envelope.result.trimStart() : '';
    return hitOf('envelope_api_error', text === '' ? 'usage_limit_reached' : text, envelope);
  }

  // Lazy, so the transcript is parsed only when no earlier channel decided.
  const channels = [
    ['envelope_result', () => envelope?.result],
    ['stdout', () => stdout],
    ['stderr', () => stderr],
    ['transcript', () => lastAssistantRecordText(transcript)],
  ];
  for (const [source, candidate] of channels) {
    const text = refusalText(candidate());
    if (text !== null) return hitOf(source, text, envelope);
  }
  return null;
}

// Returns undefined when no channel carries a refusal; throws PlanLimitError (verdict in `.hit`) when one does.
export function assertNoPlanLimit(input) {
  const hit = detectPlanLimit(input);
  if (hit !== null) throw new PlanLimitError(hit);
}
