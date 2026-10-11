// plan-limit.test.mjs — plan-limit.mjs, the detector for a spent Claude subscription (rulings R-PL1, R-PL2). S5 and S4 both stand on it; their own
// suites pin the use, this one pins the rule itself. Each test names the rule it protects: delete that rule from the module and the test fails.
//
// Provenance of the strings below. The message texts come from the CLI binary (versions 2.1.292 and 2.1.296; limit-strings-*.txt): where the
// binary has a template (`You've hit your ${limitName}${suffix}`) the placeholder is replaced by a value the binary lists. The twelve prefixes in
// CLI_CLASSIFIER_PREFIXES are the CLI's own list (AMENDMENT A1), copied byte for byte from the binary. The 401 record is a real
// transcript record. The 401 ENVELOPE is reconstructed from the verified field list (no byte capture was kept). A plan-limit envelope or transcript
// record has never been observed on this host: every one built here is SYNTHETIC and says so. That includes every wrap-up note record: that the
// transcript persists `usageLimitNote`, and where the CLI delivers the `[Usage limit reached ...` marker, is NOT verified.
import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import {
  MAX_REFUSAL_CHARS,
  PlanLimitError,
  RATE_LIMIT_TYPES,
  VERIFIED_CLI_VERSIONS,
  assertNoPlanLimit,
  detectPlanLimit,
  lastAssistantRecordText,
  usageLimitNoteIn,
} from './plan-limit.mjs';

// A REAL transcript API-error record (an authentication failure with a bad token, CLI 2.1.296): copied verbatim from
// s5-work/briefs/fixtures/api-error-401-record.jsonl.
const API_ERROR_401_RECORD = '{"parentUuid":"a73e0f88-5c71-4658-abb0-13bb672de03f","isSidechain":false,"type":"assistant","uuid":"44839b2f-779a-40da-8a0e-dbcd765ac5cf","timestamp":"2026-10-11T05:35:21.433Z","message":{"diagnostics":null,"id":"21cc1886-e3b0-4555-9551-b2d4b48bc7b8","container":null,"model":"<synthetic>","role":"assistant","stop_details":null,"stop_reason":"stop_sequence","stop_sequence":"","type":"message","usage":{"output_tokens_details":null,"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":null,"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":null,"iterations":null,"speed":null,"fallback_credit":null},"content":[{"type":"text","text":"Failed to authenticate. API Error: 401 Invalid bearer token"}],"context_management":null},"requestId":"req_011CfuuYSJWiccnDZMPtZFgP","error":"authentication_failed","isApiErrorMessage":true,"apiErrorStatus":401,"perTurnEffort":"medium","userType":"external","entrypoint":"sdk-cli","cwd":"/home/marius/work/claude/s5-work/probe-cfg","sessionId":"3607950f-2693-4e23-9061-51071952ef4d","version":"2.1.296","gitBranch":"HEAD"}';
const TEXT_401 = 'Failed to authenticate. API Error: 401 Invalid bearer token';

// SYNTHETIC: the real 401 record with `error: "rate_limit"` and a refusal for its text. That a plan-limit record has this shape is NOT verified.
const REFUSAL = "You've hit your limit · resets 3pm";
const syntheticPlanLimitRecord = (text = REFUSAL) => {
  const record = JSON.parse(API_ERROR_401_RECORD);
  record.error = 'rate_limit';
  record.message.content = [{ type: 'text', text }];
  return record;
};

// Transcript builders.
const jl = (...records) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n');
const assistant = (content, over = {}) => ({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content }, ...over });
const said = (text, over) => assistant([{ type: 'text', text }], over);
const userRec = (text) => ({ type: 'user', isSidechain: false, message: { role: 'user', content: text } });

// SYNTHETIC wrap-up note records (AMENDMENT A1). The marker text is the one the binary builds; that a transcript record carries it, or carries
// `usageLimitNote`, is NOT verified.
const NOTE_TEXT = "[Usage limit reached — grace window active. Wrap up: finish or checkpoint; don't start subagents or long work.]";
const noteUser = (over = {}) => ({ type: 'user', isMeta: true, isSidechain: false, message: { role: 'user', content: NOTE_TEXT }, ...over });
const noteProp = (over = {}) => ({ type: 'user', isMeta: true, isSidechain: false, usageLimitNote: 'wrap_up', message: { role: 'user', content: 'ordinary meta text' }, ...over });
const noteAttachment = (content, over = {}) => ({ type: 'attachment', isSidechain: false, attachment: { type: 'queued_command', content }, ...over });

// RECONSTRUCTED from the verified field list: the envelope of `claude -p --output-format json` on a 401 (no byte capture was kept).
const envelope401 = () => ({
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error_status: 401,
  terminal_reason: 'api_error',
  result: TEXT_401,
  total_cost_usd: 0,
  num_turns: 1,
});

// `pad(prefix, n)`: a text of exactly n characters that starts with prefix.
const pad = (prefix, n) => {
  assert.ok(n >= prefix.length, 'test helper: prefix longer than n');
  return prefix + 'x'.repeat(n - prefix.length);
};

// The channels, each with a way to put `text` into it while the others stay clean prose. `envelope_api_error` is the typed field and
// `transcript_note` the wrap-up note, so their `text` argument is ignored.
const CLEAN_PROSE = 'I fixed the limiter and ran the suite.';
const clean = () => ({
  envelope: { type: 'result', subtype: 'success', is_error: false, result: CLEAN_PROSE },
  stdout: `${CLEAN_PROSE}\n`,
  stderr: '',
  transcript: jl(said(CLEAN_PROSE)),
});
const TEXT_CHANNELS = {
  envelope_result: (text) => ({ ...clean(), envelope: { type: 'result', is_error: true, result: text } }),
  stdout: (text) => ({ ...clean(), stdout: text }),
  stderr: (text) => ({ ...clean(), stderr: text }),
  transcript: (text) => ({ ...clean(), transcript: jl(said('Starting.'), said(text)) }),
};
const ALL_CHANNELS = {
  envelope_api_error: () => ({ ...clean(), envelope: { type: 'result', is_error: true, api_error: 'usage_limit_reached' } }),
  ...TEXT_CHANNELS,
  transcript_note: () => ({ ...clean(), transcript: jl(userRec('fix the bug'), said('Working.'), noteUser(), said(CLEAN_PROSE)) }),
};

const deepFreeze = (v) => {
  if (v !== null && typeof v === 'object') {
    Object.freeze(v);
    Object.values(v).forEach(deepFreeze);
  }
  return v;
};

// ---- the module's constants -------------------------------------------------------------------------------------------------------------

t('exports: MAX_REFUSAL_CHARS is 600 and RATE_LIMIT_TYPES lists the six types the CLI schema names (R-PL2, fact 3)', () => {
  assert.equal(MAX_REFUSAL_CHARS, 600);
  assert.deepEqual(RATE_LIMIT_TYPES, ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage']);
});

t('R-PL7: VERIFIED_CLI_VERSIONS is an array of distinct, non-empty version strings and holds the two versions whose message text was read', () => {
  assert.ok(Array.isArray(VERIFIED_CLI_VERSIONS));
  assert.ok(VERIFIED_CLI_VERSIONS.length >= 2);
  for (const v of VERIFIED_CLI_VERSIONS) {
    assert.equal(typeof v, 'string');
    assert.match(v, /^\d+\.\d+\.\d+$/);
  }
  assert.equal(new Set(VERIFIED_CLI_VERSIONS).size, VERIFIED_CLI_VERSIONS.length, 'no duplicate');
  assert.ok(VERIFIED_CLI_VERSIONS.includes('2.1.292'));
  assert.ok(VERIFIED_CLI_VERSIONS.includes('2.1.296'));
});

// ---- the anchored patterns (R-PL2, AMENDMENT A1) ----------------------------------------------------------------------------------------

// Asserts that each text is a hit on stdout, whole, with the curly apostrophe variant too when `curly`.
const assertHits = (texts, { curly = false } = {}) => {
  for (const text of texts) {
    const variants = curly ? [text, text.replaceAll("'", '’')] : [text];
    for (const variant of variants) {
      const found = detectPlanLimit({ stdout: variant });
      assert.ok(found !== null, `no hit for: ${variant}`);
      assert.equal(found.source, 'stdout');
      assert.equal(found.matched, variant);
    }
  }
};
const assertMisses = (texts) => {
  for (const text of texts) assert.equal(detectPlanLimit({ stdout: text }), null, `unexpected hit for: ${text}`);
};

// The CLI's own classifier of usage-limit messages (AMENDMENT A1): the twelve prefixes it tests with startsWith, in the binary's order. Copied
// byte for byte from the list in 2.1.292 (variable syr) and 2.1.296 (qTr), which are identical; the middle dot is U+00B7. The same classifier has one regex,
// /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^·\n]{1,40})? requires usage credits\./, which the pattern-9 tests cover.
const MIDDLE_DOT = '\u00B7';
const CLI_CLASSIFIER_PREFIXES = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  `Your org is out of usage ${MIDDLE_DOT} add funds to continue`,
  `Your org is out of usage ${MIDDLE_DOT} contact your admin`,
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  'Your usage allocation has been disabled by your admin',
  "Your group's usage limit is set to $0",
  'Fable 5 requires usage credits',
  "You're out of extra usage",
  "Your seat type doesn't include extra usage",
];

