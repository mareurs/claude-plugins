---
kind: entry
status: held
title: 'A-2: buddy/scripts/summon_bootstrap.py::build_payload — the advisor projection rule, as assembled into a …'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 20, id `A-2`) on 2026-11-25; audited 2026-08-27.

**History:** `docs/research/2026-11-25-prompt-hamsa-audit-history.md` § 2026-08-27 — advisor projection rule: base arm first, eval HELD, clause no-shipped (row `A-2`)

**Artifact:** buddy/scripts/summon_bootstrap.py::build_payload — the advisor projection rule, as assembled into a summon payload

**Symptom:** No observable failure. Requested behaviour: an advisor's Voice and output contract are OMITTED from the payload, and the spec's premise is that omission ALONE suffices for the model to behave as though they are absent. Every shipped test asserts on the payload string; none observes a model.

**Gap:** The rule is negation-only and the negation is IMPLICIT. Nothing in the payload tells the model what to do with an advisor's heuristics — it must infer the constraint from absence, which is weaker than a stated 'don't', and a stated 'don't' is already the weak form (H1). Read as a stranger, the payload offers three unattributed sections tagged '— advisor: X' and no statement of what that tag obliges.

**Move:** Do NOT write a header clause. Run the base arm first under a pre-registered ship/no-ship rule (H12). The spec's own cheap remedy — one clause in the payload header — PRE-EMPTS exactly what the eval measures, so insurance and measurement are mutually exclusive and the measurement has to go first or never.

**Prediction:** Base arm at or near ceiling → NO-SHIP the header clause; omission alone suffices and the addition would be a dead rule (6 of 9 codescout intervention audits landed no-ship). Operationally: A2 RETAIN ≥ 4/5 and behavioural leak ≤ 1/5, against A1's instrument control.

**Eval status:** present(n=5 per arm; A1 instrument control complete, RETAIN 5/5)

**Confidence:** medium

## Record

## A-2 — the advisor projection rule: omission alone suffices, so the header clause was no-shipped

**Audited:** `buddy/scripts/summon_bootstrap.py::build_payload` — the advisor projection rule
as assembled into a summon payload. **2026-08-27.**

No observable failure; the audit was of a *requested behaviour*. An advisor's `Voice` and
output contract are omitted from the payload, and the spec's premise was that omission alone
suffices. The gap: the rule is **negation-only and the negation is implicit** — nothing tells
the model what to do with an advisor's heuristics, so it must infer the constraint from
absence, which is weaker than a stated *don't*, and a stated *don't* is already the weak form.

The move turned on a genuine conflict: the spec's own cheap remedy — one clause in the payload
header — **pre-empts exactly what the eval measures**, so insurance and measurement were
mutually exclusive and the measurement had to go first or never. Outcome **held**: base arm at
ceiling, header clause **no-shipped**. Six of nine codescout intervention audits have landed
no-ship.

Structured fields live in `params.audits`; this section exists to make `A-2` citable.

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
