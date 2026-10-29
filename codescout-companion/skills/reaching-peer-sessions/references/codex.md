# Codex mechanics for reaching-peer-sessions

Read by heading: `## Enumerate`, `## Identify me`, `## Deliver`. The core rules
live in `SKILL.md`; this file holds only what is specific to Codex.

Codex keeps its threads in a per-home SQLite file, `<CODEX_HOME>/state_5.sqlite`,
table `threads`. A thread is *loaded* when an `app-server` process holds its
rollout file (`rollout-*.jsonl`) open. Two kinds of process were measured running
`app-server` on 2026-10-29: the CLI daemon (`codex app-server --listen unix://`)
and the ChatGPT desktop app (`resources/codex ... app-server`).

## Enumerate

Columns, in order: `HARNESS` (always `codex`), `ACCOUNT` (the basename of that
app-server's `CODEX_HOME`), `PID` (the app-server process that holds the rollout
open), `SID` (`threads.id`), `NAME`, `STATUS` (always `loaded`), `LAUNCH-CWD`, as
data rows on stdout with no header and no summary. This block never marks a row
`<-- you`; see Identify me.

```bash
proc=${CS_PEERS_PROC:-/proc}
# `proc` defaults to the real /proc; a test points it at a fixture tree. `$HOME` is the
# fallback for an app-server whose environ has no CODEX_HOME. The database is opened
# read-only (mode=ro) and is never written. A lock is waited on for half a second, and
# a home that errors once is not asked again: its remaining rows print NAME ?.
python3 - "$proc" "$HOME" <<'PY'
import os, re, sqlite3, sys, urllib.parse
proc, home = sys.argv[1], sys.argv[2]
UUID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]jsonl$")
def clean(s):
    return " ".join(str(s).split())[:80] or "?"
def one_line(s):
    # A path or account is never cut; a tab or newline would split the row, so each
    # becomes a space.
    return re.sub(r"[\t\r\n]", " ", str(s)) or "?"
def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return b""
def lookup(dbs, codex_home, target):
    conn = dbs[codex_home]
    if conn is None:
        return None
    try:
        return conn.execute(
            "select id, title, name, cwd, archived from threads where rollout_path = ?", (target,)).fetchone()
    except sqlite3.Error:
        dbs[codex_home] = None
        return None
rows = []
dbs = {}
for pid in sorted((p for p in os.listdir(proc) if p.isdigit()), key=int):
    argv = read(os.path.join(proc, pid, "cmdline")).decode("utf-8", "replace").split("\0")
    if "app-server" not in argv:
        continue
    env = [e for e in read(os.path.join(proc, pid, "environ")).decode("utf-8", "replace").split("\0") if e.startswith("CODEX_HOME=")]
    codex_home = env[0][len("CODEX_HOME="):] if env and env[0][len("CODEX_HOME="):] else os.path.join(home, ".codex")
    account = one_line(os.path.basename(codex_home.rstrip("/")))
    if codex_home not in dbs:
        try:
            dbs[codex_home] = sqlite3.connect("file:" + urllib.parse.quote(os.path.join(codex_home, "state_5.sqlite")) + "?mode=ro", uri=True, timeout=0.5)
        except sqlite3.Error:
            dbs[codex_home] = None
    fddir = os.path.join(proc, pid, "fd")
    try:
        fds = os.listdir(fddir)
    except OSError:
        continue
    seen = set()
    for fd in fds:
        try:
            target = os.readlink(os.path.join(fddir, fd))
        except OSError:
            continue
        base = os.path.basename(target)
        if not (base.startswith("rollout-") and base.endswith(".jsonl")) or target in seen:
            continue
        seen.add(target)
        found = lookup(dbs, codex_home, target)
        if found:
            if found[4] == 1:
                continue
            rows.append(("codex", account, pid, clean(found[0]), clean(found[2] or found[1] or ""), "loaded", one_line(found[3] or "")))
        else:
            m = UUID.search(base)
            rows.append(("codex", account, pid, m.group(1) if m else "?", "?", "loaded", "?"))
for r in rows:
    print("\t".join(r))
PY
```

The block prints rows only. The core's merge block sorts them and prints the header
and the summary; pipe the output there, in one shell call.

Measured against the live schema on 2026-10-29: `threads` has both `title` and
`name`. `name` is a short label (at most 54 characters), set on a minority of
threads; `title` is set on more of them and is often the first user message,
long and multi-line. So `NAME` is `name` when non-empty, else `title`, collapsed
to one line and cut at 80 characters so it cannot split a row. `LAUNCH-CWD` and
`ACCOUNT` are never cut (a thread cwd over 80 characters was measured); a tab or
newline in either becomes a space.

Rows and their edge cases:

- An archived thread (`archived` = 1) gives no row.
- An open rollout with no `threads` row gives `NAME` `?`, `LAUNCH-CWD` `?`, and a
  `SID` taken from the uuid in the rollout file name, else `?`.
- A home whose `state_5.sqlite` is missing or unreadable gives its rows the same way
  (`NAME` `?`), never a crash, and the file is not created.
- A locked database is waited on for half a second, then not asked again: the rest
  of that home's rows get `NAME` `?`, so one lock does not stall the whole run.
- Two homes with the same title give two rows, told apart by `ACCOUNT` and `SID`.
- A process counts only when `app-server` is one of its command-line arguments, so
  a path that merely contains `app-server` (a release directory) does not. Only an
  app-server's open rollouts give rows.

`STATUS` is `loaded` for every row. A thread's busy or idle state is not measured
here, so none is claimed. `LAUNCH-CWD` is `threads.cwd`, the thread's working
directory, not a process cwd; the core's Step 4 warning about the column still
applies, with the difference that this value is the thread's own.

## Identify me

The caller's own row is **not identified** on Codex yet, and this file does not
pretend otherwise: the Enumerate block marks nothing, and the core's merge block
then prints its loud warning and drops the peer figure. That is the designed
behaviour until a rule is measured.

Candidates, all unverified and to be measured before any is used as a marker:

- a `resume <uuid>` argument in the TUI's command line (seen on one live TUI; a
  thread started fresh has no such argument);
- the newest rollout whose thread `cwd` matches the caller's working directory
  (adjacency, which the core forbids as evidence of identity, so it needs a check
  that excludes a neighbour before it can be trusted);
- an environment variable naming the thread (measured absent).

Do not add a `<-- you` marking by hand.

## Deliver

Send to a Codex thread with the target row's own home:

    CODEX_HOME=<that row's home> codex queue --thread <SID> --message "<label and text>"

The label format and the rule that a Codex row is addressed by `SID` are in the core.
The guards specific to Codex:

1. Send only to a row Enumerate listed as `loaded`.
2. One send per target per request, and no retry on silence.
3. After the send, check the size of the thread's rollout file once, after a
   bounded wait, and tell the operator one line: the target, the time, and whether
   the file grew.
4. Set `CODEX_HOME` to the home the row was found in, never your own by default.

`codex queue` has three measured outcomes, and only one is a message reaching
someone who is watching.

- The thread is **attached** to a TUI: a turn starts there.
- The thread is **loaded with nobody attached**: a turn runs unwatched. One
  measured case used about 17,700 tokens.
- The thread is **not loaded**: the command exits 0 and prints `Queued`, nothing
  runs, and the message waits in `queue_1.sqlite`.

Guard 1 excludes only the third outcome. A `loaded` row can be the first outcome or
the second, and Enumerate cannot tell them apart. A send to a `loaded` row may start
an unwatched, costly turn, and the operator has accepted that cost.

An exit code of 0 does not say a thread read the message, which is why the
rollout-size check exists.
