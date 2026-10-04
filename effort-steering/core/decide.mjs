// Rules compiler and decision function. Pure: no I/O, and neither export throws.
// The shipped rules file is empty; the engine is exercised with rules held in tests.

import vm from 'node:vm';
import { extractFeatures } from './features.mjs';

export const POLICY_VERSION = 1;

// Rule regexes only ever see this many leading characters of a prompt.
const SCAN_LIMIT = 20000;
// A regex is slow when it needs more than this long on the probe string.
const SLOW_REGEX_MS = 50;
const SLOW_REGEX_PROBE = 'a'.repeat(40) + '!';

const LEVELS = new Set(['shallow', 'deep']);
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
const NUMBER_KEYS = new Set(['minChars', 'maxChars', 'minRetries']);
const BOOLEAN_KEYS = new Set(['isQuestion', 'hasStackTrace', 'startsWithSlash', 'prevTurnFailed', 'planMode']);
const REGEX_KEYS = new Set(['matchesAny', 'matchesNone']);

const has = (set, key) => set.has(key);
const isRank = (c) => typeof c === 'string' && Object.hasOwn(CONFIDENCE_RANK, c);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

class RuleError extends Error {}
const reject = (code) => {
  throw new RuleError(code);
};

// Compile one regex source. Returns a plain RegExp reused at decision time.
function compileRegex(src) {
  if (typeof src !== 'string') reject('invalid_when_value');
  let re;
  try {
    re = new RegExp(src, 'i');
  } catch {
    reject('invalid_regex');
  }
  try {
    vm.runInNewContext('new RegExp(src, "i").test(s)', { src, s: SLOW_REGEX_PROBE }, { timeout: SLOW_REGEX_MS });
  } catch (err) {
    reject(err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'slow_regex' : 'invalid_regex');
  }
  return re;
}

function compileWhen(when) {
  if (!isPlainObject(when)) reject('invalid_when');
  const keys = Object.keys(when);
  if (keys.length === 0) reject('empty_when');
  for (const key of keys) {
    if (!has(NUMBER_KEYS, key) && !has(BOOLEAN_KEYS, key) && !has(REGEX_KEYS, key)) reject('unknown_when_key');
  }
  const out = {};
  for (const key of keys) {
    const value = when[key];
    if (has(NUMBER_KEYS, key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) reject('invalid_when_value');
      out[key] = value;
    } else if (has(BOOLEAN_KEYS, key)) {
      if (typeof value !== 'boolean') reject('invalid_when_value');
      out[key] = value;
    } else {
      // An empty list is refused: an empty matchesAny never matches and an
      // empty matchesNone always does, and both hide a mistake.
      if (!Array.isArray(value) || value.length === 0) reject('invalid_when_value');
      out[key] = value.map(compileRegex);
    }
  }
  return out;
}

function compileRule(raw) {
  if (!isPlainObject(raw)) reject('invalid_rule');
  if (typeof raw.id !== 'string') reject('invalid_id');
  if (!LEVELS.has(raw.level)) reject('invalid_level');
  if (!isRank(raw.confidence)) reject('invalid_confidence');
  return {
    id: raw.id,
    level: raw.level,
    confidence: raw.confidence,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    when: compileWhen(raw.when),
  };
}

function ruleLabel(raw, index) {
  try {
    if (isPlainObject(raw) && typeof raw.id === 'string') return raw.id;
  } catch {
    // fall through to the positional label
  }
  return `#${index}`;
}

export function compileRules(raw) {
  try {
    if (!isPlainObject(raw)) {
      return { version: 0, rules: [], skipped: [{ id: '(file)', error: 'invalid_rules_file' }] };
    }
    const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 0;
    const list = raw.rules;
    if (!Array.isArray(list)) {
      return { version, rules: [], skipped: [{ id: '(file)', error: 'invalid_rules_file' }] };
    }
    const rules = [];
    const skipped = [];
    list.forEach((entry, index) => {
      try {
        rules.push(compileRule(entry));
      } catch (err) {
        const error = err instanceof RuleError ? err.message : 'invalid_rule';
        skipped.push({ id: ruleLabel(entry, index), error });
      }
    });
    return { version, rules, skipped };
  } catch {
    return { version: 0, rules: [], skipped: [{ id: '(file)', error: 'invalid_rules_file' }] };
  }
}

