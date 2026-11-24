# Session Passover

## Session Passover

Hand a live work thread to a fresh session (e.g. after compaction, or one of several
parallel threads on this repo). **Manual and selective** — write one only when a session is
worth resuming; a finished session needs none.

**Author (outgoing session):** create it as a catalog artifact so the discovery query finds it —
`doc(action="create", kind="tracker", tags=["passover"], topic="<thread>", time_scope="dated:YYYY-MM-DD", extra={"origin_session_id":"<id>","branch":"<branch>"}, title=…, rel_path="docs/trackers/passover-<topic>-YYYY-MM-DD.md", body=…)`,
filling State / Next actions / Working state / Anti-goals from the `docs/templates/passover-template.md`
skeleton. Get the session id from `cat .codescout/cc_session_id` (or `.buddy/.current_session_id`);
omit `extra`/`origin_session_id` if absent. (`time_scope` + the `extra` custom-frontmatter passthrough
require codescout ≥ the build that fixed bug `13164fb35d6f71ed`; on older builds keep those keys in a
body-level block.)

**Discover (incoming session):** run, early in the session —

    doc(action="find", kind="tracker",
        filter={"and":[{"tags":{"contains":"passover"}}, {"status":{"eq":"active"}}]})

**`contains`, not `in` — `in` on a tag array silently matches nothing.** Measured 2026-08-27:
`{"tags":{"in":["passover"]}}` returned 0 against 5 live tagged passovers; swapping the op to
`contains` returned all of them. `contains` is the documented array-membership op; `in` means
scalar-field-is-one-of. This query carried `in` from the day it was written, inherited from the
librarian guide's own leaf example (`{"tags": {"in": ["foo","bar"]}}` — wrong upstream too). A
zero here reads exactly like "no handoffs", so the broken op hid every live thread instead of
failing loudly.

**Zero results → run a positive control before proceeding, not instead of it.** The `in`-vs-
`contains` bug above is exactly the failure mode a zero result cannot distinguish from "no
handoffs": a silently-broken query and a genuinely empty corpus read identically. Re-run the
same query shape against a tag known to exist in this repo's trackers (e.g.
`{"tags":{"contains":"session-log"}}` — this repo always has several) with no status filter.
If THAT also returns zero, the query mechanism itself is broken — stop and investigate before
trusting any "no handoffs" result. If it returns rows, the passover zero was a real zero;
proceed normally. (`repo-remediation-backlog:RM-23`.)

One → resume it (auto-confirm if your own session id equals
`origin_session_id`, which holds on `--resume`). Multiple → pick by `topic`/`branch`.
Always run Next-actions step 1 (verify state) before acting.

**Consume:** when done, flip `status: archived`, append `## Consumed — YYYY-MM-DD`, and
`doc(action="move", …)` into `docs/trackers/archive/` (never bare `git mv`).
