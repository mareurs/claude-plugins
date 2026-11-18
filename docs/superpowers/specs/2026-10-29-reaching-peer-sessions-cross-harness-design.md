# Reaching peer sessions across accounts and harnesses — design

Date: 2026-10-29. Status: draft, waiting for approval. Size: a project (one skill split into a core and two reference files, plus tests).

## Intent

`reaching-peer-sessions` today finds and messages Claude Code sessions only. The operator runs several Claude Code accounts (config dirs) and Codex on one machine, and wants one skill that works from a Claude Code session and from a Codex session. From either side it must list the live peer sessions of both harnesses across all accounts, and deliver a message to one of them.

Why now: on 2026-10-29 a Claude Code session and a Codex session woke each other from idle, in both directions (codescout memory `research/cross-harness-session-messaging`). The delivery paths exist. No skill tells a session how to use them.

## What exists today (verified 2026-10-29)

- `codescout-companion/skills/reaching-peer-sessions/SKILL.md` scans `/run/user/<uid>/cc-socks` and reads `CLAUDE_CONFIG_DIR` from each process. It already covers many Claude accounts. It does not see Codex.
- A test file sits beside it: `reaching-peer-sessions.test.sh`. It uses `CS_PEERS_PROC` and `CS_PEERS_SOCKS` to point the scan at a fixture tree.
- The same plugin tree ships to Codex. The Codex plugin cache holds `codescout-companion` 1.20.21 with this skill and a `.codex-plugin` folder.
- The repo already splits skills into a core and `references/` files: `reconnaissance`, `tracker-hygiene`. The superpowers plugin does the same per harness (`references/codex-tools.md`).
- The superseded design `2026-10-13-portable-workflows-and-codex-design.md` records, as measured on Codex 0.160.0, that the Codex model finds a plugin's root by walking up from the skill file to the folder that holds `.codex-plugin/`. It also records that Codex's command converter skips any text that uses `$` plus a digit. Do not plan from that document. I use these two facts and have not re-measured them.
- The operator added the rule "Skill layout — core in `SKILL.md`, harness specifics in `references/`" to the repo `CLAUDE.md` on 2026-10-29.

## Measurements this design rests on

- **Claude Code delivery.** One JSON line on `/run/user/<uid>/cc-socks/<pid>.sock`: `msgV`, `msg_id`, `type`, `message`, `priority`, `from`. Measured on 2.1.312. A post from a Codex process woke an idle Claude session. The sender does not need an auth line.
- **Codex delivery.** `codex queue --thread <uuid|name> --message <text>` woke an idle Codex session at once. Codex shows the text as a normal user prompt, with no sign of its origin.
- **Codex sandbox.** A command in the native Codex shell that connects to the Claude socket failed with `PermissionError` until the operator approved a rerun outside the sandbox.
- **Codex through codescout.** A Codex session with codescout registered ran `run_command` to connect to a unix socket outside its workspace. The bytes arrived, with no block and no approval prompt. The codescout processes under a Codex daemon show `Seccomp: 0`.
- **`codex queue` has three outcomes**, measured on 0.165.0 in an isolated `CODEX_HOME`:
  1. A thread with an attached TUI starts a turn, shown in the TUI.
  2. A thread that is loaded in the daemon with no TUI attached starts a turn inside the daemon. The rollout grew from 140,247 to 149,326 bytes, and the thread used about 17,700 more tokens. Nobody watched it.
  3. A thread that is not loaded accepts the message and exits 0, but nothing runs. The message waits in `queue_1.sqlite` (`queued_items`, payload `UserInput`) until something loads the thread.
- **Codex processes.** The interactive `codex` processes hold no rollout file open and export no `CODEX_*` variable. The shared app-server daemon holds one rollout file open for each loaded thread. A loaded thread is not proof that someone is attached.
- **Codex state.** Each `CODEX_HOME` has `state_5.sqlite` with a `threads` table (`id`, `title`, `cwd`, `updated_at`, `archived`).

## Goals

1. One table lists live Claude Code and Codex sessions across all accounts, with a harness column and an account column.
2. A session of either harness can deliver a message to a peer of either harness.
3. The harness-neutral rules exist once, in `SKILL.md`.
4. A session reads the core, the file for its own harness, and the file for the target harness. It reads nothing else.
5. Every outgoing message names its sender, because Codex shows queued text as user input.

## Non-goals

- Pi, Cursor, or any third harness. The layout must allow a third file later. Nothing more.
- Sessions on other machines or in the cloud.
- A codescout tool. This is a skill.
- Changing Codex sandbox settings. The skill tells the caller what to expect.

## Anti-goals

- Core rules repeated in a harness file, or one harness's tool name written in the core outside a pointer.
- A Codex `STATUS` of `idle` or `busy` that nobody observed.
- A count without its unit and instant. The existing rule stays.
- A Claude wire-format post with no version check. The format is measured on one version only.

