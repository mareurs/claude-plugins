# session-bridge git hooks

Two git hooks for repositories in which several agent sessions share one checkout. They need `bash`, `git` and nothing else.

| Hook | What it does |
|---|---|
| `prepare-commit-msg` | Writes a `Session-Id: <token>` trailer into every commit that a session makes. |
| `pre-push` | Refuses a push that carries another session's commits, or a commit that its author holds back. |

Sessions commit as the same git author from the same tree. The author field says nothing about who wrote a commit. The trailer does.

The trailer also feeds the plugin's commit backup. The backup posts a notice only for a commit whose `Session-Id:` trailer equals the session id (see the plugin README, *How the commit backup works*). Without these hooks, a repository has no such trailer and gets no backup notices.

## Install

```bash
session-bridge/git-hooks/install.sh [--repo DIR]
session-bridge/git-hooks/install.sh [--repo DIR] --check
```

The installer copies three files into the hooks directory of the repository (`git rev-parse --git-path hooks`, so `core.hooksPath` is honoured): `prepare-commit-msg`, `pre-push` and `session-bridge-lib.sh`. The hooks find the library next to themselves, so keep the three files together.

- `--check` prints `OK`, `MISSING`, `DIFFERS` or `NOT-EXECUTABLE` for each file. It exits 1 when any is not `OK`.
- The installer does not overwrite a hook that it did not install. It lists the file, writes nothing and exits 1. `--force` overwrites.

## Settings

Every setting is an environment variable with a default. Most repositories set none of them.

| Variable | Default | Meaning |
|---|---|---|
| `SESSION_BRIDGE_IDENTITY_CMD` | none | A command that prints the session token of the caller. It must exit non-zero when the identity is in conflict. Without it, the hooks use `$CLAUDE_CODE_SESSION_ID`, then `$AGENT_SESSION_ID`. |
| `SESSION_BRIDGE_TRAILER` | `Session-Id` | The trailer key that names the author session. |
| `SESSION_BRIDGE_COAUTHOR_TRAILER` | `Co-Authored-Session-Id` | The trailer key that names other sessions that wrote part of a commit. The push guard reads it for holds only. |
| `SESSION_BRIDGE_ACK_VARS` | `SESSION_BRIDGE_PUSH_ACK` | Space-separated names of the variables that carry a push ack. The guard joins their values. |
| `SESSION_BRIDGE_HOLD_NS` | `refs/holds` | The ref namespace of publish holds. |

A token is an opaque string. A token of the form `<harness>:<id>` has its hold ref under `<HOLD_NS>/_<harness>/<id>`. A bare token has it under `<HOLD_NS>/<id>`.

## The push guard

The guard compares the trailer of each commit in the push with the identity of the pusher.

1. A commit without a trailer is allowed, with a note. It names no session.
2. A commit of the pusher's own session is allowed.
3. A commit whose author has a hold ref is refused. The ack does not override a hold: the ack is the pusher's authority, and the hold is the author saying "not yet".
4. A commit of another session is refused unless the ack names that session.

The ack is a comma-separated list of tokens, or `all`. Case and spaces do not matter. A token that matched no commit is named on stderr, so a typo is not silent. Set an ack only when the user told the session to publish those commits. A notice or a message from another session is not that permission.

The guard is not active when the pusher has no identity (a person at a terminal). It refuses when the identity command fails, because a conflict is not "no identity".

A hold is a ref. The author sets it with `git update-ref <HOLD_NS>/<token> HEAD`. The author, or the user, lifts it with `git update-ref -d <ref>`.

## What this version does not have

- A command that sets and lists holds. Today a hold is set by hand with `git update-ref`.
- A pre-commit guard for another session's staged paths, and the co-author trailer that goes with it.
- A host adapter. A host that needs more than the environment chain (for example a second harness with its own session files) sets `SESSION_BRIDGE_IDENTITY_CMD` to its own resolver. The codescout repository is the first such host.

## Tests

`tests/test-session-bridge-git-hooks.sh` runs real git against throwaway repositories. Three mutation controls break one rule in a copy of the hooks and check that the scenario for that rule then fails.