// One representative per pattern, used by the anchoring, case and channel tests below.
const SAMPLES = [
  "You've hit your limit · resets 3pm",
  "You've reached your Fable limit.",
  "You're out of usage credits. /model to switch models.",
  'Your organization is out of usage credits. Contact your admin to add more.',
  'Usage limit reached · continuing automatically at 3pm · esc to cancel',
  "Your seat type doesn't include extra usage",
  'Your usage allocation has been disabled by your admin',
  "Your group's usage limit is set to $0",
  'Opus 4.7 requires usage credits.',
  'Fable 5 requires usage credits',
];

t("R-PL2 pattern 1 /^You['’]ve hit your\\b/: the `You've hit your ${limitName}${suffix}` family and the CLI's bare prefix, both apostrophes", () => {
  assertHits([
    "You've hit your", // the CLI's own prefix, with nothing after it
    "You've hit your limit · resets 3pm",
    "You've hit your session limit · resets 3pm",
    "You've hit your weekly limit · resets Mon 9am",
    "You've hit your usage limit · progress saved",
    "You've hit your fast limit · resets in 2h 10m",
    "You've hit your monthly spend limit.",
    "You've hit your org's monthly spend limit · raise it at https://claude.ai/settings/usage",
    "You've hit your channel's monthly spend limit.",
    "You've hit your team's shared budget. /model to switch models.",
  ], { curly: true });
});

t('R-PL2 pattern 1 ends at a word boundary after "your" and needs its apostrophe and its exact words: near misses do not match', () => {
  assertMisses([
    "You've hit yourself with the wrong flag.", // `\b`: "yourself" is another word
    "You've hit yours",
    'You have hit your limit', // the pattern is the contraction
    'Youxve hit your limit', // the apostrophe slot takes only the ASCII and the typographic apostrophe
    "You've hit the limit",
  ]);
});

t("R-PL2 pattern 2 /^You['’]ve reached your\\b/: with a qualifier, without one, or with nothing after \"your\" (the CLI's prefix), both apostrophes", () => {
  assertHits([
    "You've reached your Fable limit",
    "You've reached your Fable limit.",
    "You've reached your limit",
    "You've reached your",
  ], { curly: true });
});

t('R-PL2 pattern 2 ends at a word boundary after "your": another word, another verb or another apostrophe is no refusal', () => {
  assertMisses([
    "You've reached yours",
    "You've reached yourself",
    "You've reach your Fable limit",
    'You reached your limit',
    'Youxve reached your limit',
  ]);
});

t("R-PL2 pattern 3 /^You['’]re out of (?:extra usage|usage credits)/: both alternatives, both apostrophes", () => {
  assertHits([
    "You're out of extra usage",
    "You're out of usage credits",
    "You're out of usage credits. /model to switch models.",
    "You're out of usage credits. Run /usage-credits to keep using Opus or /model to switch models.",
  ], { curly: true });
});

t('R-PL2 pattern 3: only those two alternatives; "out of" anything else is no refusal', () => {
  assertMisses([
    "You're out of disk space.",
    "You're out of usage", // neither alternative: "usage" alone is not enough
    "You're out of extra",
    "You are out of usage credits",
    'Youxre out of usage credits',
  ]);
});

t('R-PL2 pattern 4 /^Your org(?:anization)? is out of usage/: the short and the long form', () => {
  assertHits([
    'Your org is out of usage · contact your admin',
    'Your org is out of usage · add funds to continue',
    'Your organization is out of usage credits. Contact your admin to add more.',
  ]);
});

t('R-PL2 pattern 4: another subject, spelling or phrase is no refusal', () => {
  assertMisses([
    'Your team is out of usage credits.',
    'Your organisation is out of usage credits.',
    'Your org is out of date',
    'Your org was out of usage',
  ]);
});

t('R-PL2 pattern 5 /^Usage limit reached/: the bare text and the suffixed forms the CLI builds', () => {
  assertHits([
    'Usage limit reached',
    'Usage limit reached · continuing automatically at 3pm · esc to cancel',
    'Usage limit reached again · continuing automatically at 3pm · esc to cancel',
    'Usage limit reached · resets 3pm. Workflow paused; waiting agents re-run shortly after the reset.',
  ]);
});

t('R-PL2 pattern 5: "Usage limit" without "reached", and a plural, are no refusal', () => {
  assertMisses(['Usage limit', 'Usage limits reached', 'Usage limit was reached']);
});

t("A1 pattern 6 /^Your seat type doesn['’]t include (?:extra )?usage/: the three seat-type prefixes of the CLI, both apostrophes", () => {
  assertHits([
    "Your seat type doesn't include usage credits",
    "Your seat type doesn't include usage",
    "Your seat type doesn't include extra usage",
  ], { curly: true });
});

t('A1 pattern 6: another noun, another verb or another subject is no refusal', () => {
  assertMisses([
    "Your seat type doesn't include coffee",
    "Your seat type doesn't include extra credits",
    'Your seat type does include usage',
    "Your seat doesn't include usage",
    'Your seat type doesnxt include usage',
  ]);
});

t('A1 pattern 7 /^Your usage allocation has been disabled by your admin/: the CLI prefix', () => {
  assertHits([
    'Your usage allocation has been disabled by your admin',
    'Your usage allocation has been disabled by your admin. Contact them to re-enable it.',
  ]);
});

t('A1 pattern 7: the whole phrase is required, word for word', () => {
  assertMisses([
    'Your usage allocation has been enabled by your admin',
    'Your usage allocation has been disabled.',
    'Your usage allocation has been disabled by the system',
    'Your usage allocation has been disabled by your organization',
    'Your allocation has been disabled by your admin',
    'Our usage allocation has been disabled by your admin',
  ]);
});

t("A1 pattern 8 /^Your group['’]s usage limit is set to \\$0/: the CLI prefix, both apostrophes", () => {
  assertHits([
    "Your group's usage limit is set to $0",
    "Your group's usage limit is set to $0. Ask your admin to raise it.",
  ], { curly: true });
});

t('A1 pattern 8: a different amount, a missing dollar sign, another subject or a cut-off phrase is no refusal', () => {
  assertMisses([
    "Your group's usage limit is set to $5",
    "Your group's usage limit is set to 0",
    "Your team's usage limit is set to $0",
    'Your groups usage limit is set to $0',
    "Your group's usage limit is set",
  ]);
});

t('A1 pattern 9 /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^\\u00B7\\n]{1,40})? requires usage credits\\./: each of the five model names, with and without a middle', () => {
  for (const model of ['Fable', 'Haiku', 'Mythos', 'Opus', 'Sonnet']) {
    assertHits([`${model} requires usage credits.`]);
  }
  assertHits([
    'Fable 5 requires usage credits.',
    'Opus 4.7 (1M context) requires usage credits.',
    'Opus a b c requires usage credits.', // spaces inside the middle are fine
    'Sonnet requires usage credits. Run /usage-credits to enable it.',
  ]);
});

t('A1 pattern 9: the middle is 1 to 40 characters — 0 and 41 fail, 1 and 40 hold', () => {
  assertHits(['Fable a requires usage credits.', `Fable ${'a'.repeat(40)} requires usage credits.`]);
  assertMisses([
    `Fable ${'a'.repeat(41)} requires usage credits.`, // one over the bound
    'Fable  requires usage credits.', // an empty middle: two spaces
  ]);
});

t('A1 pattern 9: a middle dot or a newline inside the middle fails', () => {
  assertMisses([
    `Fable 5 ${MIDDLE_DOT} beta requires usage credits.`,
    'Fable 5\nbeta requires usage credits.',
    `Opus ${MIDDLE_DOT} requires usage credits.`,
  ]);
});

t('A1 pattern 9: the final period is part of it; any other model name, or a different case, is no refusal', () => {
  assertMisses([
    'Opus requires usage credits',
    'Opus requires usage credits!',
    'Sonnet requires usage credits, sorry',
    'Sonnet requires usage credits',
    'Fable requires usage credits', // no period and no "5": neither pattern 9 nor the Fable 5 prefix
    'Gemini requires usage credits.',
    'Claude requires usage credits.',
    'fable requires usage credits.',
    'Opus requires usage credit.',
  ]);
});

t('A1 pattern 9: anchored at index 0 for every model name (a bare alternation would match anywhere)', () => {
  for (const model of ['Fable', 'Haiku', 'Mythos', 'Opus', 'Sonnet']) {
    assertMisses([`x ${model} requires usage credits.`, `The ${model} requires usage credits.`, `Done.\n${model} requires usage credits.`]);
  }
});

t('A1 the Fable 5 prefix /^Fable 5 requires usage credits/: with or without a period or a suffix', () => {
  assertHits([
    'Fable 5 requires usage credits',
    'Fable 5 requires usage credits.',
    `Fable 5 requires usage credits ${MIDDLE_DOT} /model to switch`,
  ]);
  assertMisses(['Fable 6 requires usage credits', 'fable 5 requires usage credits', 'x Fable 5 requires usage credits', 'Fable 5 requires usage']);
});

