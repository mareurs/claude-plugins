# Migrating-trackers skill (Plan L-E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `migrating-trackers` skill in `codescout-companion/skills/` that drives `codescout trackers inventory|apply|check` one tracker at a time, with the user's approval of each mapping and of each result, and that never lets record text pass through the model.

**Architecture:** The skill is prose plus two reference files. It holds the judgment the commands do not: which tracker is next, the writer precondition, the mapping draft, the proposal screen, the reading of the three JSON shapes, recovery, and the commit by exact names. A disposable fixture repository proves that the skill's worked mapping is legal against the real binary (apply exits 0, check is clean), the same way `tests/test-skill-call-legality.sh` proves the skills' tool calls. Agent scenarios run without the skill first (RED) and with it after (GREEN), per superpowers:writing-skills.

**Tech Stack:** Markdown (skill), bash (fixture builder and colocated test), `jq`, `git`, the `codescout` binary built from codescout `experiments` (`6ebe4091b` or later).

**Spec:** `../codescout/docs/superpowers/specs/2026-11-15-tracker-migration-design.md` (id `4c4ab2c12c52d73e`), § The per-tracker loop, § Source kinds, § The mapping file, § Re-runs and late records, § Preconditions, § Repo scope. Where the code differs from the spec, the codescout manual page `../codescout/docs/manual/src/concepts/tracker-migration.md` § Differences from the design spec is right (mapping key `kind`, top-level `hot_view_none`, `constant` needs no `status_map`, override `slug`, `title_alias` writes no field, `index_table` table form, every source frontmatter key listed as dropped).

**Where it runs:** worktree `/home/marius/work/claude/claude-plugins.worktrees/migrating-trackers`, branch `feat/migrating-trackers` from `main`. Task 5 runs in the codescout worktree `/home/marius/work/claude/codescout/.worktrees/tracker-migration` (branch `feat/tracker-migration`, which equals `experiments` at `6ebe4091b`).

## Global Constraints

- Record text never passes through the model. The skill never writes an entry file by hand and never retypes a record (spec Anti-goals). Manual folders (`frictions/`, `effort-steering/`, `bistriceanu/`, `mechanisms/`) use `doc(create)` and `doc(move)` only after the user approves, and still run `check` for its structural items.
- The mapping file is never committed. Its path is `$(git rev-parse --absolute-git-dir)/tracker-migration/<key>.toml` (inside the git directory, so no `git add` can stage it).
- Nothing is written before the user approves the mapping (spec loop step 4). Nothing is committed before the user approves the check report and the diff (step 7), and then only on the user's word (step 8).
- `check` runs before the migration commit. After the commit the sources are not at `HEAD` and `check` exits 2.
- A commit stages exact file names, never a directory: the union of `written`, `deleted` and `already_applied` from the last `apply --json` that exited 0. Then `git diff --cached --name-only` in a separate call, then `git commit -m … -- <the same names>`. The message carries one line that summarises the overrides and drops.
- The skill never pushes.
- One tracker per run of the loop (spec M6).
- Writer precondition, verbatim from spec § Preconditions: refuse every `*-session-log`, `reconnaissance-patterns`, and `tracker-hygiene-log`, naming the skill or hook that writes it. The list lives in the skill.
- Binary: `codescout` on `PATH`, then the MCP-configured command, then `~/.cargo/bin/codescout` (the order of `resolveCodescoutBinary` in `codescout-companion/hooks/lib.mjs`). Probe with `<bin> trackers --help`; a non-zero exit or empty output stops the skill with "this codescout has no tracker migration; build codescout `experiments` at `6ebe4091b` or later".
- JSON shapes, verified against `src/cli/trackers.rs` and `src/librarian/tracker_migration/{inventory,plan}.rs` at `6ebe4091b`:
  - `inventory --json`: `{sources: [{path, line_count, records: [{token, heading_line, level, title, first, last, raw_status, status_origin, stated_dates}], sections: [{start, last, first_line}], possibles, repeats, tables, status_values: {<value>: <count>}, no_status, row_only, no_row, duplicate_rows, disagreements, dropped_frontmatter: [{key, value}]}], mentions: {citations, paths, ids, code: [{file, line, origin}]}, sidecar: {path, prompt} | null}`.
  - `apply --json`, exit 0: `{written, deleted, already_applied, review: {derived_dates, dropped, skipped_rewrites, row_only, no_row, disagreements, path_mentions, time_based, renamed_keys}}`.
  - `check --json`, ran: `{clean, blocking, shortened, review}`.
  - Refused (apply exit 1; check exit 1 in three cases only): `{"refused": [<reason>, …]}`.
  - Could not run (exit 2): `{"ran": false, "reason": "<one line>"}`.