function matches(when, features, signals, text) {
  if (when.minChars !== undefined && !(features.chars >= when.minChars)) return false;
  if (when.maxChars !== undefined && !(features.chars <= when.maxChars)) return false;
  if (when.isQuestion !== undefined && features.isQuestion !== when.isQuestion) return false;
  if (when.hasStackTrace !== undefined && features.hasStackTrace !== when.hasStackTrace) return false;
  if (when.startsWithSlash !== undefined && features.startsWithSlash !== when.startsWithSlash) return false;
  if (when.prevTurnFailed !== undefined && signals.prevTurnFailed !== when.prevTurnFailed) return false;
  if (when.planMode !== undefined && signals.planMode !== when.planMode) return false;
  if (when.minRetries !== undefined && !(signals.retryCount >= when.minRetries)) return false;
  if (when.matchesAny !== undefined && !when.matchesAny.some((re) => re.test(text))) return false;
  if (when.matchesNone !== undefined && when.matchesNone.some((re) => re.test(text))) return false;
  return true;
}

// A failure signal is anything but an absent or an explicit `false`: a non-JS
// harness may send 1, 'true' or null, and the guard must then fail unsafe. This is
// the ONE place the value is normalized to a boolean. Both the shallow guard and a
// rule's `when.prevTurnFailed` read it, so the two cannot disagree.
const isFailure = (v) => !(v === undefined || v === false);

function readSignals(raw) {
  const s = isPlainObject(raw) ? raw : {};
  return {
    prevTurnFailed: isFailure(s.prevTurnFailed),
    retryCount: typeof s.retryCount === 'number' && Number.isFinite(s.retryCount) ? s.retryCount : 0,
    planMode: s.planMode === true,
  };
}

const result = (level, confidence, reasons) => ({ level, confidence, reasons });
const FALLBACK_ERROR = () => result('default', 'low', ['internal_error']);

export function decide(ctx, rules) {
  try {
    const prompt = ctx === null || ctx === undefined ? undefined : ctx.prompt;
    const signals = readSignals(ctx === null || ctx === undefined ? undefined : ctx.signals);
    const features = extractFeatures(prompt);

    // 1. An explicit ultrathink always wins, before any rule is read.
    if (features.explicitDeep) return result('deep', 'high', ['user_override']);

    const text = typeof prompt === 'string' ? prompt.slice(0, SCAN_LIMIT) : '';
    // Only entries that look like compiled rules take part: an object with a `when`
    // object, a level in the vocabulary and a known confidence class. Anything else is
    // ignored, so a raw rule cannot put a level or class outside the vocabulary into a
    // decision. This is not a validator: the id and the inside of `when` are not
    // checked here. compileRules does that, and its output is what belongs here.
    const list =
      isPlainObject(rules) && Array.isArray(rules.rules)
        ? rules.rules.filter((r) => isPlainObject(r) && isPlainObject(r.when) && LEVELS.has(r.level) && isRank(r.confidence))
        : [];
    const matched = list.filter((r) => matches(r.when, features, signals, text));

    // 2. No rule matched.
    if (matched.length === 0) return result('default', 'low', ['no_rule']);

    // 3. Highest confidence class wins; a shallow/deep tie at that class is default.
    const top = Math.max(...matched.map((r) => CONFIDENCE_RANK[r.confidence]));
    const atTop = matched.filter((r) => CONFIDENCE_RANK[r.confidence] === top);
    const ids = atTop.map((r) => r.id);
    const level = atTop[0].level;
    if (atTop.some((r) => r.level !== level)) return result('default', 'low', ['tie_shallow_deep', ...ids]);
    const confidence = atTop[0].confidence;

    // 4. Guards.
    if (level === 'shallow' && (top < CONFIDENCE_RANK.high || signals.prevTurnFailed)) {
      return result('default', 'low', ['guard_shallow', ...ids]);
    }
    if (level === 'deep' && top < CONFIDENCE_RANK.medium) {
      return result('default', 'low', ['low_confidence', ...ids]);
    }

    // 5. Otherwise the level, the class and the ids at that class and level.
    return result(level, confidence, ids);
  } catch {
    return FALLBACK_ERROR();
  }
}
