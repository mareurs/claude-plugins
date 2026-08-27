---
id: 4990ecde42781343
kind: bug
status: fixed
title: codescout-companion keeps hard-blocking Bash after the MCP server disconnects, redirecting to tools that no longer exist — the session loses every shell capability at once
tags:
- codescout-companion
- hooks
- availability
- fail-open
closed: 2026-08-26
---

## Symptom

When the codescout MCP server disconnects mid-session, `codescout-companion`'s
PreToolUse guard keeps denying native `Bash` (and `Read`/`Grep`/`Glob`/`Edit` on
source files) and redirects the caller to `run_command` / `symbols` / `read_file`
— **tools that are no longer in the tool list.** Every route to a shell is closed
in the same instant, including the ones needed to diagnose the disconnect.

The session cannot recover on its own. It took a human running `/mcp` to restore
it. **Observed twice in one session** (`f6ae2d77-3ee3-46f9-ab0d-270afd61c592`,
2026-08-26).

## Root cause — verified, not inferred

`detect()` establishes `HAS_CODESCOUT` from **configuration files only**:

- `hooks/detect.mjs:81-128` — checks `.claude/codescout-companion.json`
  (`server_name` override), then `.mcp.json`, then
  `<config-dir>/.claude.json` and `settings.json`.
- There is **no liveness probe anywhere in the detection path.** Nothing reads
  whether the server actually connected, or is still connected, this session.

`hooks/pre-tool-guard.mjs:25-26` gates on exactly that value:

```js
const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);
if (d.BLOCK_READS === 'false') process.exit(0);
```

A disconnect changes no file on disk. So `HAS_CODESCOUT` stays `true`, the guard
stays armed, and it enforces a redirect to a tool surface that has vanished.

**The plugin already holds the principle this case violates.** `hooks/lib.mjs:56-61`
fails open on a *detection crash*, with the comment:

> *Fail-open: any detection error → behave as if codescout is absent so the hook
> exits 0 without denying. A crash must never block the user's tool.*

The rule is right and already written down. It simply does not cover the case where
detection succeeds and the **server** is the thing that is gone. This is a gap in
the coverage of an existing invariant, not a missing invariant.

## Why it is worse than an ordinary block

A normal deny leaves an alternative open — that is the whole design. This one
removes the native tools **and** the replacements simultaneously, so the
guidance in the deny reason is not merely unhelpful, it is **counterfactual**:
it names the exact tools that cannot be called. An agent following the hook's
instruction loops.

## The escape hatch exists but is unreachable and unnamed

`{"block_reads": false}` in `.claude/codescout-companion.json` disables all
blocking (`detect.mjs:156`, `pre-tool-guard.mjs:26`; documented in
`codescout-companion/README.md:161`). **Measured 2026-08-26 — it is unreachable
from inside the session that needs it.** Driving the hook black-box, the way its
own test suite does:

```
Write .claude/codescout-companion.json  -> deny
Edit  .claude/codescout-companion.json  -> deny
Bash  git status                        -> deny
```

The project-level `.claude/` is not covered by `isConfigDir`
(`pre-tool-guard.mjs:39-45`, which matches `$HOME/.claude*` and `CLAUDE_CONFIG_DIR`
only), so the guard governs the very file that would disarm it.

So the failure is closed on both sides:

1. **The deny reason never names the escape.** It lists only codescout tools —
   the ones that are gone. Nothing a blocked caller reads points at the way out.
2. **The agent cannot take the escape even if it knew of it.** Writing the config
   is denied by the same guard, and so is every shell that could write it another
   way.

**The only in-session remedies are human-side**: `/mcp` to reconnect, or typing
`! <command>` at the prompt, or editing the config outside Claude Code. An agent
alone cannot recover, which is exactly what was observed twice.

This also means fix **(a)** below is necessary but *not sufficient* on its own:
telling the caller about a file it is forbidden to write only converts a silent
deadlock into a documented one. (a) should name the *human* action (`/mcp`, `!`),
not the config file.
## Candidate fixes — not yet chosen

**Chosen: (a) + (c), landed together.** (b) was rejected — a marker with a
freshness window reintroduces exactly the config-shaped staleness one layer down
(`R-89`), and it cannot distinguish "codescout is gone" from "nobody happened to
call codescout for a while", which at session start is every session.

(c) was filed as *"needs a PostToolUse path that sees MCP transport errors — not
confirmed to exist."* That framing was the thing blocking it, and it was wrong.
Transport errors are not observable, but they are also not needed: what the guard
has to know is whether the redirect **target is reachable**, and any codescout
tool answering proves that. An error payload proves it just as well as a success.
Silence is the only negative signal, and consecutive unanswered denies are how it
is read.
## Not yet done

Superseded — see *Fix* below. A regression test now exists; the design note that
it "cannot be written until a fix picks the liveness signal" was wrong, and wrong
in an informative way: it assumed the signal had to be a *transport error*, which
indeed is not observable. Proof-of-life is observable, and it was already in the
file — `hooks.json` has carried PostToolUse matchers on MCP tools
(`mcp__.*__workspace`) since before this bug was filed.

The deferral rationale inflated the cost of the work, in the direction the
reconnaissance skill predicts a deferral rationale always inflates it.


## Fix

Landed `b0db2d1` on `main`, 2026-08-26 — *fix(companion): stand the tool guard down
when codescout stops answering*.
patch-id `97c1a4369e23add25e3d724e4d4c1799831a95ed` (rebase-survivable anchor; the
SHA above is on `main` and this repo has no `experiments` branch).

Six files: `cs-liveness.mjs` (new), `hooks.json`, `lib.mjs`, `pre-tool-guard.mjs`,
`pre-tool-guard.test.sh`, and this file.

**Shape of the fix — (a) + (c) together**, as § *Candidate fixes* records. The guard
reads **proof-of-life**, not transport errors: any codescout tool that answers —
success *or* error payload — refreshes liveness via the PostToolUse `mcp__.*__workspace`
matchers that `hooks.json` already carried. Silence is the only negative signal, and
consecutive unanswered denies are how it is read; past that threshold the guard stands
down and native `Bash`/`Read`/`Grep`/`Glob`/`Edit` pass through rather than being
redirected at tools that no longer exist.

Regression test in `pre-tool-guard.test.sh` (+94 lines).

*(This section was missing until 2026-08-27. Two sections above it pointed at "see
*Fix* below" and there was no such section — the fix had landed, but the file never
recorded it. The stale headings § *Candidate fixes — not yet chosen* and § *Not yet
done* are left as written; each self-corrects in its own first line.)*
