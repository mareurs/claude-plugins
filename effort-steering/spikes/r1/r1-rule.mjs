// R1, the first candidate effort-routing rule: a prompt that holds a stack trace is shallow.
// Not shipped: core/rules.json stays empty until the operator rules on the R1 result
// (docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md).
// Confidence must be `high`: decide.mjs turns every shallow result below `high` into `default` (guard_shallow).

export const R1_RULE = Object.freeze({
  id: 'r1-stack-trace-shallow',
  level: 'shallow',
  confidence: 'high',
  reason: 'a pasted stack trace marks a fix with exact expected values',
  when: Object.freeze({ hasStackTrace: true }),
});

export const R1_RULES = Object.freeze({ version: 1, rules: Object.freeze([R1_RULE]) });