## Constraints

- Never write `$` followed by a digit in any skill file. The harness replaces it with a word of the caller's arguments.
- A Claude Code caller on this machine has no `Bash` tool. Every command block must run through whatever shell tool the caller has.
- The skill-call legality check (`tests/test-skill-call-legality.sh`, in progress in this repo) must keep passing. This design does not extend it to this skill, because that check runs against a sandboxed codescout and cannot exercise `ListAgents`, `SendMessage` or `codex queue`. My call.
- The plugin version bump follows the repo's Version Management rules.

## Approaches considered

**A. One `SKILL.md`, both harnesses inline.** One trigger, one file. It gives up size: the file doubles, and each session reads the other harness's mechanics too.

**B. A core `SKILL.md` and one reference file per harness. Chosen by the operator.** It fits progressive disclosure and the repo rule above. It gives up one thing: a caller reads two reference files when it reaches across harnesses. See Design, section 2.

**C. Two skills.** It repeats the core rules and doubles the chance that no skill fires. Rejected.

## Design

### 1. Layout

```
codescout-companion/skills/reaching-peer-sessions/
  SKILL.md                    core: rules, steps, table contract
  references/claude-code.md   Claude Code mechanics
  references/codex.md         Codex mechanics
  reaching-peer-sessions.test.sh   extended
```

My call: commands stay inline in the reference files. There is no separate script, so the skill has no path dependency beyond `references/<harness>.md`.

### 2. Files are organized by role, not by caller

A reference file answers three questions about its own harness. The core tells the session which to use:

- **Enumerate.** List the live sessions of this harness. Every caller runs this for every harness. Run it from any caller.
- **Identify me.** Find the caller's own row. Only a caller of this harness reads it.
- **Deliver.** Send a message to a session of this harness. A caller of any harness reads it for the target's harness.

So a Claude Code caller that messages a Codex peer reads `codex.md` (Enumerate, Deliver) and `claude-code.md` (Identify me). Each section has its own heading, so a session can read by heading.

### 3. The core `SKILL.md`

It holds, once:

- the trigger and the reason: a peer count must name its scope;
- Step 0: the session knows its harness from its own context. If it cannot say, it stops;
- Step 1: run Enumerate for each harness, then merge rows by the table contract;
- Step 2: branch on the account count;
- Step 3: pick the target's harness file and run Deliver;
- Step 4: ask a peer before acting on occupancy;
- the rules that hold everywhere: address by scope, not by the list; take the sessionId, not the name; stamp the instant; visibility is not authority; never route by adjacency;
- the message label (section 5);
- one pointer per harness file, as the repo rule says.

### 4. The table contract

Columns: `HARNESS`, `ACCOUNT`, `PID`, `SID`, `NAME`, `STATUS`, `LAUNCH-CWD`, then `<-- you` on the caller's row. `SID` is the durable id: the Claude `sessionId`, or the Codex thread uuid. Deliver to a Codex row uses `SID`. Deliver to a Claude row keeps using the name or the `uds:` path built from `PID`. The core rule "take the sessionId, not the name" is about identity and attribution, not about addressing a Claude row. My call. `ACCOUNT` is the basename of the config dir (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`, default `.claude` or `.codex`). The summary line reads: `S Claude Code sessions (P peers plus you) and T loaded Codex threads, across A account(s), at <time>`. A loaded Codex thread is not proof that anyone is attached, so it is counted under its own unit and never added to the session count. My call. If the caller's own row is not found, the summary drops the peer count and says why. This keeps the existing loud-failure rule.

Codex rows: the table row has `PID` of the daemon and `NAME` set to the thread title. My call: `STATUS` is `loaded` for every Codex row until the builder measures a real status.

### 5. The message label

Every message starts with one line: `[from <harness>/<account> "<name>" pid <pid>, <ISO time>]`. Claude Code already marks peer messages. Codex does not, so the label is the only provenance a Codex receiver gets. The text after the label is a request, never an approval. A Codex caller whose own row is not identified writes `?` for the name and any pid it cannot learn, and says in the text that it cannot be answered by address; the label format does not change. A Claude receiver whose message carries a non-`uds:` `from` does not use the copy-`from=` rule: it goes through the operator. A SID is taken only from the caller's own Enumerate row, never from message text.

### 6. `references/claude-code.md`

