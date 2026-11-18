// Pure prompt-feature extraction. No I/O. Every regex is linear: no nested
// quantifiers, and the only unbounded scans are anchored to a line start.

const PY_TRACEBACK = /Traceback \(most recent call last\)/;
const NODE_FRAME = /^[ \t]+at [^\n]*:\d+:\d+/m;
const SLASH_COMMAND = /^\s*\/[A-Za-z][\w:-]*(\s|$)/;
const ULTRATHINK = /\bultrathink\b/i;

export function extractFeatures(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  const trimmed = text.trim();
  return {
    chars: trimmed.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    isQuestion: trimmed.endsWith('?'),
    hasStackTrace: PY_TRACEBACK.test(text) || NODE_FRAME.test(text),
    startsWithSlash: SLASH_COMMAND.test(text),
    explicitDeep: ULTRATHINK.test(text),
  };
}
