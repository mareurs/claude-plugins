# Harness-neutral identity for the remaining codescout commit guards — short design

**Status:** approved 2026-10-31. The scope was approved ("yes") with the recommendation to build on the Codex branch, and the owner-format decision below was delegated to the assistant, which chose **option 2**. Plan: [2026-10-31-session-identity-remaining-guards.md](../plans/2026-10-31-session-identity-remaining-guards.md). Nothing in this document is built.
**Parent:** [harness-neutral session identity design](2026-10-10-harness-neutral-session-identity-design.md) (approved 2026-10-10) and its bug, `docs/issues/2026-10-09-harness-neutral-session-identity-and-provenance.md`.
**Size:** small to medium. Five scripts and their tests, in the codescout repository.

## Intent and why

The approved spec made the gate, the formatter and the provenance path harness-neutral. Those now resolve a Claude or Codex root through `scripts/session_context.py`. The commit and publish guards were outside that scope. A Codex session looks like "no identity" to them.

Each guard treats "no identity" as "you are the only writer". `git-safe-reset.sh:59-65` says it in words: *outside a Claude session you are almost certainly the only writer to this checkout*. The parent spec rejects that premise: harness identity does not establish exclusive ownership of a checkout. For a Codex session the guards therefore either refuse (exit 2) or go inert, and an inert guard is a guard that fails open.

## Measured state (2026-10-31)

Read at the bytes unless marked *explorer*. The explorer was a read-only subagent; I re-read the two marked ✓.

| Script | Id read | Missing id | Neutral? |
|---|---|---|---|
| `gate.sh`, `fmt-mine.sh`, `file-provenance.py`, `attribute-red.py` | via `session_context.py` | explicit `missing` / `conflicting` state | yes |
| `commit-mine.sh` | `:41` | exit 2 (*explorer*) | no |
| `git-safe-reset.sh` ✓ | `:59` | exit 2 with advice to run bare `git reset` | no |
| `mutation-probe.sh` | `:139` | exit 2 (*explorer*) | no |
| `pre-commit-foreign-index.sh` ✓ | `:109` | silent exit 0; `--classify` exits 2 | no |
| `post-index-change-stage-log.sh` | `:113` | stays active, records owner `-` (*explorer*) | no |
| `hold-publish.sh`, `pre-commit-run.sh`, `pre-push-foreign-session-guard.sh`, `prepare-commit-msg-session-id.sh`, `resolve-sids.sh` | Claude-only on `experiments` | refuse or inert | **branch only** |

The last row is branch `feat/codex-publish-holds-20261027` in a Codex worktree (`/home/marius/.codex/worktrees/04e2/codescout`). It has two commits over `origin/experiments`, no upstream, and is merged nowhere. It adds `scripts/publish-identity.{sh,py}` (a bare id for Claude, `codex:<sid>` for Codex) and stores Codex holds under `refs/holds/_codex/<sid>`. It does not touch the five scripts in rows 2 to 6. Its review file says the implementer still owns the full Rust gate and closure lanes; I did not find a recorded pass.

No test runs any of the five with only `CODEX_SESSION_ID` set. Tests with the id unset exist for each (`env -u` in the shell tests).

## Goals

- The five scripts resolve identity through one resolver: a Claude root, a Codex root, or an explicit context. Conflicting or missing identity is an explicit state.
- Owners are namespaced `<harness>:<root id>` for non-Claude hosts. A Claude owner stays the bare id, so existing stage logs, trailers and refs keep their meaning.
- With a missing or conflicting identity each script keeps its present refuse-or-inert behaviour. Its message stops claiming that the caller is the only writer.
- Each script gets a Codex-only test, a mixed-harness own/peer test, and a conflicting-identity test.

## Non-goals

- No change to Claude behaviour or to the version 1 context contract.
- No hold storage, no `refs/holds/` change: the Codex branch owns that.
- No decision on the write-journal alternative for Codex owned formatting.
- No release, no install, no profile or cache change.

## Anti-goals (a failure even if the tests pass)

- Any path that fabricates a Claude id, uses a PID, or adopts a last-writer pointer to give a Codex session an identity.
- A Codex session whose staged files read as nobody's, so a peer's guard stays silent about them.
- Two helpers that resolve identity differently. The Codex branch already added one.

## Constraints

