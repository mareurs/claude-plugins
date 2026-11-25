# session-bridge: wake an idle Claude Code session on an addressed notice

Status: draft, not approved. Nothing in it is built. Gates G1 to G3 pass in headless mode and in the interactive TUI, G4 is measured for a short timeout only, G5 failed for a crash and changed the design.

## Problem

`post_notice(to=<claude session>)` is the only way to send one message to a Claude Code session. It shows at the receiver's next prompt or tool call. An idle receiver never sees it until a human types (`session-bridge/README.md:177`, `skills/coordinating-sessions/SKILL.md:101`). `send_message` refuses a Claude target by operator decision (spec `2026-11-17-session-bridge-opencode-design.md:26`). The sender therefore cannot reach an idle Claude session at all.

Codex and OpenCode targets do not have this gap: `send_message` queues a prompt that starts a normal turn (`README.md:74`, `README.md:119`). The gap is the **Claude Code receiver** only.

## What the code shows (verified 2026-11-26)

- **The wake channel of Claude Code is an exit code.** A hook entry with `asyncRewake: true` runs as a long-lived process. When it exits with code 2, the host wakes the idle session and gives it the stderr text. The companion uses this for background jobs: `codescout-companion/hooks/hooks.json:173-176`, `hooks/wake-on-job-end.mjs:3-9` (`timeout: 7200`). The operator confirms that this wake works.
- **The companion wake engine is job-shaped.** `runWatch` (`background-wake/engine.mjs:11`) reads a job record and checks `server_pid` and `handle`. A notice has none of these, so the engine cannot watch a notice store. Only the adapter idea carries over (`adapters/claude-code.mjs:6-16`: `deliver` writes stderr).
- **Other harnesses use other wake mechanisms.** VS Code/Copilot holds an `AgentStop` hook up to 1 780 s and forces one continuation (`hooks/wake-vs-agent-stop.mjs:1-4`, `HOLD_CAP_MS`). The wake capability manifest has measured rows for `claude-code` 2.1.312 and `codex` 0.165.0 on linux, all `ready: false` (`contracts/fixtures/background-wake/manifest.json`).
- **At-most-once delivery already exists.** `direct::take` (`src/direct.rs:25-55`) reads `direct_after(id, cursor)`, moves the per-session cursor first, then renders the text. A watcher can call `take` and inherit the guarantee.
- **The binary already runs per hook.** `hooks/run.sh` calls `session-bridge hook <event>`. `main.rs:115-166` routes `session-start`, `prompt`, `post-tool`. The binary reads `notices.db` and `EndpointState` (`src/state.rs:29-49`, which has `worker_pid` and `session_id`).

## Decision

**Decision:** The `session-bridge` binary gets a `watch` mode that a Claude Code `asyncRewake` hook runs per session. It waits for an addressed notice, calls `direct::take`, prints the rendered text on stderr and exits 2.

**Context:** The receiver is idle, so only a process the host already tracks can wake it. The binary owns the store, the cursors and the rendering. The companion owns none of them.

**Alternatives considered:**
- *Reuse the companion `runWatch`.* Rejected: job-shaped (see above), and it would make `session-bridge` depend on `codescout-companion`, which are independent plugins today.
- *Let `send_message` deliver to Claude.* Rejected here: it reverses the operator decision of 2026-11-17 and needs a decision of its own. It would not solve the idle case anyway, because delivery still needs a hook to run.
- *A generic wake trait over all harnesses.* Rejected: one concrete (Claude Code). Codex and OpenCode already wake through `send_message`. Add an adapter only when a harness has a measured wake and no `send_message` path.
- *Start `claude -p --resume` for the receiver.* Rejected: it forks a second process and a second transcript, not a wake of the live session.

**Consequences:**
- now easier: a peer can reach an idle Claude session. The coordinating-sessions skill can say "wakes" instead of "does not wake".
- now harder: a wake starts a model turn, so the **receiver's profile pays**. Today it pays nothing (`README.md:175`). Two sessions can also wake each other in a loop.

**Change scenarios absorbed:**
- A new harness gets a measured wake: add a `watch` adapter for it. The store, cursors and text do not change.
- The host changes the wake channel (a new hook field): only the hook entry and the exit path change.

**Revisit-when:** the host adds a documented way to inject a prompt into an idle session; or measurement gate G2 fails.

**Confidence:** medium-high. G1 to G3 pass in both modes. The wake window is bounded by the hook timeout, whose maximum is unmeasured.

## Behaviour

1. **Arm.** `hooks.json` gets two `asyncRewake` entries that run `run.sh watch`: `SessionStart` (a fresh session that never ran a turn) and `Stop` (after each turn, which is when the session becomes idle; this also re-arms the watcher after each wake). Both measured (G1, G3).
2. **Singleton.** `watch` takes a lock keyed by endpoint (profile, pid) and exits 0 at once when a live watcher holds it. `EndpointState` records the watcher pid next to `worker_pid`.
3. **Wait.** `watch` polls `direct_after` for every session id of the endpoint (the current id and earlier ids after `/clear`, as `take` does) without moving a cursor. It stops at its own deadline with exit 0, set below the hook `timeout` so the host never has to send TERM (the companion does the same: 7000 s under 7200 s). It also exits 0 when the endpoint's Claude pid is gone (gate G5: a killed host leaves the watcher running).
4. **Wake.** On a notice it calls `take`. When `take` returns text, it writes the text to stderr and exits 2. When `take` returns nothing, it keeps waiting.
5. **Opt-in on the receiver.** The watcher arms only when the receiver's profile enables it (setting name open, default off). The receiver owner decides who may spend its tokens.
6. **Sender feedback.** `post_notice(to=...)` says in one line whether the receiver has a live watcher: `queued: wakes the session if idle` or `queued: shows at its next prompt or tool call`. It never says `delivered`.
7. **Loop guard.** The receiver wakes at most once per minimum interval and at most N times per hour (values open). Over the limit, the notice stays queued and shows at the next prompt or tool call.
8. **Text.** The wake text is the existing addressed-notice rendering: peer data, not an instruction, with the reply route `post_notice(to=<sender>)`.