t('A1 mirror: every one of the twelve prefixes of the CLI classifier is a hit, anchored and capped like the rest', () => {
  assert.equal(CLI_CLASSIFIER_PREFIXES.length, 12);
  assert.equal(MIDDLE_DOT.codePointAt(0), 0xb7, 'the middle dot is U+00B7');
  assertHits(CLI_CLASSIFIER_PREFIXES);
  for (const prefix of CLI_CLASSIFIER_PREFIXES) {
    // padded after a space: patterns 1 and 2 end at a word boundary, and a bare prefix glued to padding would not have one
    assert.ok(detectPlanLimit({ stdout: pad(`${prefix} `, 600) }) !== null, `600: ${prefix}`);
    assert.equal(detectPlanLimit({ stdout: pad(`${prefix} `, 601) }), null, `601: ${prefix}`);
    assertMisses([`x ${prefix}`, `Done.\n${prefix}`, prefix.toUpperCase()]);
  }
});

t('R-PL2: the patterns are case-sensitive', () => {
  for (const sample of SAMPLES) {
    assertMisses([sample.toLowerCase(), sample.toUpperCase()]);
  }
});

// ---- anchoring (R-PL2) ------------------------------------------------------------------------------------------------------------------

t("R-PL2 anchoring: a refusal after any prefix is agent prose that quotes a limit, never a hit — every pattern, every text channel", () => {
  for (const sample of SAMPLES) {
    for (const prefix of ['x ', 'I fixed the limiter. ', 'The CLI said: ', '"', '> ']) {
      for (const [channel, build] of Object.entries(TEXT_CHANNELS)) {
        assert.equal(detectPlanLimit(build(prefix + sample)), null, `${channel}: ${prefix}${sample}`);
      }
    }
  }
});

t('R-PL2 anchoring: a refusal in the middle of a paragraph is no hit', () => {
  const paragraph = `I ran the suite and it passed.\n\nThen the tool answered: ${REFUSAL} and I stopped there.\n\nNext I read the diff.`;
  for (const [channel, build] of Object.entries(TEXT_CHANNELS)) assert.equal(detectPlanLimit(build(paragraph)), null, channel);
});

t('R-PL2 anchoring: index 0 of the text, not the start of a line (the patterns carry no multiline flag)', () => {
  for (const sample of SAMPLES) {
    for (const [channel, build] of Object.entries(TEXT_CHANNELS)) {
      assert.equal(detectPlanLimit(build(`Done.\n${sample}`)), null, `${channel}: second line: ${sample}`);
      assert.equal(detectPlanLimit(build(`Done.\n\n${sample}\nMore.`)), null, `${channel}: own paragraph: ${sample}`);
    }
  }
});

t('R-PL2 anchoring: whitespace before the refusal is trimmed, and it is the trimmed text that is stored', () => {
  for (const lead of [' ', '\n', '\t', '  \n\t \r\n']) {
    const found = detectPlanLimit({ stdout: `${lead}${REFUSAL}` });
    assert.ok(found !== null, JSON.stringify(lead));
    assert.equal(found.matched, REFUSAL);
  }
});

// ---- length cap (R-PL2) -----------------------------------------------------------------------------------------------------------------

t('R-PL2 length cap: exactly MAX_REFUSAL_CHARS (600) characters is a hit, 601 is not — in every text channel', () => {
  for (const [channel, build] of Object.entries(TEXT_CHANNELS)) {
    const at = detectPlanLimit(build(pad(REFUSAL, 600)));
    assert.ok(at !== null, `${channel}: 600`);
    assert.equal(at.source, channel);
    assert.equal(detectPlanLimit(build(pad(REFUSAL, 601))), null, `${channel}: 601`);
  }
});

t('R-PL2 length cap: it holds for every pattern, not only the first', () => {
  for (const sample of SAMPLES) {
    assert.ok(detectPlanLimit({ stdout: pad(sample, 600) }) !== null, `600: ${sample}`);
    assert.equal(detectPlanLimit({ stdout: pad(sample, 601) }), null, `601: ${sample}`);
  }
});

t('R-PL2 length cap: leading whitespace is trimmed BEFORE the length check (600 after the trim is a hit, 601 is not)', () => {
  const lead = ' \n\t '.repeat(25);
  assert.ok(lead.length >= 100);
  assert.ok(detectPlanLimit({ stdout: lead + pad(REFUSAL, 600) }) !== null, 'the whitespace does not count');
  assert.equal(detectPlanLimit({ stdout: lead + pad(REFUSAL, 601) }), null);
});

t('R-PL2 length cap: only LEADING whitespace is trimmed, so trailing whitespace counts toward the cap (the ruling says "after trimming leading whitespace")', () => {
  assert.ok(detectPlanLimit({ stdout: pad(REFUSAL, 599) + '\n' }) !== null, '599 + newline = 600');
  assert.equal(detectPlanLimit({ stdout: pad(REFUSAL, 600) + '\n' }), null, '600 + newline = 601');
});

t('R-PL2 length cap: a huge candidate is no hit and no throw', () => {
  const huge = REFUSAL + 'x'.repeat(5_000_000);
  assert.equal(detectPlanLimit({ stdout: huge, stderr: huge, envelope: { result: huge }, transcript: jl(said(huge)) }), null);
});

// ---- the channels (R-PL1, R-PL2, brief "Channel order") ---------------------------------------------------------------------------------

t('channel envelope.api_error: the typed field alone is a hit, with no text', () => {
  assert.deepEqual(detectPlanLimit(ALL_CHANNELS.envelope_api_error()), {
    source: 'envelope_api_error',
    matched: 'usage_limit_reached',
    resetHint: null,
    rateLimitType: null,
    resetsAt: null,
  });
  assert.deepEqual(detectPlanLimit({ envelope: { api_error: 'usage_limit_reached' } }), {
    source: 'envelope_api_error',
    matched: 'usage_limit_reached',
    resetHint: null,
    rateLimitType: null,
    resetsAt: null,
  });
});

t('channel envelope.api_error: it needs neither the anchor nor the length cap of the text channels (the type is authoritative)', () => {
  const found = detectPlanLimit({ envelope: { api_error: 'usage_limit_reached', result: `Something unrelated. ${'x'.repeat(2000)}` } });
  assert.equal(found.source, 'envelope_api_error');
  assert.equal(found.matched.length, 200);
});

t('channel envelope.api_error: when the envelope also carries a result text, that text (cut to 200 characters) is what was matched; a blank result falls back to the type name', () => {
  const withText = detectPlanLimit({ envelope: { api_error: 'usage_limit_reached', result: "  You've hit your limit · resets 3pm" } });
  assert.equal(withText.source, 'envelope_api_error');
  assert.equal(withText.matched, REFUSAL);
  assert.equal(withText.resetHint, 'resets 3pm');
  for (const result of ['', '   \n', 5, null, ['x']]) {
    const found = detectPlanLimit({ envelope: { api_error: 'usage_limit_reached', result } });
    assert.equal(found.matched, 'usage_limit_reached', JSON.stringify(result));
  }
});

t('channel envelope.api_error: only the exact string "usage_limit_reached" counts', () => {
  for (const value of ['authentication_failed', 'rate_limit', 'USAGE_LIMIT_REACHED', 'usage_limit_reached ', 'usage_limit', true, 1, ['usage_limit_reached'], { kind: 'usage_limit_reached' }, null, '']) {
    assert.equal(detectPlanLimit({ envelope: { api_error: value } }), null, JSON.stringify(value));
  }
});

t('channel envelope.result: a refusal ONLY in the result string is a hit', () => {
  const found = detectPlanLimit(TEXT_CHANNELS.envelope_result(REFUSAL));
  assert.equal(found.source, 'envelope_result');
  assert.equal(found.matched, REFUSAL);
  assert.equal(found.resetHint, 'resets 3pm');
});

t('channel stdout: a refusal ONLY in stdout is a hit', () => {
  const found = detectPlanLimit(TEXT_CHANNELS.stdout(`${REFUSAL}\n`));
  assert.equal(found.source, 'stdout');
  assert.equal(found.matched, `${REFUSAL}\n`);
});

t('channel stderr: a refusal ONLY in stderr is a hit', () => {
  const found = detectPlanLimit(TEXT_CHANNELS.stderr(`${REFUSAL}\n`));
  assert.equal(found.source, 'stderr');
  assert.equal(found.matched, `${REFUSAL}\n`);
});

t('channel transcript: a refusal ONLY as the last assistant record of the transcript is a hit', () => {
  const found = detectPlanLimit(TEXT_CHANNELS.transcript(REFUSAL));
  assert.equal(found.source, 'transcript');
  assert.equal(found.matched, REFUSAL);
});

t('R-PL1 no channel depends on is_error: a refusal with is_error false is a hit, is_error true with an ordinary result is none', () => {
  assert.equal(detectPlanLimit({ envelope: { subtype: 'success', is_error: false, result: REFUSAL } }).source, 'envelope_result');
  assert.equal(detectPlanLimit({ envelope: { subtype: 'success', result: REFUSAL } }).source, 'envelope_result', 'is_error absent');
  assert.equal(detectPlanLimit({ envelope: { is_error: true, result: CLEAN_PROSE } }), null);
  assert.equal(detectPlanLimit({ envelope: { is_error: true, api_error_status: 500, terminal_reason: 'api_error', result: 'Internal server error' } }), null);
});

