---
id: '054a59826c4caa91'
kind: spec
status: draft
title: Skill call legality reads the callable doc schema, because nine doc actions left the MCP list - design
tags:
- codescout-companion
- skills
- skill-call-legality
- codescout-project-2
- design
topic: skill call legality after nine doc actions left the MCP list
---

# Skill call legality reads the callable `doc` schema - design

## Purpose

Codescout (the sibling repository `../codescout`) has taken nine `doc` actions out of the schema that `tools/list` advertises. They stay callable. Two things in this repository read the advertised list and now disagree with the server: one test, and the call form that some skills prescribe. This page says what breaks, in what order to fix it, and what is still undecided. A session in this repository can continue from here without reading the codescout session.

## Reader

A session working in `claude-plugins`, on `codescout-companion` skills or on the tests under `tests/`. It needs no codescout context beyond the facts below.

## What changed in codescout (verified 2026-11-19)

- Step 2 of "project 2" (thinning the `doc` tool out of the MCP surface). The nine actions `graft`, `state_at`, `rekey_prefix`, `gather`, `link`, `graph`, `list_stale`, `event_list` and `augment` leave the advertised list. Eighteen actions stay callable. The enum that `tools/list` returns now holds nine: `find`, `get`, `create`, `update`, `move`, `delete`, `append_entry`, `update_entry`, `event_create`.
- 17 parameters that only the hidden actions read leave the advertised schema too: `from_id`, `into_id`, `commit`, `timestamp`, `from`, `to`, `src_id`, `dst_id`, `rel`, `depth`, `rels`, `include_events`, `threshold_hours`, `kinds`, `since`, `until`, `merge`.
- The server does **not** validate input against the advertised enum. A hidden action still runs when `tools/call` names it. Codescout checks this in-process (`a_hidden_action_still_reaches_its_arm_over_the_server_call_path`, `src/server.rs`). It has **not** been observed through a real stdio server or a real MCP client yet. See "Open: R7".
- The full schema is still printed by `codescout call doc --schema` (18 actions, no project needed). `codescout call doc '<json>'` and `codescout py` reach every action.
- Landed on codescout `experiments` as `1ac4fdc95` (eight commits, `0e4ebc910` to `1ac4fdc95`; patch-id of the code diff `00f232386b8ae274ecffb015b642acfdd319a06d`). The installed binary does not change until the operator runs `./scripts/rb.sh` in codescout. After that run, `~/.cargo/bin/codescout` serves the thinner list.
- Codescout side, for context: plan `docs/superpowers/plans/2026-11-19-nine-doc-actions-leave-the-mcp-list.md` (id `323cb52d9b593b2f`); decision entry `docs/trackers/ledgers/horizon/2026-11-18-project-2-goes-in-steps-and-the-door-records-usage-first.md` (id `b2c415aa6ed51f01`); horizon entry `docs/trackers/ledgers/horizon/2026-11-18-where-the-advertised-versus-callable-split-of-doc-goes-and.md` (id `5d1e8b0061273d52`).

## What breaks here (read from the files on 2026-11-19; not yet run against the new binary)

### 1. The legality suite fails after the rebuild

`tests/lib/skill_contract_calls.py:111-112` builds its schemas from `tools/list`:

```python
schemas = {tool["name"]: tool["inputSchema"]
           for tool in cs._rpc("tools/list", {})["result"]["tools"]}
```

`validate_signature` (same file, lines 96-104) then rejects an unknown parameter and an action that is not in `properties["action"]["enum"]`. Against the new binary, every example below fails with `unknown action` or `unknown argument(s)`:

| file | line | call |
|---|---|---|
| `codescout-companion/skills/tracker-hygiene/SKILL.md` | 18 | `doc(action="list_stale")` |
| same | 68 | `doc(action="list_stale")` |
| same | 115 | `doc(action="augment")` (a fragment: signature check only) |
| same | 174 | `doc(action="list_stale", threshold_hours=168)` |
| same | 191 | `doc(action="list_stale")` |
| same | 211 | `doc(action="link", ...)` (spans lines) |
| same | 383 | `doc(action="link", src_id=<successor>, dst_id=<old>, rel="supersedes")` |
| same | 438 | `doc(action="list_stale")` |
| `codescout-companion/skills/spec-drift/SKILL.md` | 71 | `doc(action="event_list", id="<id>", kinds=["verdict"])` |

Nine call sites. The old binary still passes, so nothing is red today. `tests/test-skill-call-legality.sh` SKIPs without a binary, so CI stays green. The red appears on a local `tests/run-all.sh` and in the `release.sh` preflight, as soon as `codescout` on `PATH` (or in `~/.cargo/bin`) is the new binary. `find_binary()` in `tests/lib/cs_isolated.py` resolves `CODESCOUT_BIN`, then `PATH`, then `~/.cargo/bin/codescout`.

The execution half of the suite is not affected by the schema: `IsolatedCodescout.call` sends `tools/call`, and the server does not check the enum. That is an expectation until the suite runs against the new binary once.