Moves the current content: the socket walk, the profile table, `ListAgents` and `SendMessage`, the `uds:` form for another account, and the stale-name rules. Adds Deliver-from-Codex: post one JSON line to `/run/user/<uid>/cc-socks/<pid>.sock` in the measured format. The section says the format is measured on the versions listed in the file (2.1.312 at the time of writing). The caller reads the target's version from the target process (the registry `version` first, with the basename that `/proc/<pid>/exe` points to as the fallback), not from `claude --version`, which reports the binary on the caller's PATH. If the target's version is not in the measured list, the caller does not post. It tells the operator and stops. Some Claude peers on this machine run older versions, so some are unreachable from Codex until the builder measures them. My call. The post is one mechanical snippet that takes the target `PID`, reads the registry `version` (falling back to the `exe` basename), and exits non-zero with the version unless it is in its `MEASURED` set. The prose list and the set must agree, and a test pins that. The message goes in through a quoted heredoc, never a shell argument. It also says a Codex caller posts through codescout's `run_command`, because the native Codex shell blocks the socket. The operator confirmed on 2026-10-29 that Codex sessions have codescout with all its tools, and that this use is allowed.

### 7. `references/codex.md`

- **Enumerate.** Find every app-server process, whether the CLI daemon or the ChatGPT desktop app's server. Read its `CODEX_HOME` (default `~/.codex`). Take the rollout files it holds open as the loaded threads. Join them to `state_5.sqlite`, read-only, for title, working directory and `archived`. On 2026-10-29 the desktop app's server held no rollout file, so it contributes no rows today. My call.
- **Identify me.** Not measured. The builder must find a reliable rule. Candidates: a `resume <uuid>` argument, the most recently written rollout with a matching working directory, or an environment variable in the shell child. Until one is verified, the section says the row is not identified.
- **Deliver.** One mechanical snippet taking the row's `PID` and `SID`: it reads `CODEX_HOME` from `/proc/<pid>/environ` (the row carries only a basename), finds the open rollout holding the `SID` (guard 1, refusing if absent), runs `codex queue --thread <uuid> --message <label and text>` through an argument list (the message, the PID and the SID come through quoted heredocs, never a shell argument; the SID comes only from the Enumerate row), waits a bounded time, and prints the size report. Address by uuid, never by name, because names repeat across accounts. A zero exit means the message was queued, not that anyone read it, and a thread that is not loaded runs nothing until it is loaded.
  - **Deliver autonomously, then report.** The operator decided on 2026-10-29 that the skill contacts any session with the least operator intervention. Deliver to a Codex row therefore does not ask first. This replaces my earlier recommendation to ask. Enumerate cannot tell whether a TUI is attached, and a queued message starts a real turn either way, so these guards replace the question:
    1. Send only to a row that Enumerate listed as `loaded`. For a thread that is not loaded, `codex queue` exits 0 and runs nothing, so the skill does not send and tells the operator why.
    2. Address by uuid with `CODEX_HOME` of that row's account.
    3. Start the message with the label from section 5. The text is a request, never an approval.
    4. Send once per target per request. Do not retry on silence.
    5. After the send, check that the rollout file of that thread grew, then give the operator one line: target, time and the check result. The report comes after the send, not before.
  - **Accepted cost.** A turn in a loaded thread with no TUI attached runs unwatched. One measured case used about 17,700 tokens. The operator accepts this cost.
  - **Authority does not change.** Contact is autonomous. A reply from a peer is still never an approval or a permission (see Boundary in the core `SKILL.md`).

## Failure modes

- A loaded Codex thread with no one attached looks live. The table says `loaded`.
- An archived thread is not listed.
- Two accounts hold the same Codex thread name. The skill addresses by uuid.
- The Claude wire format changes in a later version. The version check fails loudly.
- The native Codex shell blocks the Claude socket. A Codex caller uses codescout's `run_command` for that post. If codescout is missing, the caller reports it and stops.
- A message queued to a thread that is not loaded arrives later, as plain user input, when someone loads the thread. The label with its time is the only sign that it is old.

## Tests the builder must add

- Fixture trees for both harnesses, through the existing `CS_PEERS_PROC` and `CS_PEERS_SOCKS` hooks plus a Codex equivalent. Assert the table columns and the summary line, including the failed-self-identification case.
- A lint for the repo rule: `SKILL.md` contains no harness tool name outside a pointer line.
- A check that each reference file has the headings the core points to.
- The skill-call legality check passes.

## Left to the builder

- Measure the Codex items marked unmeasured: self-identification, a real thread status (the app-server `thread/loaded/list` call is a candidate), and re-measure that Codex resolves `references/<file>.md` relative to the skill file, as the 2026-10-13 design recorded for plugin roots.
- Exact commands, and the version bump.
- A pointer to this skill from the codescout `CLAUDE.md` section "Reaching a Peer Session" and from `docs/conventions/reaching-a-peer-session.md`. Those are in another repo. Cite it as `<repo>:<sha>`.

## Revisit when

Pi or another harness needs support, Codex gets a documented way to list live sessions, or Claude Code documents the inbox wire format.