- Exit codes: 0 done or clean, 1 refused or not clean, 2 could not run.
- `SKILL.md` stays under 20480 bytes, frontmatter `name: migrating-trackers`, description starts with "Use when". No harness-specific split (CLAUDE.md § Skill layout: split only with real harness or OS content; this skill has none beyond the binary order above).
- Skill edits are `committed`, not `live`, until `./scripts/release.sh` runs (CLAUDE.md § Plugin Install Path). This plan does not release.
- Commits are path-only (`git commit -m … -- <paths>`). No push.

## Review Focus

1. **A large inventory.** `bug-fix-session-log` has 399 records; `inventory --json` overflows the `run_command` output. Expected: the skill reads it through `jq` queries on the `@cmd_*` buffer, never the whole JSON into context. Pinned by Task 3's structural test (the reference names `jq` queries for `status_values`, `possibles`, `mentions.code` and `sidecar`).
2. **An apply that stops mid-write (exit 2).** Plan L-E1 deferred minor Task 9 M-2: the stop JSON carries no `written`/`deleted` lists. Expected: the skill either re-runs `apply` (the next run completes the first; files already written come back as `already_applied`, so the union of the three lists is the full set) or restores from the `git status --porcelain` snapshot it saved before `apply`. Pinned by scenario S5 (Task 4) and a structural assertion in Task 3.
3. **A commit after check.** Expected: check runs first; a check after the commit exits 2 with "not in HEAD". Pinned by scenario S3 and the colocated test (it runs `check` after a fixture commit and asserts exit 2).
4. **`check` refusal shape.** `check` prints `{"refused": …}` with exit 1 when the mapping does not parse. Expected: the skill treats it as "not clean" and shows the reasons, not as a crash. Pinned by the colocated test (a broken mapping gives exit 1 and a `refused` key) and scenario S4.
5. **A JSON file that reads a tracker.** Expected: the proposal shows each `mentions.code` file with a proposed class, and a `reader` stops the tracker. Pinned by the fixture (it holds `scripts/demo-reader.json`) and scenario S1.

---

### Task 1: Fixture repository and scenario file

**Files:**
- Create: `tests/lib/tracker-migration-fixture.sh`
- Create: `tests/scenarios/migrating-trackers.md`

**Interfaces:**
- Produces: `bash tests/lib/tracker-migration-fixture.sh <dir>` makes `<dir>` a git repository with one commit and prints nothing on success, exit 0. Later tasks rely on these exact paths and tokens in it:
  - `docs/trackers/demo-log.md`: frontmatter `kind: tracker`, `title: Demo log`, `status: active`; a preamble paragraph; `## Index` with the table header `| ID | Status | Title |` and rows `D-1`, `D-2`, `D-3` (`D-3` has no heading: a row-only record); `## D-1 — first finding` with `**Status:** open` and `**Date:** 2026-01-05` and a body line that names `D-2`; `## D-2 — second finding` with `**Status:** fixed-verified`; `## D-2b follow-up` (a possible record); `## Template for new entries`.
  - `docs/augmentations/docs-trackers-demo-log.yaml` with a `prompt:` key (a sidecar).
  - `scripts/demo-reader.json` whose text names `docs/trackers/demo-log.md` (a code mention).
  - `docs/trackers/foo-session-log.md`: one `## F-1 — x` record (the writer-precondition case).
  - Whatever `.codescout/` files `codescout trackers inventory` needs to run (find them by running it; record what you found in the report).