### 2. Skill and command text that prescribes a hidden action in MCP form

| file | line | what |
|---|---|---|
| the nine call sites in section 1 | | `tracker-hygiene` (eight) and `spec-drift` (one) |
| `codescout-companion/skills/reconnaissance/references/patterns-tracker.md` | 89 | prose: "the `doc` tool's `rekey_prefix` action supports a dry run" |
| `sdd/commands/review.md` | 26 | `doc(action="event_list", id="<spec id>", kinds=["verdict"])` |
| `sdd/skills/sdd-flow/references/artifacts.md` | 49 | same call |

The two `sdd` files lie outside `SKILLS = ROOT / "codescout-companion" / "skills"` (`tests/lib/skill_call_legality.py:164`), so no test reads them today.

### 3. What does not break

- `tests/recon_bootstrap_test.py` calls `graph` (lines 255-306) through `tools/call` and reads no schema. The file contains no `tools/list`.
- `tests/lib/skill_call_legality.py` calls `event_list` through `cs.call` (lines 374, 527). Same path.
- `grep -rn "tools/list" tests/` finds one schema consumer: `skill_contract_calls.py:112`. The other hits are `session-bridge` fixtures and a probe stub that do not touch `doc`.

## Design, part 1: the suite validates `doc` against the callable schema

This part is certain and small. Do it before, or in the same session as, the codescout rebuild.

**Decision:** for the tool `doc` only, `run_catalog_examples` takes its schema from `codescout call doc --schema` run with the same binary (`cs.binary`). Every other tool keeps the `tools/list` schema.

**Why this reading:** a skill example is *legal* when the server accepts it. The server accepts all 18 actions. The advertised list is a presentation choice made for the model's context budget, and it says nothing about legality.

**Sketch** (`tests/lib/skill_contract_calls.py`):

- A pure function `callable_doc_schema(binary, env)` runs `[binary, "call", "doc", "--schema"]` in an empty temporary directory with the sandbox `HOME` and `CODESCOUT_SQLITE_DIR` that `IsolatedCodescout.__enter__` builds. It returns the parsed top-level schema (`{"type": "object", "properties": {...}}`) or `None` when the command exits non-zero or prints no JSON object.
- `run_catalog_examples` starts from the `tools/list` dictionary, then replaces `schemas["doc"]` when the function returns a schema.
- `None` means a binary that predates the door. Keep the `tools/list` schema and emit `info("door schema unavailable: doc validated against tools/list")`. A silent fallback would hide a mismatch, so the INFO line is required.
- Add one INFO line that counts examples whose action is in the callable enum but not in the `tools/list` enum. Today it must read 9. It is the skill side of codescout's measure of the rule ("how often is a hidden action needed"), and it shows a drift in either direction.

**Tests without a binary** (`tests/lib/test_skill_contract_calls.py`, run by `tests/test-skill-contract-extraction.sh`):

- The same example (`{"action": "list_stale", "threshold_hours": 168}`) passes `validate_signature` against a synthetic callable schema and raises `ValueError` against a synthetic advertised schema. The pair is the contract.
- The loader returns `None` for a non-zero exit and for non-JSON output (use a fake runner argument, as the existing tests use plain dictionaries).