- The main codescout checkout is on `experiments` with another session's uncommitted work. All edits go in an isolated worktree. The explorer recommends `git worktree add -b <new> <path> origin/experiments`.
- The stage log is a cross-script contract. `post-index-change-stage-log.sh` writes the owner; `pre-commit-foreign-index.sh` and `commit-mine.sh` read it. The owner format must change in the writer and the readers together.
- The full leased gate is not optional, and no live-host claim is made from source tests.

## Approaches

1. **Land the Codex branch first, then build on its `publish-identity.sh` (recommended).** One helper. The five scripts then share the format the hold scripts already use. Trade-off: it is sequential, and it waits on the other branch's unrun gate lanes and on its owner.
2. **Build now on `origin/experiments`, calling `session_context.py` directly.** No wait. Trade-off: a second helper and a second owner format that someone must reconcile with `publish-identity.sh` later; the stage-log owner could disagree with the hold refs.
3. **Set `CLAUDE_CODE_SESSION_ID` from the Codex id in a shim.** Rejected by the parent spec: it fabricates an identity and cannot separate hosts.
4. **Defer.** Cheapest. Codex sessions stay refused or unguarded by these five scripts.

**Recommendation:** approach 1. Reason: the owner format is the shared contract, and a second helper is the anti-goal.

## Open decision — owner format (found while planning, 2026-10-31)

Measured before writing the plan; this corrects the "left to the builder" line below.

- The codescout server fills `usage.db` `tool_calls.cc_session_id` with the native root, stored **bare**. The real Codex root `01a12f3a-ae7e-7882-87e8-8b6e4eb81706` has 9 rows there, none qualified, and no row in the database has a `codex:` form. The column does not record the harness.
- `post-index-change-stage-log.sh` `foreign_writer` takes a peer's id from that column and tests `[ "$sid" = "$me" ]`. `pre-commit-foreign-index.sh` tests `[ "$owner" != "$me" ]` (line 274) and prints owners in `Co-Authored-Session-Id:` trailers and `CODESCOUT_INDEX_ACK`.
- The Codex branch's `publish-identity.py` prints `codex:<sid>` for Codex.
- If `$me` were `codex:<sid>` while the write record holds `<sid>`, a Codex session's own earlier write would read as a peer's. That is the failure class of the archived bug `2026-10-13-attribute-red-compares-a-raw-session-id-with-qualified-owners-so-your-own-write-reads-as-a-peers`.

Options for the stage-log owner:

1. **Bare native root.** Matches `usage.db`; no comparison changes. The stage log cannot tell hosts apart, and trailers and ACK tokens from these scripts disagree with the branch's `codex:` tokens.
2. **`codex:<sid>` written, one equivalence function at every comparison (recommended).** The writer knows its own harness, so it records the qualified form. Every comparison strips a `codex:` or `claude-code:` prefix before comparing, because the write record's bare ids carry no harness. One function in `publish-identity.sh`. Trade-off: a same-UUID collision across hosts is treated as the same writer; I rate that as negligible, but the parent spec's own rule in `resolve-sids.sh` (never borrow a same-UUID Claude row for Codex) shows the project cares. Confidence: medium.
3. **Record the harness in `usage.db`.** The server would store `principal_key`, with a migration. Most correct, and the largest: a Rust change that needs the full Rust gate lanes. Best as a follow-up to option 2.

## Left to the builder

- The stage-log owner string is no longer left to the builder: see *Open decision* above.
- Whether each script needs `CODESCOUT_CONTEXT_FILE` or can resolve from the native environment.
- Wording of the new messages.

## Verification obligations

- Codex-only, mixed own/peer, and conflicting tests per script, run from the unset and the Codex-only environment.
- Mutation checks on the owner comparison (a Codex owner read as a peer, and the reverse); each must turn a test red.
- The full leased gate, with each lane code reported. Source tests do not establish live Codex behaviour.

## Plugin repository (separate, not part of this design)

`codescout-companion/skills/reconnaissance/recon_count.py` reads only `CLAUDE_CODE_SESSION_ID`. Without it, it falls back to `.buddy/.current_session_id`, a last-writer pointer that can name a peer session. Under Codex it may therefore count against a peer. Whether to stop using the pointer is a policy choice for the maintainer; the statusline that reads these counts is Claude-only.