- Produces: `tests/scenarios/migrating-trackers.md`, a manual agent evaluation in the shape of `tests/scenarios/tracker-hygiene-archive-naming.md`: cases S1–S5 below, each with input, the prompt given to the agent, and the expected outcome; plus empty `## Baseline (RED)` and `## With skill (GREEN)` sections that Tasks 2 and 4 fill.

| Case | Input and prompt | Expected outcome |
|---|---|---|
| S1 Propose | fixture; "migrate `docs/trackers/demo-log.md` into a lifecycle collection" | inventory with `--json`; one proposal screen: status table with counts covering `open` and `fixed-verified`, the `D-3` row-only record and `row_title_column`, a decision asked for `D-2b`, the sidecar fate, the class of `scripts/demo-reader.json`, `hot_cap`/`stale_after`, the mapping path under the git directory; stops for approval; runs no `apply` |
| S2 Writer | fixture; "migrate `docs/trackers/foo-session-log.md`" | refuses before `inventory`, naming the reconnaissance skill as its writer |
| S3 Apply to commit | fixture plus an approved mapping; "the mapping is approved, go on; commit when it is good" | `apply --json`, `check --json` (exit 0), shows the review, waits for the user's word; then stages the exact names, reads `git diff --cached --name-only`, commits path-only; no push; `check` never after the commit |
| S4 Refusal | fixture plus a mapping whose `status_map` lacks `fixed-verified` | reads `{"refused": …}` (exit 1), shows each reason, proposes the mapping fix and waits; writes no entry file by hand |
| S5 Stop | fixture; told that `apply` exited 2 with `{"ran": false, "reason": "… could not be written …"}` after some writes | re-runs `apply` to complete, or restores from the pre-apply `git status --porcelain` snapshot; never `git checkout -- docs/` or `git clean` on paths outside the plan |

- [ ] **Step 1:** Write `tests/lib/tracker-migration-fixture.sh` with `set -euo pipefail`, refusing a non-empty `<dir>`. Commit identity inside the fixture: `git -c user.name=fixture -c user.email=fixture@example.invalid commit`.
- [ ] **Step 2:** Run `bash tests/lib/tracker-migration-fixture.sh "$(mktemp -d)/r"` then `~/.cargo/bin/codescout trackers inventory --project <dir> --json docs/trackers/demo-log.md`. Expected: exit 0; `status_values` has `open` and `fixed-verified`; `row_only` holds `D-3`; `possibles` names `D-2b`; `sidecar.path` is the yaml; `mentions.code` names `scripts/demo-reader.json`. Change the fixture until all five hold; record the JSON in the report.
- [ ] **Step 3:** Write the scenario file.
- [ ] **Step 4:** Commit: `git add tests/lib/tracker-migration-fixture.sh tests/scenarios/migrating-trackers.md`, then `git commit -m "test(migrating-trackers): fixture repository and agent scenarios" -- tests/lib/tracker-migration-fixture.sh tests/scenarios/migrating-trackers.md`.

### Task 2 (controller): RED baseline

**Files:** Modify `tests/scenarios/migrating-trackers.md` § Baseline (RED).

- [ ] **Step 1:** For each of S1–S5, build a fresh fixture and dispatch one Sonnet subagent with the case prompt, the fixture path, the binary path, and the codescout manual page path. No skill. Tell it to stop where a real user would be asked, and to print what it would show the user.
- [ ] **Step 2:** Read each transcript. Write, per case, the deviations from the expected outcome and the agent's own words for each choice, verbatim. A case with no deviation is written as such; it then needs no guidance (writing-skills: no failing control, nothing to fix).
- [ ] **Step 3:** Commit the scenario file path-only, message `test(migrating-trackers): RED baseline`.

### Task 3: The skill and its colocated test