t('brief "Channel order": first hit wins — api_error, then envelope.result, then stdout, then stderr, then the transcript', () => {
  const input = {
    envelope: { api_error: 'usage_limit_reached', result: "You've hit your limit (result) · resets 1pm" },
    stdout: "You've hit your limit (stdout) · resets 2pm",
    stderr: "You've hit your limit (stderr) · resets 3pm",
    transcript: jl(said("You've hit your limit (transcript) · resets 4pm")),
  };
  const first = detectPlanLimit(input);
  assert.equal(first.source, 'envelope_api_error');

  delete input.envelope.api_error;
  const second = detectPlanLimit(input);
  assert.equal(second.source, 'envelope_result');
  assert.equal(second.matched, "You've hit your limit (result) · resets 1pm");

  delete input.envelope.result;
  const third = detectPlanLimit(input);
  assert.equal(third.source, 'stdout');
  assert.equal(third.matched, "You've hit your limit (stdout) · resets 2pm");

  delete input.stdout;
  const fourth = detectPlanLimit(input);
  assert.equal(fourth.source, 'stderr');
  assert.equal(fourth.matched, "You've hit your limit (stderr) · resets 3pm");

  delete input.stderr;
  const fifth = detectPlanLimit(input);
  assert.equal(fifth.source, 'transcript');
  assert.equal(fifth.matched, "You've hit your limit (transcript) · resets 4pm");

  delete input.transcript;
  assert.equal(detectPlanLimit(input), null);
});

t('brief "Channel order": a channel without a refusal is skipped, not final — a later channel still decides', () => {
  for (const [channel, build] of Object.entries(TEXT_CHANNELS)) {
    // every other channel carries ordinary prose, a 401 text, or a notice; the one channel left carries the refusal
    const input = build(REFUSAL);
    input.envelope = { ...input.envelope, ...(channel === 'envelope_result' ? {} : { result: TEXT_401 }) };
    if (channel !== 'stdout') input.stdout = 'Fable limit reached · continuing on Opus\n';
    if (channel !== 'stderr') input.stderr = 'Context limit reached\n';
    assert.equal(detectPlanLimit(input)?.source, channel, channel);
  }
});

t('R-PL1 detectPlanLimit reads the input and changes nothing in it', () => {
  const input = deepFreeze({
    envelope: { api_error: 'usage_limit_reached', result: REFUSAL, api_error_params: { rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1790000000 } } },
    stdout: REFUSAL,
    stderr: REFUSAL,
    transcript: jl(said(REFUSAL)),
  });
  assert.ok(detectPlanLimit(input) !== null);
  assert.ok(detectPlanLimit({ ...input, envelope: { result: REFUSAL } }) !== null);
});

// ---- negatives (brief fact 2) -----------------------------------------------------------------------------------------------------------

// Each of these text channels is checked with the text alone in it, as the whole text of the channel.
const assertNoHitInAnyTextChannel = (text) => {
  for (const [channel, build] of Object.entries(TEXT_CHANNELS)) assert.equal(detectPlanLimit(build(text)), null, channel);
};

t('negative (fact 2): the 5-hour warning "Approaching your 5-hour usage limit — Claude will wrap up the current step." is not a refusal', () => {
  assertNoHitInAnyTextChannel('Approaching your 5-hour usage limit — Claude will wrap up the current step.');
});

t('negative (fact 2): the transient overload "Server is temporarily limiting requests (not your usage limit)" is not a refusal, as an error envelope either', () => {
  const text = 'Server is temporarily limiting requests (not your usage limit)';
  assertNoHitInAnyTextChannel(text);
  assert.equal(detectPlanLimit({ envelope: { is_error: true, api_error_status: 429, terminal_reason: 'api_error', result: text }, stdout: JSON.stringify({ result: text }) }), null);
});

t('negative (fact 2): "Context limit reached" is not a refusal', () => {
  assertNoHitInAnyTextChannel('Context limit reached');
});

t('negative (fact 2): the notice "Fable limit reached · continuing on …" (the CLI continues) is not a refusal', () => {
  assertNoHitInAnyTextChannel('Fable limit reached · continuing on Opus');
});

t('negative (fact 2): the notice "Fast limit reached and temporarily disabled …" (the CLI continues) is not a refusal', () => {
  assertNoHitInAnyTextChannel('Fast limit reached and temporarily disabled until 3pm');
});

t('negative (fact 2): the authentication failure text stays out in every text channel', () => {
  assertNoHitInAnyTextChannel(TEXT_401);
});

t('negative (fact 2): the REAL 401 transcript record is no hit', () => {
  assert.equal(detectPlanLimit({ transcript: API_ERROR_401_RECORD }), null);
  assert.equal(detectPlanLimit({ transcript: jl(said('Working.'), API_ERROR_401_RECORD) }), null);
  assert.equal(detectPlanLimit({ transcript: `${API_ERROR_401_RECORD}\n` }), null);
});

t('negative (fact 2): the reconstructed 401 envelope is no hit, as a parsed envelope, as stdout JSON text, with every field it carries', () => {
  assert.equal(detectPlanLimit({ envelope: envelope401() }), null);
  assert.equal(detectPlanLimit({ stdout: JSON.stringify(envelope401()) }), null);
  assert.equal(detectPlanLimit({ envelope: envelope401(), stdout: JSON.stringify(envelope401()), stderr: '', transcript: API_ERROR_401_RECORD }), null);
});

t('negative: an agent that merely talks about a limit is no hit (the words of a refusal in the middle of its own sentence)', () => {
  assertNoHitInAnyTextChannel('The harness stops when the CLI prints "You\'ve hit your limit" because the usage limit reached state is not a model failure.');
  assertNoHitInAnyTextChannel('I added a test for the "Usage limit reached" message and for "You\'re out of usage credits".');
});

t('negative (A1): "Fast mode requires usage credits" is a mode notice, not a refusal of a model run', () => {
  assertNoHitInAnyTextChannel('Fast mode requires usage credits');
  assertNoHitInAnyTextChannel('Fast mode requires usage credits.');
});

t('negative (A1): a notice that starts with "Switched" and only mentions a model that requires usage credits is not a refusal', () => {
  assertNoHitInAnyTextChannel(`Switched to Sonnet ${MIDDLE_DOT} Fable requires usage credits ${MIDDLE_DOT} /model to change`);
  assertNoHitInAnyTextChannel('Switched to Sonnet. Fable requires usage credits.');
});

// ---- inputs (R-PL1: never throws) -------------------------------------------------------------------------------------------------------

t('R-PL1 inputs: undefined, null, primitives, arrays, empty and null-field objects give null and never throw', () => {
  for (const input of [undefined, null, 0, 5, true, '', 'You\'ve hit your limit', [], [REFUSAL], {}, { envelope: null, stdout: null, stderr: null, transcript: null }, { envelope: undefined }]) {
    assert.equal(detectPlanLimit(input), null, JSON.stringify(input));
  }
});

t('R-PL1 inputs: a field of the wrong type is ignored (numbers, objects, arrays, a Buffer as text channels; a string or an array as the envelope)', () => {
  assert.equal(detectPlanLimit({ envelope: 5, stdout: 5, stderr: 5, transcript: 5 }), null);
  assert.equal(detectPlanLimit({ stdout: {}, stderr: [], transcript: {} }), null);
  assert.equal(detectPlanLimit({ stdout: [REFUSAL], stderr: [REFUSAL] }), null, 'an array of strings is not a string');
  assert.equal(detectPlanLimit({ stdout: Buffer.from(REFUSAL), stderr: Buffer.from(REFUSAL) }), null, 'bytes are not text; the caller decodes');
  assert.equal(detectPlanLimit({ envelope: { result: 5 } }), null);
  assert.equal(detectPlanLimit({ envelope: { result: [REFUSAL] } }), null);
  assert.equal(detectPlanLimit({ envelope: { result: { text: REFUSAL } } }), null);
});

t('R-PL1 inputs: an envelope that is a string or an array is ignored, even when it looks like a refusal', () => {
  assert.equal(detectPlanLimit({ envelope: JSON.stringify({ api_error: 'usage_limit_reached', result: REFUSAL }) }), null);
  assert.equal(detectPlanLimit({ envelope: REFUSAL }), null);
  assert.equal(detectPlanLimit({ envelope: Object.assign([], { api_error: 'usage_limit_reached', result: REFUSAL }) }), null);
  assert.equal(detectPlanLimit({ envelope: [{ api_error: 'usage_limit_reached' }] }), null);
});

t('R-PL1 inputs: empty and whitespace-only candidates are no hit', () => {
  for (const text of ['', ' ', '\n', ' \t\r\n ']) {
    assert.equal(detectPlanLimit({ stdout: text, stderr: text, envelope: { result: text }, transcript: text }), null, JSON.stringify(text));
  }
});

t('R-PL1 inputs: a transcript that is not JSON, is torn, or holds JSON values that are no records gives null and never throws', () => {
  assert.equal(detectPlanLimit({ transcript: 'this is not json at all' }), null);
  assert.equal(detectPlanLimit({ transcript: '{"type":"assistant","message":{"content":[{"type":"te' }), null);
  assert.equal(detectPlanLimit({ transcript: 'null\n42\n[]\n"str"\ntrue\n{}' }), null);
  assert.equal(detectPlanLimit({ transcript: '\n\n\n' }), null);
});