No new tool parameter. The sender does not choose to wake: the receiver's opt-in decides.

## Harness table

| Receiver | Wake path | In this spec |
| --- | --- | --- |
| Claude Code | `asyncRewake` hook, exit 2 | new |
| Codex | `send_message` starts a turn | none; unchanged |
| OpenCode | `send_message` queues a prompt | none; unchanged |
| VS Code/Copilot | `AgentStop` hold in the companion | out of scope |

## Measurement gates

Measured 2026-11-26 on Claude Code 2.1.332, linux, in two modes: **headless** (`claude -p --input-format stream-json`, model haiku, user and project settings plus a probe `--settings` file) and the **interactive TUI** (`claude --model haiku --settings <probe>` inside `tmux`). The probe hook slept, then wrote a marker to stderr and exited 2. Probe scripts: scratchpad of the authoring session, not committed.

| Gate | Question | Result |
| --- | --- | --- |
| G1 | An `asyncRewake` hook from `SessionStart` keeps running after the event returns | **Pass** in both modes. Headless: alive until its own exit at 12 s. TUI: alive until its own exit at 20 s, in a session that never ran a turn. |
| G2 | Exit 2 wakes an **idle** session; the stderr text reaches the model | **Pass** in both modes. Headless: turn 1 ended at 3.8 s, the hook exited 2 at 12.8 s, a new turn started at 13.0 s and the model answered the exact marker. TUI: with no prompt typed, the exit 2 produced a `Stop hook feedback` line and the model answered `WAKE-ACK-1`. The wake text shows to the user under that label. |
| G3 | A `Stop` hook entry with `asyncRewake` re-arms the watcher | **Pass** in both modes. A `SessionStart` watcher woke the session, the wake turn ended, `Stop` started watcher 2, which woke it again (`WAKE-ACK-1`, `WAKE-ACK-2`). A counter file stopped the chain. |
| G4 | Largest accepted `timeout`, and the behaviour at the deadline | **Partly.** At the deadline the host sends TERM to the watcher, silently: with `timeout: 6` the watcher got TERM at 6 s and the TUI showed nothing. An idle session then has **no watcher** until its next turn ends. The largest accepted value is not measured; the companion ships `7200` (`hooks.json:176`). |
| G5 | The watcher dies with its session | **Fail for a crash, pass for `/exit`.** After `kill -9` of the host (headless), the watcher stayed alive. After `/exit` in the TUI the watcher got TERM within 1 s. (A headless stdin close was slow, more than 20 s; that is not the TUI path.) |

Consequence of G5: the watcher must check that its Claude pid is alive on each poll and exit 0 when it is not (Behaviour step 3). The job-end wake of the companion has the same defect, measured with a real `run_command` background job: the MCP server exits after the host `kill -9`, but the watcher and the job stay alive (bugs box, `2026-11-25-wake-on-job-end-watcher-outlives-a-killed-host-it-never`). A fix of the host-liveness check should serve both watchers.

Still open: the largest accepted `timeout` (G4). The wake window after the last arm is that timeout: past it the notice stays queued and shows at the next prompt or tool call, as today. Windows stays `unverified`.

## Risks

- **Cost.** Every wake bills the receiver. Mitigation: opt-in (step 5) and the loop guard (step 7).
- **Loop.** A wakes B, B replies, A wakes. G3 shows the chain is real: each wake ends a turn, `Stop` re-arms, the next notice wakes again. Mitigation: step 7. Open: should a reply to a wake notice carry a marker?
- **Process count.** One idle process per session. Mitigation: the singleton lock and a poll interval of seconds, not milliseconds (value open).
- **Spoofing.** Any session can address any session across profiles today. A wake makes this more visible, not new. The text stays peer data.

## Open questions

- Session endpoint files carry a `messagingSocketPath` field (`tests/endpoints.rs:75`). Nothing in `src/` reads it. If that socket accepts input, it might wake a session with no watcher process. Not investigated.
- The setting name and the default values of step 7.
- Whether `post_notice` can learn that a watcher is live without a race (state file read versus watcher exit).

## Tests required before build

- `watch` exits 2 with the rendered text for one addressed notice, and `take` moves the cursor first (no second wake for the same notice).
- A second `watch` for the same endpoint exits 0 at once.
- `watch` exits 0 when the endpoint's Claude pid is gone (G5).
- A notice for another session id does not wake.
- A notice over the loop guard stays queued and shows through the existing prompt hook.
- A `/clear` between post and wake still delivers (old id).