**Files:**
- Create: `codescout-companion/skills/migrating-trackers/SKILL.md`
- Create: `codescout-companion/skills/migrating-trackers/references/mapping.md`
- Create: `codescout-companion/skills/migrating-trackers/references/recovery.md`
- Create: `codescout-companion/skills/migrating-trackers/migrating-trackers.test.sh`

**Interfaces:**
- Consumes: Task 1's fixture builder and paths; Task 2's baseline record (read it first: the skill addresses those deviations and no others).
- Produces: `references/mapping.md` holds one complete mapping for the fixture's `demo-log.md` between the lines `<!-- example-mapping:start -->` and `<!-- example-mapping:end -->`, inside one ```` ```toml ```` fence.

- [ ] **Step 1: Write the failing test** `migrating-trackers.test.sh`, in the shape of `codescout-companion/skills/spec-drift/spec-drift.test.sh` (pass/fail counters, exit status = no failures). Structural assertions on `SKILL.md`:
  - frontmatter `name: migrating-trackers`; description starts with `Use when`; size < 20480 bytes;
  - names each of `trackers inventory`, `trackers apply`, `trackers check`, `--json`, `"refused"`, `"ran": false`, `already_applied`, `git diff --cached --name-only`, `-- <`, `absolute-git-dir`, `reconnaissance-patterns`, `tracker-hygiene-log`, `-session-log`, `trackers --help`, `cutover plan`, `--no-old-catalog`;
  - the line that runs `check` comes before the line that runs `git commit` (compare `grep -n` line numbers);
  - does not contain `git add docs/`, `git add -A`, `git push`, `read_markdown`, `edit_markdown`;
  - every `references/*.md` it links exists;
  - `references/mapping.md` names `jq` and each of `status_values`, `possibles`, `mentions.code`, `sidecar`;
  - `references/recovery.md` names `git status --porcelain` and `already_applied`.
  
  Runtime assertions (each SKIPs loudly and passes when no `codescout` binary has `trackers`; a SKIP line says "NOT checked"):
  - extract the example mapping, build a fixture, write the mapping to `$(git -C <fixture> rev-parse --absolute-git-dir)/tracker-migration/demo-log.toml`, run `apply --no-old-catalog --json` with `LIBRARIAN_DB` set to a path that does not exist: exit 0, and `written`, `deleted` are non-empty;
  - `check --json`: exit 0 and `.clean == true`;
  - a copy of the mapping with `fixed-verified` removed from `status_map`, run against a fresh fixture: `apply` exits 1 and prints a `refused` key;
  - a copy that is not TOML: `check` exits 1 and prints a `refused` key;
  - commit the fixture (stage the union of the three lists by name), then `check`: exit 2 and a `ran` key equal to `false`.
- [ ] **Step 2:** Run `bash codescout-companion/skills/migrating-trackers/migrating-trackers.test.sh`. Expected: FAIL (`skill exists`).
- [ ] **Step 3:** Write `SKILL.md`: the spec's eight-step loop (Pick, Inventory, Propose, Approve, Apply, Check, Review, Commit) as numbered steps, each naming its command and its stop point. Pick proposes an order: trackers that no code reads and no skill writes, smallest first; the user may reorder. A preconditions block: the binary probe; the writer list; the catalog facts (on an `apply` refusal that names the cutover, run `codescout cutover plan`, show it, and on the user's word `cutover export` and commit that export by its own exact names before this tracker; on "no old catalog", ask the user whether the repository ever had one, and pass `--no-old-catalog` only on a "no"); manual folders; the move-out outcomes (snapshot → report, policy → conventions, by `doc(move)`); and repos with no `PREFIX-N` ledgers (`sections`, `whole`); a quick-reference table of the three JSON shapes and exit codes; day-one staleness (spec loop § Day one); and the baseline deviations from Task 2 addressed in the form writing-skills § Match the Form to the Failure picks for each. `references/mapping.md`: the `jq` queries, how each inventory key becomes a mapping key (manual page § The mapping file), the proposal screen as a fixed list of parts in order, the pre-classing of `mentions.code` (a file under `tests/` or `fixtures/` → propose `fixture`; any other → ask), and the worked example. `references/recovery.md`: the pre-apply snapshot, the exit-2 stop (re-run or restore), restore by exact names, and late records (manual page § Late records: commit the merge first, `target.existing = true`, every `sections` entry `to = "drop"`).
- [ ] **Step 4:** Run the colocated test, then `bash tests/test-skill-call-legality.sh` and `bash tests/test-skill-frontmatter-yaml.sh`. Expected: all PASS (the runtime part PASS, not SKIP, on this machine).
- [ ] **Step 5:** Commit the four files path-only, message `feat(migrating-trackers): skill that drives codescout trackers inventory, apply and check`.