t('transcript rule: a transcript whose last record is a user record, or whose only refusal is in a sidechain, is no hit', () => {
  // the user record quotes a refusal: a user record is never the model's answer
  assert.equal(detectPlanLimit({ transcript: jl(said(CLEAN_PROSE), userRec(REFUSAL)) }), null);
  assert.equal(detectPlanLimit({ transcript: jl(userRec(REFUSAL)) }), null);
  // the refusal is a subagent's: the main agent's last record is the ordinary one
  assert.equal(detectPlanLimit({ transcript: jl(said(CLEAN_PROSE), said(REFUSAL, { isSidechain: true })) }), null);
  assert.equal(detectPlanLimit({ transcript: jl(said(REFUSAL, { isSidechain: true })) }), null);
});

t('transcript rule: only the LAST assistant record decides — an earlier refusal followed by an ordinary answer is no hit; the reverse is a hit', () => {
  assert.equal(detectPlanLimit({ transcript: jl(said(REFUSAL), said(CLEAN_PROSE)) }), null);
  assert.equal(detectPlanLimit({ transcript: jl(said(CLEAN_PROSE), said(REFUSAL)) })?.source, 'transcript');
});

t('transcript rule: a sidechain record after the main agent\'s refusal does not hide it; a user record after it does not either', () => {
  assert.equal(detectPlanLimit({ transcript: jl(said(REFUSAL), said(CLEAN_PROSE, { isSidechain: true })) })?.source, 'transcript');
  assert.equal(detectPlanLimit({ transcript: jl(said(REFUSAL), userRec(CLEAN_PROSE)) })?.source, 'transcript');
});

t('transcript rule: a torn LAST line is skipped, the record before it decides', () => {
  const torn = '{"type":"assistant","isSidechain":false,"message":{"content":[{"type":"text","text":"You\'ve hit your lim';
  assert.equal(detectPlanLimit({ transcript: `${jl(said(REFUSAL))}\n${torn}` })?.source, 'transcript', 'a refusal, then a torn line');
  assert.equal(detectPlanLimit({ transcript: `${jl(said(CLEAN_PROSE))}\n${torn}` }), null, 'prose, then a torn line that starts like a refusal');
});

t('transcript rule: the refusal is read from an ordinary assistant record, not only from an API-error record (an otherwise normal transcript)', () => {
  const normal = jl(userRec('fix the bug'), assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), userRec('ok'), said(REFUSAL));
  assert.equal(detectPlanLimit({ transcript: normal })?.source, 'transcript');
});

t('SYNTHETIC plan-limit transcript: the 401 record with error "rate_limit" and a refusal text is a transcript hit (a real plan-limit record has never been observed)', () => {
  const found = detectPlanLimit({ transcript: JSON.stringify(syntheticPlanLimitRecord()) });
  assert.equal(found.source, 'transcript');
  assert.equal(found.matched, REFUSAL);
  assert.equal(found.resetHint, 'resets 3pm');
  // and the same record with the 401 text is still none: it is the text, not the record shape, that decides
  assert.equal(detectPlanLimit({ transcript: JSON.stringify(syntheticPlanLimitRecord(TEXT_401)) }), null);
});

// ---- the typed field's rate-limit info (fact 3) -----------------------------------------------------------------------------------------

const withInfo = (info, over = {}) => ({ envelope: { api_error: 'usage_limit_reached', api_error_params: { rate_limit_info: info }, ...over } });

t('typed channel: a well-formed rate_limit_info carries rateLimitType and resetsAt into the hit', () => {
  const found = detectPlanLimit(withInfo({ rateLimitType: 'five_hour', resetsAt: 1790000000 }));
  assert.deepEqual(found, { source: 'envelope_api_error', matched: 'usage_limit_reached', resetHint: null, rateLimitType: 'five_hour', resetsAt: 1790000000 });
});

t('typed channel: every one of the six rateLimitType values is accepted, and 0 is a legal resetsAt', () => {
  for (const type of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage']) {
    assert.equal(detectPlanLimit(withInfo({ rateLimitType: type, resetsAt: 0 })).rateLimitType, type, type);
    assert.equal(detectPlanLimit(withInfo({ rateLimitType: type, resetsAt: 0 })).resetsAt, 0);
  }
});

t('typed channel: a malformed rate_limit_info gives null fields, each field judged on its own', () => {
  const none = { rateLimitType: null, resetsAt: null };
  for (const info of [null, undefined, 'five_hour', 7, [], ['five_hour'], Object.assign([], { rateLimitType: 'five_hour', resetsAt: 1 }), {}, { rateLimitType: 'hourly', resetsAt: 'soon' }, { rateLimitType: 5, resetsAt: NaN }, { rateLimitType: 'FIVE_HOUR', resetsAt: Infinity }]) {
    const found = detectPlanLimit(withInfo(info));
    assert.deepEqual({ rateLimitType: found.rateLimitType, resetsAt: found.resetsAt }, none, JSON.stringify(info));
  }
  const goodTypeBadTime = detectPlanLimit(withInfo({ rateLimitType: 'seven_day', resetsAt: '1790000000' }));
  assert.equal(goodTypeBadTime.rateLimitType, 'seven_day');
  assert.equal(goodTypeBadTime.resetsAt, null, 'a numeric string is not a number');
  const badTypeGoodTime = detectPlanLimit(withInfo({ rateLimitType: 'monthly', resetsAt: 1790000000 }));
  assert.equal(badTypeGoodTime.rateLimitType, null);
  assert.equal(badTypeGoodTime.resetsAt, 1790000000);
  assert.equal(detectPlanLimit(withInfo({ rateLimitType: 'five_hour', resetsAt: -Infinity })).resetsAt, null);
});

t('typed channel: api_error_params that is missing, null or not an object gives null fields', () => {
  for (const params of [undefined, null, 'x', 5, ['rate_limit_info'], Object.assign([], { rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1 } })]) {
    const found = detectPlanLimit({ envelope: { api_error: 'usage_limit_reached', api_error_params: params } });
    assert.equal(found.rateLimitType, null, JSON.stringify(params));
    assert.equal(found.resetsAt, null);
  }
});

t('typed channel: the rate-limit info of the envelope rides on a hit from any channel, and a hit without an envelope has null fields', () => {
  const envelope = { is_error: true, result: REFUSAL, api_error_params: { rate_limit_info: { rateLimitType: 'seven_day_opus', resetsAt: 1790003600 } } };
  const viaResult = detectPlanLimit({ envelope });
  assert.equal(viaResult.source, 'envelope_result');
  assert.equal(viaResult.rateLimitType, 'seven_day_opus');
  assert.equal(viaResult.resetsAt, 1790003600);
  const viaStdout = detectPlanLimit({ envelope: { ...envelope, result: undefined }, stdout: REFUSAL });
  assert.equal(viaStdout.source, 'stdout');
  assert.equal(viaStdout.rateLimitType, 'seven_day_opus');
  const noEnvelope = detectPlanLimit({ stdout: REFUSAL });
  assert.equal(noEnvelope.rateLimitType, null);
  assert.equal(noEnvelope.resetsAt, null);
});

t('typed channel: api_error "authentication_failed" (the 401 kind) is no hit, with or without a refusal-free result', () => {
  assert.equal(detectPlanLimit({ envelope: { is_error: true, api_error: 'authentication_failed', api_error_status: 401, result: TEXT_401 } }), null);
  assert.equal(detectPlanLimit({ envelope: { api_error: 'authentication_failed', api_error_params: { rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1 } } } }), null);
});

// ---- Hit fields: matched, resetHint -----------------------------------------------------------------------------------------------------

t('Hit shape: exactly source, matched, resetHint, rateLimitType and resetsAt', () => {
  for (const [channel, build] of Object.entries(ALL_CHANNELS)) {
    const found = detectPlanLimit(build(REFUSAL));
    assert.deepEqual(Object.keys(found).sort(), ['matched', 'rateLimitType', 'resetHint', 'resetsAt', 'source'], channel);
  }
});

t('Hit.matched is cut to 200 characters (199 and 200 whole, 201 and 600 cut), from the text after the leading whitespace', () => {
  assert.equal(detectPlanLimit({ stdout: pad(REFUSAL, 199) }).matched.length, 199);
  assert.equal(detectPlanLimit({ stdout: pad(REFUSAL, 200) }).matched, pad(REFUSAL, 200));
  for (const total of [201, 600]) {
    const text = pad(REFUSAL, total);
    const found = detectPlanLimit({ stdout: `  \n${text}` });
    assert.equal(found.matched.length, 200, String(total));
    assert.equal(found.matched, text.slice(0, 200));
  }
});

t('Hit.matched is cut to 200 characters in every text channel', () => {
  for (const [channel, build] of Object.entries(TEXT_CHANNELS)) {
    const found = detectPlanLimit(build(pad(REFUSAL, 400)));
    assert.equal(found.source, channel);
    assert.equal(found.matched, pad(REFUSAL, 400).slice(0, 200), channel);
  }
});

t('Hit.resetHint: the first "reset"/"resets" word and what follows it on the line', () => {
  assert.equal(detectPlanLimit({ stdout: "You've hit your limit · resets 3pm" }).resetHint, 'resets 3pm');
  assert.equal(detectPlanLimit({ stdout: "You've hit your fast limit · resets in 2h 10m" }).resetHint, 'resets in 2h 10m');
  assert.equal(detectPlanLimit({ stdout: 'Usage limit reached. Workflow paused; waiting agents re-run shortly after the reset.' }).resetHint, 'reset.', 'the singular word counts');
  assert.equal(detectPlanLimit({ stdout: "You've hit your monthly limit — raise it below, or it resets next month." }).resetHint, 'resets next month.');
});

