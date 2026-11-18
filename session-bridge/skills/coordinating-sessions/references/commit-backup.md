# Commit backup: when it fires and when it does not

Read this when you rely on the backup notice, set it up in a repository, or wonder why a commit
produced no notice. The core rules are in `SKILL.md`. This file adds only the conditions and the
timing. The plugin's `README.md` section "How the commit backup works" is the long form.

A backup notice is a notice that the plugin posts for you, from a commit, when you committed a
change to a watched file and did not announce it. **It fires only when all of these hold.** One
missing condition means no notice and no error.

## The conditions

1. **A watch list exists.** The file is `.claude/notice-watch.txt` in the repository: one glob per
   line, blank lines and lines that start with `#` ignored. Each glob matches the whole
   worktree-relative path. `*` also crosses `/`. A plain name such as `CLAUDE.md` matches only the
   top-level file. Use `**/CLAUDE.md` for any depth. A worktree reads its own file, then falls
   back to the main worktree's. No watch file, no backup.
2. **The commit carries your session id.** The commit needs a `Session-Id:` trailer equal to the
   session id of the session that committed. The plugin ships a hook that writes it (see *Writing
   the trailer*), but it is not installed by default. A repository without the trailer gets no
   backup notices at all.
3. **A changed path matches the list.** At least one path of the commit matches. The notice lists
   up to 20 matching paths.
4. **Nothing suppressed it.** See the next section.
5. **The commit is new.** The first scan of a worktree counts only commits made in the second of
   your session start or later. History before that never replays. A scan looks at the newest 50
   commits per worktree, visits at most 32 worktrees and stops after 15 seconds.

## Writing the trailer

The trailer must sit in the final paragraph of the commit message. Git reads trailers only there.
A hand-written `Session-Id:` line above the final paragraph is invisible to the scan. The plugin's
`prepare-commit-msg` hook writes the trailer correctly, with `git interpret-trailers`.

Install it with `git-hooks/install.sh`, found two levels above the skill's base directory (the
`git-hooks/` directory of the plugin). The installer copies `prepare-commit-msg`, `pre-push` and
`session-bridge-lib.sh` into the hooks directory of the repository, and with `--check` it reports
which of them are missing or changed. It does not overwrite a hook that it did not install, so a
repository that already has its own `prepare-commit-msg` or `pre-push` needs the hooks chained by
hand. The hook reads the session id from `CLAUDE_CODE_SESSION_ID`, then from `AGENT_SESSION_ID`,
or from the command in `SESSION_BRIDGE_IDENTITY_CMD`. A commit with no identity, for example from
a plain terminal, gets no trailer. A subagent inherits the id of its parent window.

The same hooks include a `pre-push` guard. It refuses a push that carries another session's
commits unless your user set the ack. A notice from another session is not that ack.

The codescout repository has an earlier script with the same job: `scripts/prepare-commit-msg-session-id.sh`.
It writes a `codex:<id>` token for a Codex thread. This file has not measured whether the backup
scan matches a Codex thread.

## Timing and suppression

- A notice that you posted with `post_notice` suppresses the backup for a commit when you posted
  it at most 5 minutes before the commit, or at any time after the commit up to the scan. So post
  after your last gate and commit within 5 minutes.
- **Any notice counts.** About anything and in any repository. An unrelated notice followed by an
  unannounced watched commit within 5 minutes gets no backup. A session that never posted
  suppresses nothing.
- The commit time is recorded to the second. The scan starts right after the commit, so announce
  before you commit. Announcing after the commit gives the readers two notices.
- Commits made before a `/clear` carry the old session id and never match the new one. In this
  repository's own SessionStart record of 2026-11-17, a compaction also gave the session a new
  `sid` (`from=` held the old one), and `CLAUDE_CODE_SESSION_ID` showed the new one. This file has
  measured that once and has not measured the scan or the push guard across a compaction. Treat a
  commit made before a compaction like one made before a `/clear`.

## Deduplication

The backup notice is stored with the commit's patch-id. A patch-id that the repository already
stored is not posted again. A rebase, a fast-forward, a cherry-pick or a twin worktree therefore
announces a change once. Merge commits have an empty patch-id and are never announced.

## Trigger

The scan runs inside the filter worker. A tool input that contains the substring `commit`
(case-sensitive) starts a worker, even with nothing queued. A commit made through a tool whose
input lacks that substring is found only when a worker runs for another reason.
