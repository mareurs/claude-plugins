---
name: migrating-trackers
description: Use when a flat tracker file (docs/trackers/<name>.md with many records) should become a lifecycle collection with one file per entry, or when the user asks to migrate, split or convert a tracker, or when codescout trackers inventory, apply or check comes up.
---

# Migrating trackers

`codescout trackers inventory | apply | check` moves one flat tracker into a lifecycle collection. The commands do the move. This skill does the judgment around them: which tracker is next, whether it may move at all, the mapping draft, the one screen the user approves, the reading of the JSON, and the commit.

Record text never passes through you. You do not write an entry file, retype a record or paste a record body into a mapping. Folders with no `PREFIX-N` records (`frictions/`, `effort-steering/`, `bistriceanu/`, `mechanisms/`) go by the move-out outcomes in Step 0 and the user's word, and still run `check` for its structural items.

One tracker per run of the loop.

## Step 0 - Preconditions (before any other command)

1. **Binary.** Use `codescout` on `PATH`, else the MCP-configured command, else `~/.cargo/bin/codescout`. Run `<bin> trackers --help`, `<bin> trackers apply --help` and `<bin> trackers check --help` (the top-level help text can be stale). A non-zero exit or empty output from any: stop and say "this codescout needs codescout `experiments` at `6ebe4091b` or later (no tracker migration)". Use the same binary for every call below.
2. **Writer list.** Refuse the tracker, before `inventory`, when an installed skill or hook still writes it by path. Name the writer in the refusal and stop:

   | Tracker | Writer |
   |---|---|
   | every `*-session-log` (for example `foo-session-log.md`) | the `reconnaissance` skill copies its template to `docs/trackers/<topic>-session-log.md` and appends to it |
   | `reconnaissance-patterns` | the `reconnaissance` skill appends to it |
   | `tracker-hygiene-log` | the `tracker-hygiene` skill and the session-start banner |

   Reading the record text and finding it looks like a plain log is not a reason to proceed. The writer is the reason. They wait for the reconnaissance and hygiene skills to change.
3. **Catalog facts.** `apply` can refuse because the identity cutover has not moved the sources' catalog-only facts into files. When the refusal names the cutover: run `codescout cutover plan`, show it, and on the user's word run `cutover export` and commit that export by its own exact names before this tracker. When the refusal says there is no old catalog: ask the user whether this repository ever had one. Only on a "no", re-run the same command with `--no-old-catalog` added: `codescout trackers apply <mapping> --project <repo> --no-old-catalog --json`. A `-wal` or `-shm` message about the old catalog is not this refusal. It is exit 2 with `{"ran": false, "reason": ...}`, and the flag does not bypass it. Show the reason and stop for the user: the catalog needs every codescout process stopped and a `PRAGMA wal_checkpoint(TRUNCATE)`. Do not ask the old-catalog question for it.
4. **Move-out outcomes** for a tracker that is not a ledger of records: a snapshot becomes a report, a policy becomes conventions, by `doc(move)`, on the user's word. A repo with no `PREFIX-N` ledgers uses the `sections` and `whole` kinds in the mapping (see [references/mapping.md](references/mapping.md)).

## The loop

Each step names its command and its stop point. Use `--json` on every command and read it through `jq` on the `@cmd_*` buffer, not whole. `bug-fix-session-log` has 399 records and overflows the output.