t('Hit.resetHint is null when the text has no reset word', () => {
  assert.equal(detectPlanLimit({ stdout: "You're out of extra usage" }).resetHint, null);
  assert.equal(detectPlanLimit({ stdout: "You've hit your team's shared budget. /model to switch models." }).resetHint, null);
});

t('Hit.resetHint: the reset word is a whole word (no "presets", no "resetting")', () => {
  assert.equal(detectPlanLimit({ stdout: "You've hit your limit · presets 3pm" }).resetHint, null, 'not at a word start');
  assert.equal(detectPlanLimit({ stdout: "You've hit your limit — resetting soon" }).resetHint, null, 'not at a word end');
  assert.equal(detectPlanLimit({ stdout: "You've hit your limit · Resets 3pm" }).resetHint, null, 'the word is lower case, as the CLI writes it');
});

t('Hit.resetHint stops at the end of the line', () => {
  assert.equal(detectPlanLimit({ stdout: "You've hit your limit · resets 3pm\nRun /usage-credits to keep going." }).resetHint, 'resets 3pm');
});

t('Hit.resetHint: at most 80 characters follow the reset word', () => {
  const found = detectPlanLimit({ stdout: `You've hit your limit · resets ${'a'.repeat(300)}` });
  assert.equal(found.resetHint, `resets ${'a'.repeat(79)}`);
  assert.equal(found.resetHint.length, 'resets'.length + 80);
  const exactly = detectPlanLimit({ stdout: `You've hit your limit · resets ${'b'.repeat(79)}` });
  assert.equal(exactly.resetHint, `resets ${'b'.repeat(79)}`, 'a space and 79 more: 80 characters after the word fit exactly');
});

t('Hit.resetHint is read from the stored matched text: a reset word after the 200-character cut is not found', () => {
  const text = `${pad(REFUSAL.replace(' · resets 3pm', ''), 250)} · resets 3pm`;
  assert.ok(text.length <= MAX_REFUSAL_CHARS);
  const found = detectPlanLimit({ stdout: text });
  assert.equal(found.matched.length, 200);
  assert.equal(found.resetHint, null);
});

// ---- lastAssistantRecordText ------------------------------------------------------------------------------------------------------------

t('lastAssistantRecordText: the LAST assistant record wins over an earlier one', () => {
  assert.equal(lastAssistantRecordText(jl(said('first'), said('second'))), 'second');
  assert.equal(lastAssistantRecordText(jl(said('first'), userRec('between'), said('second'), userRec('after'))), 'second');
});

t('lastAssistantRecordText: an API-error record is included (the point of the function)', () => {
  assert.equal(lastAssistantRecordText(API_ERROR_401_RECORD), TEXT_401);
  assert.equal(lastAssistantRecordText(jl(said('Working.'), API_ERROR_401_RECORD)), TEXT_401);
  assert.equal(lastAssistantRecordText(`${API_ERROR_401_RECORD}\n`), TEXT_401);
});

t('lastAssistantRecordText: a sidechain record is skipped; isSidechain false and absent both count', () => {
  assert.equal(lastAssistantRecordText(jl(said('main'), said('sub', { isSidechain: true }))), 'main');
  assert.equal(lastAssistantRecordText(jl(said('sub', { isSidechain: true }))), null);
  assert.equal(lastAssistantRecordText(jl(said('old'), { type: 'assistant', message: { content: 'no isSidechain key' } })), 'no isSidechain key');
  assert.equal(lastAssistantRecordText(jl(said('old', { isSidechain: true }), said('new', { isSidechain: false }))), 'new');
  assert.equal(lastAssistantRecordText(jl(said('old'), said('flagged', { isSidechain: 'true' }), said('flagged too', { isSidechain: 1 }))), 'flagged too', 'only the boolean true marks a sidechain record');
});

t('lastAssistantRecordText: only type "assistant" records count', () => {
  assert.equal(lastAssistantRecordText(jl(said('answer'), userRec('question'), { type: 'system', message: { content: 'note' } }, { type: 'result', result: 'done' })), 'answer');
  assert.equal(lastAssistantRecordText(jl(userRec('only a user'))), null);
});

t('lastAssistantRecordText: a torn or non-JSON line is skipped wherever it is, including last', () => {
  assert.equal(lastAssistantRecordText(`${jl(said('one'))}\nnot json\n${jl(said('two'))}\n{"type":"assistant","message":{"con`), 'two');
  assert.equal(lastAssistantRecordText(`{"type":"assis\n${jl(said('kept'))}`), 'kept');
  assert.equal(lastAssistantRecordText('garbage\n{"torn'), null);
});

t('lastAssistantRecordText: lines that parse to something other than a record (null, numbers, arrays, strings) are skipped without a throw', () => {
  assert.equal(lastAssistantRecordText(`${jl(said('kept'))}\nnull\n42\n[]\n"str"\ntrue`), 'kept');
});

t('lastAssistantRecordText: blank lines and CRLF line ends are tolerated', () => {
  assert.equal(lastAssistantRecordText(`\n${JSON.stringify(said('one'))}\r\n\r\n${JSON.stringify(said('two'))}\r\n\n`), 'two');
});

t('lastAssistantRecordText: content as a string is returned as it is', () => {
  assert.equal(lastAssistantRecordText(jl(assistant('plain string content'))), 'plain string content');
});

t('lastAssistantRecordText: content blocks — the text of every {type:"text"} block joined with a newline; other block types and non-string text are left out', () => {
  assert.equal(lastAssistantRecordText(jl(assistant([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }]))), 'a\nb\nc');
  assert.equal(
    lastAssistantRecordText(jl(assistant([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'a' },
      { type: 'tool_use', id: 't', name: 'Bash', input: { text: 'not me' } },
      { type: 'text', text: 5 },
      { type: 'text' },
      { type: 'image', text: 'not text' },
      { type: 'text', text: 'b' },
      null,
      5,
      'text',
      ['text'],
    ]))),
    'a\nb',
  );
});

t('lastAssistantRecordText: the last assistant record decides even when it has no text — there is no fall back to an earlier record', () => {
  assert.equal(lastAssistantRecordText(jl(said(REFUSAL), assistant([{ type: 'tool_use', id: 't', name: 'Bash', input: {} }]))), null);
  assert.equal(lastAssistantRecordText(jl(said(REFUSAL), assistant([]))), null);
  assert.equal(lastAssistantRecordText(jl(said(REFUSAL), assistant(''))), null);
});

t('lastAssistantRecordText: null for no assistant record, an empty transcript, a record without message or content, and a transcript that is not a string', () => {
  for (const text of ['', '\n', jl(userRec('hi')), jl({ type: 'assistant' }), jl({ type: 'assistant', message: null }), jl({ type: 'assistant', message: 'text' }),
    jl({ type: 'assistant', message: { content: 5 } }), jl({ type: 'assistant', message: { content: {} } }), jl({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } })]) {
    assert.equal(lastAssistantRecordText(text), null, JSON.stringify(text));
  }
  for (const notText of [undefined, null, 5, {}, [], [jl(said('x'))], Buffer.from(jl(said('x')))]) {
    assert.equal(lastAssistantRecordText(notText), null, String(notText));
  }
});

t('lastAssistantRecordText: the real 401 fixture record gives "Failed to authenticate…" and the synthetic plan-limit record gives the refusal', () => {
  assert.equal(lastAssistantRecordText(API_ERROR_401_RECORD), 'Failed to authenticate. API Error: 401 Invalid bearer token');
  assert.equal(lastAssistantRecordText(JSON.stringify(syntheticPlanLimitRecord())), REFUSAL);
});

t('lastAssistantRecordText: a multi-block refusal is joined, so the anchor sees the first block first', () => {
  const split = jl(assistant([{ type: 'text', text: "You've hit your limit" }, { type: 'text', text: '· resets 3pm' }]));
  assert.equal(detectPlanLimit({ transcript: split }).matched, "You've hit your limit\n· resets 3pm");
  const prose = jl(assistant([{ type: 'text', text: 'Let me check.' }, { type: 'text', text: REFUSAL }]));
  assert.equal(detectPlanLimit({ transcript: prose }), null, 'a refusal in the second block is not at index 0 of the record text');
});

// ---- the wrap-up note: usageLimitNoteIn and channel 6, transcript_note (AMENDMENT A1) ---------------------------------------------------
// Every record here is SYNTHETIC: that the transcript persists `usageLimitNote` on a record, and where the CLI delivers the marker text (a user
// record, an attachment), is NOT verified. The scan therefore reads user, attachment and system records alike.

t('usageLimitNoteIn: an own property usageLimitNote that is a non-empty string is returned as it is — a property-only record', () => {
  assert.equal(usageLimitNoteIn(jl(noteProp())), 'wrap_up');
  assert.equal(usageLimitNoteIn(jl(userRec('hi'), noteProp({ usageLimitNote: 'next_steps' }), said('done'))), 'next_steps');
  const long = 'n'.repeat(300);
  assert.equal(usageLimitNoteIn(jl(noteProp({ usageLimitNote: long }))), long, 'the property value is returned whole; the Hit cuts it');
  assert.equal(usageLimitNoteIn(jl(noteProp({ usageLimitNote: ' ' }))), ' ', 'non-empty is the whole test: a blank string is still a string the CLI set');
});