### Task 4 (controller): GREEN and refactor

**Files:** Modify `tests/scenarios/migrating-trackers.md` § With skill (GREEN); the skill files when a loophole is found.

- [ ] **Step 1:** Re-run S1–S5 as in Task 2, now with the skill's `SKILL.md` path in each prompt ("read and follow this skill").
- [ ] **Step 2:** Record per case: complies or not, with the agent's words for each deviation.
- [ ] **Step 3:** For each new deviation, dispatch the Task 3 implementer with the case and the transcript lines; it changes the skill, re-runs the colocated test, and commits. Re-run only that case. At most two refactor rounds; a case still failing after that is a ledger ruling.
- [ ] **Step 4:** Commit the scenario file path-only, message `test(migrating-trackers): GREEN run`.

### Task 5: codescout help text and manual pointer

**Files (codescout worktree):**
- Modify: `src/main.rs:290` — the `trackers` doc comment says "`apply` and `check` are not built yet".
- Modify: `docs/manual/src/concepts/tracker-migration.md` — "The `migrating-trackers` skill will drive these commands. It is part of Plan L-E2, a separate and later plan. Until then, you run the commands yourself."

- [ ] **Step 1: Write the failing test** in `tests/cli_trackers.rs`: `trackers_help_names_no_unbuilt_subcommand` runs the binary with `trackers --help` and asserts the output does not contain `not built yet` and does contain `apply` and `check`.
- [ ] **Step 2:** Run `scripts/with-slot.sh cargo test --test cli_trackers trackers_help_names_no_unbuilt_subcommand`. Expected: FAIL.
- [ ] **Step 3:** Rewrite the doc comment: the three subcommands, what each writes, exit codes 0/1/2. Rewrite the manual sentence: the `migrating-trackers` skill of codescout-companion drives the commands; the operator can still run them by hand.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit path-only, message `docs(trackers): help text and manual name apply and check as built`.
- [ ] **Step 6 (controller):** Check that `/tmp/.git` and `~/.cache/cc-tmp/.git` do not exist (bug `3c5fa35d9d2754a7`). Merge `experiments` into the branch, run `./scripts/gate.sh` on that exact tree, read `GATE EXITS` (all lanes 0), check no commit subject in the range contains `(E4`..`(E8`, and fast-forward `experiments` from the main checkout. No push.

---

## Rulings

- **R1 Mapping path.** The spec leaves the default path to the builder. The skill uses `$(git rev-parse --absolute-git-dir)/tracker-migration/<key>.toml`: never tracked, per worktree, and it survives the session. Cost if wrong: the operator looks for the file in `.codescout/`; the skill prints the path in the proposal.
- **R2 L-E1 Task 9 M-2 stays deferred.** The stop JSON lacks lists, but a completing re-run returns the full set (`written` ∪ `deleted` ∪ `already_applied`), and the pre-apply snapshot covers a restore. Cost if wrong: a restore after a stop that cannot be re-run depends on the snapshot.
- **R3 Task 5 lands in this plan.** The help text is wrong today and the skill's probe reads that command. Cost: one gate run.
- **R4 RED and GREEN are controller tasks.** The SDD implementer may not dispatch subagents; the scenarios need fresh agents.
