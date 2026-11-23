---
name: reconnaissance
description: Use before subagent dispatch, before editing code that changes a struct, function signature, or API contract, or after a tool response contradicts the plan. Files plan-drift frictions and wins in the project's recon box.
---

# /codescout-companion:reconnaissance

A **seam** is a place where your next action depends on the current shape of code you have not read this session: a struct's fields, a function's signature, an API's response, a tool's actual output. Scout the seam before you act. When plan and reality disagree, externalize the gap as an entry in the project's recon box — a keyed entry can be cited from the next session; a gap kept in your head does not compound.

**REQUIRED SUB-SKILL:** None. See § *Composition with other skills*.

## When to Use

- **Before delegating to a subagent.** Scout the seam yourself first — read the affected symbols, confirm the plan's code matches reality. Subagents inherit drift; the controller absorbs it.
- **Before editing code whose shape you have not verified.** If the change names a struct, function, type method, or API you haven't read this session, read it before editing.
- **After a tool response disagrees with the plan.** Empty results where N were predicted, compile errors on plan code, a wrong field name, an unexpected status — signals that plan is stale or substrate moved.

## When NOT to Use

- **Read-only Q&A that *describes behavior*.** "What does X do?" — answer via `symbols(name=..., include_body=true)`. No scout, no entry. **But asserting a specific, checkable fact is not Q&A** — "it IS BLAKE3", "the field IS named Y", "it's at line N" — especially when the assertion will be presented as a recommendation or written into a doc. Read the symbol this session before you commit the fact. (`codescout:R-19`)
- **Genuinely no-decision edits.** Whitespace, comment typos, version-string bumps that no test asserts on. When in doubt whether an edit is "mechanical," scout — one extra `grep` costs less than one missed invariant. Editing a markdown file that backs an `include_str!`'d constant is NOT mechanical: see Phase 1's `include_str!`'d-constant bullet below.
- **Already in verification phase.** Use `verification-before-completion` for commit gating.
- **Already scouted this seam in the current session.** One pass per seam — re-scouting the same struct/function is noise unless the source has changed since.
- **Underspecified refactor prompts** (`"refactor X for readability"` with no shape contact named). Ask the user whether shape changes; do not scout speculatively.

## Method — Four Phases

```
1. Scout (read actual shape)
   ↓
2. Compare (plan vs reality)
   ↓
3. If gap     → plan drift: friction entry; tool friction: frictions inbox (Phase 3)
   If win     → win entry  (pattern that prevented worse)
   If match   → silent resume (no entry needed)
   ↓
4. Resume task + announce one-line outcome to user
```

### Phase 1 — Scout

For each symbol, type, or contract about to be touched:

- Read the symbol body: `symbols(name=..., include_body=true)`
- Read callers if shape changes: `references(symbol, ...)` or `call_graph(symbol, direction="callers")`
- For tools / external APIs: read the actual response shape, not docs. Run the call once, inspect output.
**Seam-class case law lives in a reference file, not here.** When the seam you are
scouting is one this project has already paid for, read
`references/seam-classes.md` (17 promoted laws — stale substrates, lossy renders,
claims about current state, green-but-uninformative results, empty populations,
migration ordering, instruments that write into what they measure). Use native
`Read`; the path is guard-exempt. Do not `@`-link it — that force-loads.


**Statusline marker (recommended).** Touch `.buddy/$SID/recon-active` once at scout start so the user's statusline shows `[recon]` for 30 minutes. The badge signals scout-in-progress; the user knows not to redirect mid-scout, which prevents abort-and-restart cost:

```bash
SID="${CLAUDE_CODE_SESSION_ID:-$(cat .buddy/.current_session_id 2>/dev/null)}" && \
  [ -n "$SID" ] && mkdir -p ".buddy/$SID" && touch ".buddy/$SID/recon-active"
```

**`$CLAUDE_CODE_SESSION_ID` first — the order is load-bearing**, because the statusline
resolves the sid from the harness while `.current_session_id` is last-writer and can name a
peer. Case law: `references/seam-classes.md`; guard: `tests/test-recon-count.sh` § 7.

Skip silently if the marker dir is unavailable — the skill works without the badge.

### Phase 2 — Compare

State what the plan / docs said vs. what reality holds. **Match** → resume, no entry. **Gap** → Phase 3 (friction). **Match, but the scout was non-trivial** (multiple files read, hidden contract surfaced, non-obvious shape) → Phase 3 (win): a pre-dispatch scout that prevented a subagent slip is a win even though nothing broke.

### Phase 3 — Externalize

Findings go into the repository's one **recon box**, key `recon`, a `worklog` stream that this skill makes at its first run.

**Route the gap first.** Plan drift (a plan, doc or memory disagrees with the code) takes a `friction` entry in the recon box, and a win takes a `win` entry. A **tool friction** (a codescout tool, hook or box verb cost you calls) goes to the frictions inbox, not the recon box: `codescout box frictions note --title "<one line>" --tool <tool name>`. Details and the no-box fallback: `references/tool-friction-routing.md`.

**Before you cite a confirming result as evidence, name the proposition it proves — then ask whether a broken world produces the same result.** An uncontended 10/10 is the output a still-racy test also gives. A green suite is the output a never-called guard also gives. A match count measures a text, never a cause. If the check cannot *express* the failure, its result is not evidence about the failure: write down what you actually established, and leave the rest as a thing to check rather than a thing concluded.

This is a check on the sentence you are about to write, not on your choice of tool — which is why it lives here and not in Phase 1. Both recorded failures happened in sessions that had already invoked this skill, while writing up a result (`codescout:R-125`, `codescout:bug-fix-session-log:F-78`).

**Make the box (first run only).** Run `codescout box` (in a linked worktree, `codescout box --project <main>`, below). If it does not list `recon`, make it once, then run the two commit lines the command prints:

```bash
codescout box new worklog recon --title "Reconnaissance log" --exit-when "the repository stops using reconnaissance"
```

**In a linked worktree** `<main>` is the main checkout, the first line of `git worktree list`, and every recon-box call takes `--project <main>` right after `box`: `codescout box --project <main>` to list, `codescout box new --project <main> worklog recon ...` to make the box (without it, `box new` writes the box into the worktree, where `<main>` cannot see it), and `codescout box --project <main> recon add|close|promote ...` to write (without it, a write is refused).

**One call per entry.**

```bash
codescout box recon add --kind friction --title "<topic>: <one line>" --text body - <<'EOF'
**What happened:** <the plan said X; the code holds Y, with path:line>

**What I did:** <the workaround or the plan edit>

**Worth keeping:** <the lesson in one line, or "nothing">
EOF
```

Start the title with the work stream's topic (`bug-fix`, `auth-refactor`, `migration-2026-q2`), not the seam: the box holds every topic of the repository. `--kind friction` is plan drift; `--kind win` is a pattern that prevented worse, and its body names what would have happened without it. A title that a live entry holds is refused. The call commits the entry and prints its key.

An entry ends with `codescout box recon close <entry> done|dropped --text reason -`, or, when its lesson moved to another box or a file, `codescout box recon promote <entry> --to <box>` / `--to-file <path>`, which writes the `**Promoted to:**` line. `close` and `promote` commit nothing and print a git line: run it. In a linked worktree the printed line has no `-C <main>`, so commit the paths it names with `git -C <main> add -- <path>` and `git -C <main> commit -m "<message>" -- <path>`. `codescout box recon` prints the statuses and rules.

**Count the entry.** Right after the `box add` call lands, bump the session counter so the statusline `[recon]` badge shows your scout output as an `F<n>/W<n>` suffix. Use the helper next to this skill (its directory is the "Base directory for this skill" path printed when the skill loaded):

```bash
python3 "<skill-dir>/recon_count.py" bump F 2>/dev/null || true   # friction
python3 "<skill-dir>/recon_count.py" bump W 2>/dev/null || true   # win
```

Best-effort — the `2>/dev/null || true` keeps a counter failure from ever breaking the turn. The counter is session-scoped (resets each CC session) and independent of the recon box's entry keys.

#### Worked exemplars

Two complete entries — one friction, one win — are in
`references/worked-examples.md`. Read them once, when writing your first entry of
a session; the template above is enough after that.

### Phase 4 — Resume + Announce

With verified context, return to the original task. Announce the scout outcome to the user in **one line**, citing the entry key if one was written:

- Match, no entry: `Recon: matched plan, proceeding.`
- Friction filed: `Recon: gap captured as [[<entry key>]] (plan cited .hint field; type has no such field). Proceeding with workaround.`
- Tool friction filed: `Recon: tool friction filed as [[<entry key>]].`
- Win filed: `Recon: scout prevented Task 2 test-shape slip; captured as [[<entry key>]].`

Cite the entry as `[[<entry key>]]` (the key `add` printed) in the next subagent dispatch prompt and in the commit message of any change that closes the gap.

## Stop Conditions

Reconnaissance is done when **any one** of:

- The shape question has a one-line answer cited from the code.
- The gap is captured: a recon-box entry or a frictions-inbox entry.
- The decision is made to revise the plan rather than the code (the plan owns the drift, not the substrate).

Do NOT loop. If the same seam needs scouting again later in the session, the substrate has moved — capture that as a separate friction entry rather than re-running this flow.

## Common Mistakes

- **Scouting after dispatching.** The subagent has already started; drift now lives in two contexts. Scout BEFORE dispatch.
- **Skipping the counterfactual on a win.** A win without a counterfactual reads as marketing. Name what would have happened without the pattern, with concrete evidence (round-trips saved, tests that would have failed, files that would have been wrongly edited).

## Composition with other skills

| Trigger | Skill | Reconnaissance role |
|---|---|---|
| Plan dispatched to subagent | `subagent-driven-development` | Scout the seam BEFORE dispatch |
| Plan code looks fictional | `writing-plans` | File a friction entry, revise plan inline before any subagent |
| Tool returned unexpected output | `systematic-debugging` | File it with `codescout box frictions note`, then debug from the baseline |
| About to claim work complete | `verification-before-completion` | Different timing — reconnaissance is at the seam, verification is at completion |

## The recon-patterns tracker (per project)

Promoting a recurring finding into a durable pattern, and auditing the promoted
set, is a separate workflow with its own routing rules and audit obligation. It is
in `references/patterns-tracker.md`. The four phases above do not depend on it —
read it when you are promoting or auditing, not to run recon.

## Skill maintenance

Trigger-string scoring lives in `<codescout-repo>/docs/evals/reconnaissance-trigger.md`. Re-score before any future description change. **Behavioral eval** (do triggered scouts produce useful friction entries?) lives at `<codescout-repo>/docs/evals/reconnaissance-output.md` — 14 cases drawn from the R-N ledger's hits and misses, with the six MISS cases (`codescout:R-2`, `codescout:R-4`, `codescout:R-8`, `codescout:R-10`, `codescout:R-19`, `codescout:R-23`) as a hard regression gate. **Baseline RUN** — 2026-09-04, `--paired` n=3, 15 cases: power 1 · tautological 7 · no-effect 7, only C4 clears Δ≥0.5. **Ship gate NOT met** (C2/R-4 at −0.67; C5 has no scenario). Re-score before any change targeting scout *behavior*, measuring the **`--paired` rate delta, never a raw pass-count** (L-15).

Version history is tracked via git on this file; see `git log -- codescout-companion/skills/reconnaissance/SKILL.md`.
