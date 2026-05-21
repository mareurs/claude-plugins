---
name: buddy:introspect
description: Run mid-session introspection on one or all currently summoned specialists. Unlike `/buddy:dismiss`, the specialist stays active afterward. Pass a specialist name to introspect just that one (e.g. `/buddy:introspect hamsa`); pass nothing to introspect all active.
---

You are running mid-session introspection on one or all summoned specialists. Unlike `/buddy:dismiss`, this does NOT clear `active_specialists` — the specialist remains summoned afterward. Use this when you want to capture lessons from work done so far without ending the engagement. The argument passed by the user is `$1`.

## Step 1 — Resolve the target

If `$1` is empty or absent, target is `"ALL"` — skip to Step 2.

Otherwise, match `$1` to the best specialist using their descriptions below. Trust intent over exact words — "debug", "yeti", "debugging" all resolve to `debugging-yeti`.

| Directory | When to introspect |
|---|---|
| `debugging-yeti` | Bug resists surface fixes, flaky tests, failure doesn't match symptom |
| `testing-snow-leopard` | Designing test suites, coverage gaps, flaky tests, asserting correctness |
| `refactoring-yak` | Structural code transformation, cleaning up tangled code |
| `ml-training-takin` | Training loops, inference parity, ML pipeline issues |
| `performance-lammergeier` | Profiling, latency, throughput, optimization |
| `planning-crane` | Work planning, task sequencing, breaking down large efforts |
| `architecture-snow-lion` | System boundaries, module design, interface decisions |
| `docs-lotus-frog` | Technical writing, documentation architecture |
| `data-leakage-snow-pheasant` | ML data hygiene, evaluation integrity, train/test leakage |
| `security-ibex` | Security review, threat modeling, vulnerability analysis |
| `prompt-hamsa` | Improving a prompt — critique, drafting from scratch, diagnosing model misbehavior, or coaching toward eval-driven iteration |

If the argument is genuinely ambiguous (matches multiple equally), print the table above and stop.

The resolved target must be currently in `active_specialists`. If it is not, report `→ <directory> is not currently summoned. Use /buddy:summon first.` and stop.

## Step 2 — Run introspection

**If target is `"ALL"`:** for each entry in `active_specialists` (alphabetical order), run the introspection block below scoped to that specialist.

**Otherwise:** run the introspection block for the resolved `<directory>` only.

**Introspection block** (emit verbatim as a system-style nudge to the buddy, then await its response):

> Mid-session reflection, <directory>: looking at this session so far from your POV, what have you learned that would change how you'd act next time? For each lesson:
> 1. Decide global vs project scope (see the Memory Protocol).
> 2. Propose a slug (3–6 kebab-case words).
> 3. Read the target channel's `INDEX.md` and check for slug match or ≥2-tag overlap with a topically similar hook. If matched, update the existing file; else create a new one.
> 4. Announce each save (`→ memory: <scope> / <specialist> / <slug> — <hook>`).
> 5. Stage project writes with `git add`. Global writes go to `${BUDDY_HOME:-~/.buddy}/memory/` directly — no mirroring.
>
> If nothing genuinely new came up, say so explicitly and stop. Do not invent lessons. You remain summoned after this — work continues.

Wait for the buddy to complete (zero or more saves).

If the project memory dir does not exist or the working tree is not a git repo, project writes during introspection are skipped silently — see the protocol's failure modes.

## Step 3 — Log the introspection

Append one line to `${BUDDY_HOME:-~/.buddy}/summons.log`:

- If target is `"ALL"`: `<unix timestamp>\tall\tintrospected`
- Otherwise: `<unix timestamp>\t<directory>\tintrospected`

Use bash via the `Bash` tool. Silent on failure — the log is advisory.

## Step 4 — Resume

The specialist(s) remain in `active_specialists`. The voice continues. Hand control back to the user — work resumes where it left off.