t('usageLimitNoteIn: the property is read on a record of any type — user, attachment, system, assistant, or none', () => {
  for (const type of ['user', 'attachment', 'system', 'assistant', 'progress']) {
    assert.equal(usageLimitNoteIn(jl({ type, isSidechain: false, usageLimitNote: 'wrap_up' })), 'wrap_up', type);
  }
  assert.equal(usageLimitNoteIn(jl({ usageLimitNote: 'wrap_up' })), 'wrap_up', 'no type at all');
});

t('usageLimitNoteIn: a property that is empty or not a string is ignored', () => {
  for (const value of ['', 5, 0, true, false, null, {}, [], ['wrap_up'], { kind: 'wrap_up' }]) {
    assert.equal(usageLimitNoteIn(jl(noteProp({ usageLimitNote: value }))), null, JSON.stringify(value));
  }
  assert.equal(usageLimitNoteIn(jl(userRec('hi'), said('done'))), null, 'no property at all');
});

t('usageLimitNoteIn: the property must sit on the record itself — nested in message or attachment it is not read', () => {
  assert.equal(usageLimitNoteIn(jl({ type: 'user', message: { role: 'user', content: 'x', usageLimitNote: 'wrap_up' } })), null);
  assert.equal(usageLimitNoteIn(jl({ type: 'attachment', attachment: { type: 'queued_command', usageLimitNote: 'wrap_up' } })), null);
});

t('usageLimitNoteIn: the property must be the record\'s OWN — one inherited through Object.prototype is not read', () => {
  Object.prototype.usageLimitNote = 'inherited';
  try {
    assert.equal(usageLimitNoteIn(jl(userRec('hi'), said('done'))), null);
  } finally {
    delete Object.prototype.usageLimitNote;
  }
  assert.equal(Object.hasOwn(Object.prototype, 'usageLimitNote'), false, 'test cleanup');
});

t('usageLimitNoteIn: a user record whose message.content STARTS with "[Usage limit reached" is a note, and its text is returned', () => {
  assert.equal(usageLimitNoteIn(jl(noteUser())), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl(userRec('go'), noteUser(), said('done'))), NOTE_TEXT);
  // SYNTHETIC: the "next steps" variant the binary also builds begins with the same words
  const variant = '[Usage limit reached — grace window active. Checkpoint now: finish the current step, then list up to 3 short bullets of the most impactful remaining work.]';
  assert.equal(usageLimitNoteIn(jl(userRec(variant))), variant);
  // not only isMeta records: the rule is the text, not the flag
  assert.equal(usageLimitNoteIn(jl(noteUser({ isMeta: false }))), NOTE_TEXT);
});

t('usageLimitNoteIn: whitespace before the marker is trimmed, and the returned text is the trimmed one', () => {
  assert.equal(usageLimitNoteIn(jl(userRec(`  \n\t${NOTE_TEXT}`))), NOTE_TEXT);
});

t('usageLimitNoteIn: the marker text is cut to 200 characters; a short text is returned whole', () => {
  const long = `[Usage limit reached ${'x'.repeat(500)}`;
  assert.equal(usageLimitNoteIn(jl(userRec(long))).length, 200);
  assert.equal(usageLimitNoteIn(jl(userRec(long))), long.slice(0, 200));
  const exactly = `[Usage limit reached ${'x'.repeat(179)}`;
  assert.equal(exactly.length, 200);
  assert.equal(usageLimitNoteIn(jl(userRec(exactly))), exactly);
  const oneOver = `[Usage limit reached ${'x'.repeat(180)}`;
  assert.equal(usageLimitNoteIn(jl(userRec(oneOver))), oneOver.slice(0, 200));
});

t('usageLimitNoteIn: the marker is read from the {type:"text"} blocks of message.content, each block on its own; other block types and non-string text are not', () => {
  const blocks = (...content) => jl({ type: 'user', isSidechain: false, message: { role: 'user', content } });
  assert.equal(usageLimitNoteIn(blocks({ type: 'text', text: NOTE_TEXT })), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(blocks({ type: 'text', text: 'hi' }, { type: 'text', text: NOTE_TEXT })), NOTE_TEXT, 'a later block');
  assert.equal(usageLimitNoteIn(blocks({ type: 'tool_result', tool_use_id: 't', content: NOTE_TEXT })), null, 'a tool result that prints the marker');
  assert.equal(usageLimitNoteIn(blocks({ type: 'image', text: NOTE_TEXT })), null);
  assert.equal(usageLimitNoteIn(blocks({ type: 'text', text: 5 }, null, 'str', [NOTE_TEXT])), null);
  assert.equal(usageLimitNoteIn(jl({ type: 'user', message: { role: 'user', content: [] } })), null);
});

t('usageLimitNoteIn: an attachment record whose attachment.content is the marker text, or an array holding it as a string, is a note', () => {
  assert.equal(usageLimitNoteIn(jl(noteAttachment(NOTE_TEXT))), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl(noteAttachment(['first', NOTE_TEXT]))), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl(noteAttachment(`  ${NOTE_TEXT}`))), NOTE_TEXT, 'trimmed');
  assert.equal(usageLimitNoteIn(jl(noteAttachment([{ type: 'text', text: NOTE_TEXT }, 5, null, [NOTE_TEXT]]))), null, 'only the strings of the array count');
  assert.equal(usageLimitNoteIn(jl(noteAttachment(5))), null);
  assert.equal(usageLimitNoteIn(jl(noteAttachment('plain attachment text'))), null);
  assert.equal(usageLimitNoteIn(jl({ type: 'attachment', attachment: NOTE_TEXT })), null, 'attachment is not an object');
});

t('usageLimitNoteIn: a system record is read like the others — its message.content text and its property', () => {
  assert.equal(usageLimitNoteIn(jl({ type: 'system', subtype: 'informational', isSidechain: false, message: { role: 'system', content: NOTE_TEXT } })), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl({ type: 'system', subtype: 'informational', isSidechain: false, usageLimitNote: 'wrap_up' })), 'wrap_up');
});

t('usageLimitNoteIn: an assistant record is read as well — the scan is by record content, not by record type', () => {
  assert.equal(usageLimitNoteIn(jl(said(NOTE_TEXT))), NOTE_TEXT);
});

t('usageLimitNoteIn: text that only CONTAINS the marker, or only resembles it, is not a note', () => {
  for (const text of [
    `Heads up: ${NOTE_TEXT}`,
    `line one\n${NOTE_TEXT}`,
    `- ${NOTE_TEXT}`,
    'x [Usage limit reached',
    'Usage limit reached',
    '[usage limit reached — grace window active.]',
    '(Usage limit reached — grace window active.)',
    '[ Usage limit reached',
    '[Usage limit',
    'The CLI injects "[Usage limit reached — grace window active" when it wraps up.',
  ]) {
    assert.equal(usageLimitNoteIn(jl(userRec(text))), null, text);
    assert.equal(usageLimitNoteIn(jl(noteAttachment(text))), null, `attachment: ${text}`);
    assert.equal(usageLimitNoteIn(jl({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })), null, `block: ${text}`);
  }
});

t('usageLimitNoteIn: a message that is not an object, or a record that is not a record, carries no note', () => {
  assert.equal(usageLimitNoteIn(jl({ type: 'user', message: NOTE_TEXT })), null);
  assert.equal(usageLimitNoteIn(`${JSON.stringify(NOTE_TEXT)}\n${JSON.stringify([noteProp()])}\nnull\n42\ntrue`), null);
});

t('usageLimitNoteIn: a sidechain record (a subagent\'s) is skipped, property and text alike; only the boolean true marks one', () => {
  assert.equal(usageLimitNoteIn(jl(noteProp({ isSidechain: true }))), null);
  assert.equal(usageLimitNoteIn(jl(noteUser({ isSidechain: true }))), null);
  assert.equal(usageLimitNoteIn(jl(noteAttachment(NOTE_TEXT, { isSidechain: true }))), null);
  assert.equal(usageLimitNoteIn(jl(noteProp({ isSidechain: true, usageLimitNote: 'side' }), noteProp({ usageLimitNote: 'main' }))), 'main', 'the main chain after a skipped sidechain note still decides');
  assert.equal(usageLimitNoteIn(jl(noteUser({ isSidechain: true }), noteUser())), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl(noteProp({ isSidechain: 'true' }))), 'wrap_up');
  assert.equal(usageLimitNoteIn(jl(noteProp({ isSidechain: 1 }))), 'wrap_up');
  const noFlag = noteProp();
  delete noFlag.isSidechain;
  assert.equal(usageLimitNoteIn(jl(noFlag)), 'wrap_up', 'a record without the flag is the main chain');
});