1. **Pick.** List the flat trackers with record counts and what reads or writes them. Propose an order: trackers that no code reads and no skill writes, smallest first. Stop: the user may reorder.
2. **Inventory.** `codescout trackers inventory <source> --json --project <repo>` (add `--kind` for a non-record tracker). Run it once, then query the buffer with `jq`; the queries are in [references/mapping.md](references/mapping.md). Writes nothing. This step runs even when the user supplies a mapping: compare it with the inventory. A section whose text matters goes `to = "readme"`; text is never retyped into `readme_body`. A supplied mapping that does otherwise: show the change as a proposal and stop for the user. Do not edit an approved mapping silently.
3. **Propose.** Draft the mapping yourself and show the one proposal screen of [references/mapping.md](references/mapping.md). The draft goes to `$(git rev-parse --absolute-git-dir)/tracker-migration/<key>.toml`, inside the git directory, so no staging command can pick it up. Never write it under the project tree. Stop: nothing is written to the project before the user approves.
4. **Approve.** The user approves or edits the screen. Only the user's reply moves you on. "Go on", "looks fine" and silence on a part you did not show are not approval of that part.
5. **Apply.** First save `git status --porcelain`; recovery needs it. Then `codescout trackers apply <mapping> --project <repo> --json`. Read the exit code, then the JSON. On exit 1 show each reason in `{"refused": [...]}`, propose the mapping fix, stop. On exit 2 go to [references/recovery.md](references/recovery.md).
6. **Check.** `codescout trackers check <mapping> --project <repo> --json`, before any commit. Parse by shape. `{clean: true, ...}` (exit 0): go on. `{clean: false, blocking: [...]}` (exit 1): show `blocking`. `{"refused": [...]}` (exit 1): show each reason; it is "not clean", not a crash. `{"ran": false, "reason": ...}` (exit 2): show the reason and go to [references/recovery.md](references/recovery.md). Every case except clean: stop, and the user decides between a mapping fix and re-apply, or a restore by exact names.
7. **Review.** Show: the check report with every `review` item (also `apply`'s `review`; read the `dropped` list when the binary reports one), `git diff --stat` beside `git status --porcelain` (the stat omits untracked files; new entry files are untracked until staged), the readme, and two sample entries. Say that most old open records are stale on day one: that is honest, and a `doc` status update re-confirms a record. Stop: the user approves the result. Assume nothing.
8. **Commit.** Only on the user's word, by exact names. The names are the union of `written`, `deleted` and `already_applied` from the last `apply --json` that exited 0.
   1. `git add -- <name> <name> ...`
   2. `git diff --cached --name-only` as a separate call. It must equal that union. A path that is not in it: unstage it.
   3. `git commit -m "<message>" -- <the same names>` as a separate call. The message carries one line that summarises the overrides and drops.
   `check` never runs after this commit: the sources are gone from `HEAD`, so it exits 2.

## Quick reference

| Command | Exit 0 | Exit 1 | Exit 2 |
|---|---|---|---|
| `inventory` | `{sources, mentions, sidecar}` | not used | `{"ran": false, "reason": "..."}` |
| `apply` | `{written, deleted, already_applied, review}` | `{"refused": [...]}` | `{"ran": false, "reason": "..."}` |
| `check` | `{clean: true, blocking, shortened, review}` | `{clean: false, blocking, ...}`, or `{"refused": [...]}` | `{"ran": false, "reason": "..."}`, also after the commit |

`check` prints `{"refused": [...]}` in three cases: the mapping file does not parse; a source path is not a normalised repository path; `target.existing` is `true` and no collection loads at the target folder.

A second `apply` with the same mapping writes nothing and reports the files as `already_applied`.

## Environment facts

- `apply` leaves an untracked `.codescout/` in the project (the write lock). Leave it. Never stage it, never delete it for the user.
- Mapping file: top-level keys come before any `[table]`; `[[sections]]` needs `source`. A date in `overrides` is a quoted `YYYY-MM-DD`.
- The mapping path is inside the git directory. The commit names never include it.
- The skill never pushes.

## Rules, and the excuses that break them

Never migrate a tracker on the writer list. Never stage by directory or with a blanket flag. Never commit without a pathspec. Never commit without the user's word on the reviewed result. Never run `check` after the commit.

| Excuse | Answer |
|---|---|
| "It reads like a plain log, so the writer rule does not apply." | The writer is a skill or hook, not the content. Refuse and name it. |
| "The user said go on, so approval is given." | Approval covers what you showed. Show the review material (Step 7), then wait. |
| "Staging the folder is shorter." | The commit guard refuses it, and it can sweep in another session's work. Exact names. |
| "I will ask the user six questions first." | Draft the mapping and show one screen. Mark what you are unsure about on it. |
| "The commit already happened, so check now." | It exits 2. Check comes first. |

Red flags, stop and restart the step: a command run on a tracker you did not look up in the writer list; a staging command with a directory in it; `git commit` with no `--`; the words "I assumed" about an approval.
