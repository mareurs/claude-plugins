# Reconnaissance — worked entry exemplars

> **Load when:** you are about to write your first friction or win entry in a session
> and want a complete example of the shape. The `box add` call, the box creation and
> the close step all stay in `SKILL.md` § Phase 3 — only the two full exemplars live here.

---

These two entries are adapted from `codescout/docs/trackers/bug-fix-session-log.md`. Pattern your new entries on them, not on the bare template.

**Friction exemplar — a pre-dispatch scout that caught test-shape drift:**

```bash
codescout box recon add --kind friction \
  --title "jsonpath-impl: plan test assertions cite a non-existent RecoverableError.hint field" \
  --text body - <<'EOF'
**What happened:** 2026-05-18, reading the plan's Task 2 test code before dispatching
Task 1. The plan says `RecoverableError` has an accessible `.hint: Option<String>`
field, and its tests use `err.hint.as_deref().unwrap_or("")`. The scouted type at
`src/tools/core/types.rs:169` exposes `pub message: String` and
`pub guidance: Option<Guidance>`: there is no `.hint` field. There is a method
`.hint() -> Option<&str>` that returns text only for the `Guidance::Hint` variant. The
Display impl renders `"{message} — Hint: {text}"` and is the documented stable test
contract: `to_string().contains(...)` is the supported assertion shape. The plan was
written from the design spec, which did not pin the assertion-side accessor, and the
writing-plans phase did not scout `RecoverableError`.

**What I did:** Edited the Task 2 and Task 3 test code to use
`err.to_string().contains(...)` everywhere, which drops the `.hint` field reference.
The plan edit landed before any subagent ran. Without it, the first subagent's tests
would have failed `cargo check`.

**Worth keeping:** Scout a type's real accessors before a plan asserts on them; the
Display impl is the stable contract. Re-verify if `src/tools/core/types.rs` changes.
EOF
```

**Win exemplar — the win that the scout above produced:**

```bash
codescout box recon add --kind win \
  --title "jsonpath-impl: pre-dispatch recon caught the test-shape error before any subagent ran" \
  --text body - <<'EOF'
**What happened:** 2026-05-18, about to dispatch Task 1 of the jsonpath
negative-slice plan. The plan names *types* in its test assertions, not just *fns*, so
I scouted each referenced type's real field and method shape with
`symbols(name=<TypeName>, include_body=true)` before the first dispatch.

**What I did:** The scout found that `RecoverableError.hint` does not exist (the
friction entry of the same session) and I fixed the plan first. Without the scout,
Task 2's subagent would have written `err.hint.as_deref().unwrap_or("")` and failed
`cargo check` on the first parse test, then flailed through `.guidance`, `.hint()` and
`.to_string()` without the Display-impl context. Best case: one extra round trip per
failing test, about 11 for the 11 parser tests in Task 2. Worst case: the subagent
gives up and the controller re-scopes the plan mid-dispatch.

**Worth keeping:** Before the first subagent dispatch of a plan that names types in
test assertions, scout every such type. One datapoint so far; at a second, promote the
rule to CLAUDE.md as "scout every type whose accessors the plan asserts on".
EOF
```

Two things to copy from the exemplars: **specificity** (file paths, line numbers, actual identifier names) and **counterfactual evidence** (what the cost of not-scouting would have been, in concrete units like "11 round trips"). Vague entries do not compound; specific entries do.