t('usageLimitNoteIn: a torn or non-JSON line is skipped wherever it is; a line that parses to no record is skipped', () => {
  const torn = '{"type":"user","isMeta":true,"usageLimitNote":"wrap_up","message":{"role":"user","content":"[Usage limit rea';
  assert.equal(usageLimitNoteIn(torn), null);
  assert.equal(usageLimitNoteIn(`${torn}\n${jl(noteProp({ usageLimitNote: 'later' }))}`), 'later', 'a torn line first');
  assert.equal(usageLimitNoteIn(`${jl(noteProp({ usageLimitNote: 'earlier' }))}\n${torn}`), 'earlier', 'a torn last line');
  assert.equal(usageLimitNoteIn(`not json\n\n${jl(noteUser())}\n{"torn`), NOTE_TEXT);
  assert.equal(usageLimitNoteIn('garbage\n{"torn'), null);
});

t('usageLimitNoteIn: the FIRST qualifying record wins, and within a record the property comes before the text', () => {
  assert.equal(usageLimitNoteIn(jl(noteUser(), noteProp({ usageLimitNote: 'later' }))), NOTE_TEXT);
  assert.equal(usageLimitNoteIn(jl(noteProp({ usageLimitNote: 'first' }), noteUser())), 'first');
  assert.equal(usageLimitNoteIn(jl(noteUser({ usageLimitNote: 'prop' }))), 'prop', 'one record with both');
});

t('usageLimitNoteIn: null for a transcript that is not a string, is empty, or holds no note', () => {
  for (const notText of [undefined, null, 5, {}, [], [jl(noteProp())], Buffer.from(jl(noteProp()))]) {
    assert.equal(usageLimitNoteIn(notText), null, String(notText));
  }
  for (const text of ['', '\n', jl(userRec('hi'), said('done')), API_ERROR_401_RECORD, jl(syntheticPlanLimitRecord())]) {
    assert.equal(usageLimitNoteIn(text), null, text.slice(0, 60));
  }
});

t('channel transcript_note: a NORMAL-LOOKING transcript with a note record before a clean final assistant record is a hit — the case the last-record channel cannot see', () => {
  const normal = [userRec('fix the bug'), assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), userRec('ok')];
  const withNote = jl(...normal, noteUser(), said(CLEAN_PROSE));
  assert.equal(detectPlanLimit({ transcript: jl(...normal, said(CLEAN_PROSE)) }), null, 'the same transcript without the note is clean');
  assert.deepEqual(detectPlanLimit({ transcript: withNote }), {
    source: 'transcript_note',
    matched: NOTE_TEXT,
    resetHint: null,
    rateLimitType: null,
    resetsAt: null,
  });
});

t('channel transcript_note: a property-only note is a hit with the property value as `matched`; so is a note in an attachment record', () => {
  const viaProperty = detectPlanLimit({ transcript: jl(userRec('go'), noteProp(), said(CLEAN_PROSE)) });
  assert.equal(viaProperty.source, 'transcript_note');
  assert.equal(viaProperty.matched, 'wrap_up');
  const viaAttachment = detectPlanLimit({ transcript: jl(userRec('go'), noteAttachment(NOTE_TEXT), said(CLEAN_PROSE)) });
  assert.equal(viaAttachment.source, 'transcript_note');
  assert.equal(viaAttachment.matched, NOTE_TEXT);
});

t('channel transcript_note: not subject to the 600-character cap or the anchor, but `matched` is cut to 200 characters', () => {
  const longProperty = detectPlanLimit({ transcript: jl(noteProp({ usageLimitNote: `wrap_up ${'n'.repeat(1500)}` }), said(CLEAN_PROSE)) });
  assert.equal(longProperty.source, 'transcript_note');
  assert.equal(longProperty.matched, `wrap_up ${'n'.repeat(1500)}`.slice(0, 200));
  const longText = `[Usage limit reached ${'x'.repeat(1500)}`;
  assert.ok(longText.length > MAX_REFUSAL_CHARS);
  const viaText = detectPlanLimit({ transcript: jl(userRec(longText), said(CLEAN_PROSE)) });
  assert.equal(viaText.source, 'transcript_note');
  assert.equal(viaText.matched, longText.slice(0, 200));
  const unanchored = detectPlanLimit({ transcript: jl(noteProp({ usageLimitNote: 'something else entirely' }), said(CLEAN_PROSE)) });
  assert.equal(unanchored.matched, 'something else entirely');
});

t('channel transcript_note: a sidechain note, a note that only mentions the marker, a tool result printing it, and a torn line are no hit', () => {
  assert.equal(detectPlanLimit({ transcript: jl(userRec('go'), noteProp({ isSidechain: true }), said(CLEAN_PROSE)) }), null);
  assert.equal(detectPlanLimit({ transcript: jl(userRec(`Please read this: ${NOTE_TEXT}`), said(CLEAN_PROSE)) }), null);
  const toolResult = { type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: NOTE_TEXT }] } };
  assert.equal(detectPlanLimit({ transcript: jl(userRec('go'), toolResult, said(CLEAN_PROSE)) }), null);
  assert.equal(detectPlanLimit({ transcript: `${jl(userRec('go'), said(CLEAN_PROSE))}\n{"type":"user","usageLimitNote":"wrap_up` }), null);
});

t('brief "Channel order" (A1): the note channel is sixth — it loses to each of channels 1 to 5, and decides when they carry nothing', () => {
  const input = {
    envelope: { api_error: 'usage_limit_reached', result: "You've hit your limit (result) · resets 1pm" },
    stdout: "You've hit your limit (stdout) · resets 2pm",
    stderr: "You've hit your limit (stderr) · resets 3pm",
    transcript: jl(noteUser(), said("You've hit your limit (transcript) · resets 4pm")),
  };
  assert.equal(detectPlanLimit(input).source, 'envelope_api_error');
  delete input.envelope.api_error;
  assert.equal(detectPlanLimit(input).source, 'envelope_result');
  delete input.envelope.result;
  assert.equal(detectPlanLimit(input).source, 'stdout');
  delete input.stdout;
  assert.equal(detectPlanLimit(input).source, 'stderr');
  delete input.stderr;
  const fifth = detectPlanLimit(input);
  assert.equal(fifth.source, 'transcript', 'the last assistant record is a refusal: channel 5 wins over the note before it');
  assert.equal(fifth.matched, "You've hit your limit (transcript) · resets 4pm");
  input.transcript = jl(noteUser(), said(CLEAN_PROSE));
  const sixth = detectPlanLimit(input);
  assert.equal(sixth.source, 'transcript_note');
  assert.equal(sixth.matched, NOTE_TEXT);
  input.transcript = jl(said(CLEAN_PROSE));
  assert.equal(detectPlanLimit(input), null);
});

t('channel transcript_note: a note record AFTER the refusal record (which is then no longer the last assistant record) is still the note that decides', () => {
  const found = detectPlanLimit({ transcript: jl(said(REFUSAL), noteUser(), said(CLEAN_PROSE)) });
  assert.equal(found.source, 'transcript_note');
});

t('channel transcript_note: the rate-limit info of the envelope rides on a note hit', () => {
  const found = detectPlanLimit({
    envelope: { api_error_params: { rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1790000000 } } },
    transcript: jl(noteUser(), said(CLEAN_PROSE)),
  });
  assert.equal(found.source, 'transcript_note');
  assert.equal(found.rateLimitType, 'five_hour');
  assert.equal(found.resetsAt, 1790000000);
});

t('channel transcript_note: assertNoPlanLimit throws for it, with the note in the message', () => {
  assert.throws(
    () => assertNoPlanLimit(ALL_CHANNELS.transcript_note()),
    (err) => err instanceof PlanLimitError && err.hit.source === 'transcript_note' && err.message.startsWith('plan limit: ') && err.message.includes(NOTE_TEXT.slice(0, 40)),
  );
});

// ---- assertNoPlanLimit / PlanLimitError -------------------------------------------------------------------------------------------------

t('assertNoPlanLimit: returns undefined for clean input, for the 401 shapes, and for no input at all', () => {
  assert.equal(assertNoPlanLimit(clean()), undefined);
  assert.equal(assertNoPlanLimit({ envelope: envelope401(), stdout: JSON.stringify(envelope401()), transcript: API_ERROR_401_RECORD }), undefined);
  assert.equal(assertNoPlanLimit(), undefined);
  assert.equal(assertNoPlanLimit(null), undefined);
  assert.equal(assertNoPlanLimit({}), undefined);
});

t('assertNoPlanLimit: throws PlanLimitError for a hit in each channel, carrying the verdict', () => {
  for (const [channel, build] of Object.entries(ALL_CHANNELS)) {
    const input = build(REFUSAL);
    let thrown;
    try {
      assertNoPlanLimit(input);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown !== undefined, `${channel}: no throw`);
    assert.ok(thrown instanceof Error);
    assert.ok(thrown instanceof PlanLimitError);
    assert.equal(thrown.name, 'PlanLimitError');
    assert.ok(thrown.message.startsWith('plan limit: '), thrown.message);
    assert.deepEqual(thrown.hit, detectPlanLimit(input));
    assert.equal(thrown.hit.source, channel);
    assert.ok(thrown.message.includes(thrown.hit.matched), 'the message says what was matched');
  }
});

t('PlanLimitError: built directly it keeps the very hit it was given', () => {
  const hit = detectPlanLimit({ stdout: REFUSAL });
  const err = new PlanLimitError(hit);
  assert.equal(err.hit, hit);
  assert.equal(err.name, 'PlanLimitError');
  assert.ok(err.message.startsWith('plan limit: '));
  assert.ok(err instanceof Error);
  assert.equal(typeof err.stack, 'string');
});
