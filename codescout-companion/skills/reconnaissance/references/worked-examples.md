# Reconnaissance — worked entry exemplars

> **Load when:** you are about to write your first F-N / W-N entry in a session
> and want a complete example of the shape. The severity rubric, status
> vocabulary and the `append_entry` call all stay in `SKILL.md` § Phase 3 —
> only the two full exemplars live here.
>
> Split out of `SKILL.md` 2026-09-01. Content is verbatim.

---

#### Worked exemplars

These are real entries from `codescout/docs/trackers/bug-fix-session-log.md`. Pattern your new entries on these, not the bare template.

**F-N exemplar — a pre-dispatch scout that caught test-shape drift:**

```markdown
## F-3 — Plan test assertions cited non-existent `RecoverableError.hint` field

**Observed:** 2026-05-18, pre-dispatch reconnaissance for the jsonpath
negative-slice implementation plan. About to dispatch Task 1.

**When:** Reading the plan's Task 2 test code, about to dispatch the
subagent for Task 1.

**Expected (plan):** `RecoverableError` has accessible `.hint: Option<String>`
field; plan tests used `err.hint.as_deref().unwrap_or("")`.

**Got (scouted reality):** `RecoverableError` at `src/tools/core/types.rs:169`
exposes `pub message: String` and `pub guidance: Option<Guidance>` — there is
NO `.hint` field. There IS a method `.hint() -> Option<&str>` that returns the
text only for the `Guidance::Hint` variant. Display impl renders
`"{message} — Hint: {text}"` and is the documented stable test contract:
`to_string().contains(...)` is the supported assertion shape.

**Probable cause:** Plan was written from the design spec; spec didn't pin the
assertion-side accessor shape; writing-plans phase didn't scout
`RecoverableError`. The scout-helper-fn-bodies rule (W-1, same session log)
applies to type shapes too.

**Workaround:** Edit Task 2 + Task 3 test code to use
`err.to_string().contains(...)` everywhere. Drops the `.hint` field reference.

**Severity:** med — would have caused first subagent's tests to fail
`cargo check`; controller would absorb the failed-task drift mid-dispatch.

**Status:** fixed-verified — plan edit landed before any subagent ran.

**Valid:** dated 2026-05-18

True of `RecoverableError`'s field/method shape at that commit; re-verify if `src/tools/core/types.rs` changes.

**Rests on:** the Display impl being the documented stable test contract (`to_string().contains(...)`), not a `.hint` field.

**Fix idea / Pointer:** Plan task 2 + 3, this session.
```

**W-N exemplar — the win that the F-3 scout produced:**

```markdown
## W-2 — Pre-dispatch recon caught test-shape error before any subagent ran

**Observed:** 2026-05-18, about to dispatch Task 1 of the jsonpath
negative-slice plan (subagent-driven-development mode).

**Pattern:** Before the first subagent dispatch on a plan that names *types*
in test assertions (not just *fns*), scout each referenced type's actual
field/method shape: `symbols(name=<TypeName>, include_body=true)` for any
type whose accessors the plan tests mention.

**Counterfactual:** Without this scout, Task 2's first subagent would have
written `err.hint.as_deref().unwrap_or("")` and failed `cargo check` on
the first parse test. The subagent would have flailed (probable retries
with `.guidance`, `.hint()`, `.to_string()`) without the Display-impl
contract context. Best case: 1 extra round-trip per failing test
(~11 for the 11 parser tests in Task 2). Worst case: subagent gives up,
controller re-scopes plan mid-dispatch.

**Confirming data points:**
1. F-3 (this session) — `RecoverableError.hint` field cited by plan did
   not exist; scout caught it pre-dispatch.
2. Pending: any future plan that names types in assertions.

**Impact:** med — saves ≥1 failed subagent task and prevents controller
context absorption.

**Promote-when:** A second pre-dispatch recon catches a similarly hidden
type-shape mismatch. At 2 datapoints, promote to CLAUDE.md as
"Before dispatching the first subagent of an implementation plan, scout
every type whose accessors the plan asserts on."

**Status:** validated — single datapoint, drift caught + fixed before
any subagent dispatch. Awaiting promotion criterion.

**Valid:** dated 2026-05-18

One confirmed datapoint; promote-when threshold (2 datapoints) not yet reached.

**Rests on:** the F-3 finding, same session — this win is F-3's counterfactual, not independent evidence.
```

Two things to copy from the exemplars: **specificity** (file paths, line numbers, actual identifier names) and **counterfactual evidence** (what the cost of not-scouting would have been, in concrete units like "11 round-trips"). Vague entries do not compound; specific entries do.