**Mutation check** (the repo's practice, see the bug file below): point the code back at `tools/list` for `doc` and run the suite with `CODESCOUT_BIN` set to a binary that carries the new list. It must fail on the nine sites above. Restore, and it must pass.

**Verification before the operator rebuilds:** build the codescout `experiments` binary in a worktree slot (`scripts/with-slot.sh cargo build`), set `CODESCOUT_BIN` to it, and run `bash tests/test-skill-call-legality.sh`. Expected before the fix: nine FAIL lines. Expected after: no FAIL, and the first real stdio observation that a hidden action is accepted by `tools/call` (the `link` case at `skill_contract_calls.py:209-235` executes it).

The bug file `docs/trackers/ledgers/bugs/2026-11-24-no-automated-check-that-the-tool-calls-a-skill-prescribes.md` (id `af3292c4ea2d4712`, status fixed) records how this suite was built. Add a short dated section there when part 1 lands; do not reopen the bug.

## Design, part 2: how skills tell an agent to call the nine actions (decided: B, see below)

Part 1 makes the tests honest. It does not decide what the skills should say. The options:

| option | what changes | cost | risk |
|---|---|---|---|
| **A. Leave the MCP form** | nothing in the skills | none | an MCP client might refuse an action outside the advertised enum (R7, unverified). A model that never read the skill does not know the action exists |
| **B. A, plus one sentence** in `tracker-hygiene` and `spec-drift`: the action is not in the MCP list and is called the same way | two files | small | same as A when R7 fails |
| **C. Door form**: `codescout call doc '{"action":"list_stale"}'`, or a `codescout py` snippet | rewrite the nine sites and the `sdd` pair | needs a shell in the agent that runs the skill; a subagent may lack one | the extractor regex at `skill_contract_calls.py:19` finds only `doc(`, `librarian(`, `index(`, `memory(`, `workspace(`. Door-form examples would **leave the checked population silently** unless the extractor learns the door form |

**Recommendation: B, gated on the codescout wire check.** The skill text is the discovery path for a rare action, which is the design intent of the split: a rare action is named where it is needed. No evidence yet shows that a client refuses it, so a rewrite (C) pays a certain cost for an unobserved risk. Confidence: medium. It rests on R7, which nobody has measured.

**Gate:** the codescout session runs `./scripts/rb.sh` and `/mcp`, loads the `doc` schema (expects 9 actions), then calls a hidden action with a hidden parameter over the real MCP wire (for example `doc(action="graph", id=<id>, depth=1)`), ideally on Claude Code and on Codex. It records the result in the decision entry `b2c415aa6ed51f01` (see References). Read that entry before choosing A, B or C.

- Wire check passes: choose B. Edit the two skill files, bump the plugin version per `docs/trackers/version-bump-checklist.md`, release.
- Wire check fails on a client: choose C for that client's skills, extend the extractor to the door form in the same change, and tell the codescout session. Codescout's own fallback (revert `1d1ceccbb`) then comes up for decision on its side.

## Decision, part 2: option B (2026-11-19)

The wire check that the gate asks for was run for Claude Code on 2026-11-19. A fresh `claude -p --model haiku` with `--strict-mcp-config` and only the rebuilt codescout (nine `doc` actions advertised) read the nine-action enum and still called `doc(action="list_stale", limit=1)`. The client did not refuse; the server ran the call. The result is recorded in the codescout decision entry `b2c415aa6ed51f01`. Codex was measured the same day from the codescout repository: `codex exec --ignore-user-config` (Codex 0.170.0) with only the rebuilt server and `default_tools_approval_mode="approve"` read the nine-action list, ran a control `doc(action="find", limit=1)`, then ran `doc(action="list_stale", limit=1)`. The server returned a result and `isError` was false. A first run without the approval setting failed with `MCP tool call requires approval, but approval policy is never`; that is the approval policy and not the enum.

Chosen: **B**. One sentence was added to `codescout-companion/skills/tracker-hygiene/SKILL.md` and to `codescout-companion/skills/spec-drift/SKILL.md`. It says that the action is missing from the MCP tool list, is called in the same form, and that `codescout call doc '<json>'` reaches it from a shell. The shell pointer stays as a fallback for a client or version that refuses. The two `sdd` files and `patterns-tracker.md` are unchanged: they are outside the checked population and name the same call form. If a later client or version shows a refusal, option C for that client comes back to this page.

## Not in scope

- The prose that describes hidden parameters in advertised `doc` descriptions: a codescout residual.
- Changing the `librarian` or `memory` tool surfaces. The same split may come later for other tools. Part 1 is written for `doc` only, so a second tool needs its own line.
- A `claude-plugins` hook or hint that names `doc` actions. `grep` for the nine names finds none outside the skills, the `sdd` pair, tests and archived plans.

## Acceptance

1. `CODESCOUT_BIN=<new binary> bash tests/test-skill-call-legality.sh` exits 0 with no FAIL; the INFO line reports 9.
2. `bash tests/test-skill-contract-extraction.sh` passes, including the two new unit tests.
3. The mutation check above fails as described and is restored.
4. `tests/run-all.sh` is green with the new binary on `PATH`.
5. Part 2 is recorded: the option chosen, the wire-check result it rests on, and the date.

## R7: closed 2026-11-19

"R7" is the codescout plan's name for one risk: an MCP client may refuse a call whose action is not in the advertised enum. The server validates nothing here (codescout `src/server.rs`; the wire check of 2026-09-11 covered required and undeclared parameters, **not** enums). Part 2 was decided on 2026-11-19 after a Claude Code wire check, and the same check on Codex 0.170.0 passed the same day (see "Decision, part 2"). A later client or version may behave differently.

## References

- Codescout plan: `../codescout/docs/superpowers/plans/2026-11-19-nine-doc-actions-leave-the-mcp-list.md`.
- Codescout decision entry (step 2 status, wire-check result): `../codescout/docs/trackers/ledgers/horizon/2026-11-18-project-2-goes-in-steps-and-the-door-records-usage-first.md`.
- Codescout horizon entry (where the split goes, what else reads the tool name `doc`): `../codescout/docs/trackers/ledgers/horizon/2026-11-18-where-the-advertised-versus-callable-split-of-doc-goes-and.md`.
- Codescout code: `src/librarian/advertised.rs` (`DOC_HIDDEN`, `advertised_schema`), `src/server.rs` (`advertised_mcp_tools`), `tests/cli_call.rs` (the `--schema` and `graph` door tests).
- This repo: `tests/lib/skill_contract_calls.py`, `tests/lib/skill_call_legality.py`, `tests/lib/cs_isolated.py`, `tests/test-skill-call-legality.sh`, `tests/test-skill-contract-extraction.sh`.
