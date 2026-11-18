// steer.mjs — turns a Decision into the one sentence an adapter appends to a
// prompt, or into nothing. Pure and total: it never throws, and any input it
// cannot read as a well-formed decision and table yields null (no steering).

const STEERED_LEVELS = new Set(['shallow', 'deep']);

export function render(decision, table) {
  try {
    if (decision === null || typeof decision !== 'object') return null;
    const { level, reasons } = decision;
    // Without a readable reasons array we cannot rule out an explicit user
    // override, so we do not steer.
    if (!Array.isArray(reasons)) return null;
    // An explicit "ultrathink" wins and the core adds no second sentence.
    if (reasons.includes('user_override')) return null;
    if (!STEERED_LEVELS.has(level)) return null;
    if (table === null || typeof table !== 'object') return null;
    const { phrases } = table;
    if (phrases === null || typeof phrases !== 'object') return null;
    if (!Object.hasOwn(phrases, level)) return null;
    const phrase = phrases[level];
    return typeof phrase === 'string' && phrase.length > 0 ? phrase : null;
  } catch {
    return null;
  }
}
