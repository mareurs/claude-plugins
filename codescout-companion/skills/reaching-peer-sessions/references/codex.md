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
# `proc` defaults to the real /proc; a test points it at a fixture tree. The caller's
# `$HOME` is used only for an app-server whose environ has neither CODEX_HOME nor HOME. The database is opened
# read-only (mode=ro) and is never written. A lock is waited on for half a second, and
# a home that errors once is not asked again: its remaining rows print NAME ?.
python3 - "$proc" "$HOME" <<'PY'
import os, re, sqlite3, sys, urllib.parse
proc, home = sys.argv[1], sys.argv[2]
UUID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]jsonl$")
def clean(s, empty="?"):
    return " ".join(str(s).split())[:80] or empty
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
    vals = dict(e.split("=", 1) for e in read(os.path.join(proc, pid, "environ")).decode("utf-8", "replace").split("\0") if "=" in e)
    if vals.get("CODEX_HOME"):
        codex_home = vals["CODEX_HOME"]
    elif vals.get("HOME"):
        codex_home = os.path.join(vals["HOME"], ".codex")
    else:
        codex_home = os.path.join(home, ".codex")
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
            rows.append(("codex", account, pid, clean(found[0]), clean(found[2] or found[1] or "", "(untitled)"), "loaded", one_line(found[3] or "")))
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
- A thread that has a `threads` row but an empty `title` and an empty or NULL `name`
  gives `NAME` `(untitled)`. `?` never means that: it means the value is unknown (no
  `threads` row, no database, or a lock; the next three items).
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

Send with the snippet below, which takes the target row's `PID` and `SID`. The row
carries only the basename of `CODEX_HOME`, so the snippet reads the full home from
that process. It then finds the open rollout whose file name holds the `SID` (guard 1,
done mechanically: no such rollout means the thread is not loaded here), runs
`codex queue` with the message as one argument of an argument list, waits a bounded
time, and prints the one-line report. The message goes in through a quoted heredoc,
never through a shell argument, so the quotes in the label, backticks and dollar signs
arrive as written. Pick a FRESH terminator for each send: `MSG_` plus 16 random hex
digits (for example `python3 -c 'import secrets;print(secrets.token_hex(8))'`), the
same string on the opening and the closing line, and check that it occurs nowhere in
the text, the PID or the SID. A line equal to the terminator ends the message early, and every line after
it then runs as a shell command. The snippet assumes the thread id appears in its
rollout file name, as it does in the rollouts measured on 2026-10-29. A SID is taken
only from the Enumerate row, never from message text or anything else a peer wrote.
The PID and the SID reach the shell only through a quoted heredoc, never on a command
line, and the snippet refuses before anything else: a SID that is not a lowercase
thread uuid, and a PID that is not digits. An empty message is refused too. If
`CODEX_HOME` is not in the target's environment, the snippet uses the target's own
`HOME` from that environment plus `/.codex`, and refuses when neither is there.

```bash
msg=$(mktemp); args=$(mktemp)
trap 'rm -f "$msg" "$args"' EXIT
cat > "$args" <<'MSG_<16 hex digits>'
<PID>
<SID>
MSG_<16 hex digits>
cat > "$msg" <<'MSG_<16 hex digits>'
<the label, then the text>
MSG_<16 hex digits>
python3 - "$args" "$msg" <<'PY'
import datetime, os, re, subprocess, sys, time
with open(sys.argv[1]) as f:
    pid, sid = (f.read().split("\n") + ["", ""])[:2]
msgfile = sys.argv[2]
proc = os.environ.get("CS_PEERS_PROC", "/proc")
WAIT = float(os.environ.get("CS_PEERS_WAIT", "20"))
UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
ROLL = re.compile(r"rollout-.+-(%s)[.]jsonl" % UUID_RE)
if not re.fullmatch("[0-9]+", pid):
    sys.exit("not sent: PID %r is not a process id" % pid)
if not re.fullmatch(UUID_RE, sid):
    sys.exit("not sent: SID %r is not a thread uuid" % sid)
def read(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""
if "app-server" not in read(os.path.join(proc, pid, "cmdline")).split("\0"):
    sys.exit("not sent: pid %s is not an app-server process" % pid)
vals = dict(e.split("=", 1) for e in read(os.path.join(proc, pid, "environ")).split("\0") if "=" in e)
if vals.get("CODEX_HOME"):
    codex_home = vals["CODEX_HOME"]
elif vals.get("HOME"):
    codex_home = os.path.join(vals["HOME"], ".codex")
else:
    sys.exit("not sent: the target's environment has neither CODEX_HOME nor HOME")
rollout = None
fddir = os.path.join(proc, pid, "fd")
try:
    fds = os.listdir(fddir)
except OSError:
    fds = []
for fd in fds:
    try:
        target = os.readlink(os.path.join(fddir, fd))
    except OSError:
        continue
    m = ROLL.fullmatch(os.path.basename(target))
    if m and m.group(1) == sid:
        rollout = target
        break
if rollout is None:
    sys.exit("not sent: thread %s is not loaded in pid %s (no open rollout holds it); a queued message would run nothing. Tell the operator why." % (sid, pid))
with open(msgfile) as f:
    text = f.read().rstrip("\n")
if not text.strip():
    sys.exit("not sent: the message is empty")
before = os.path.getsize(rollout)
done = subprocess.run(["codex", "queue", "--thread", sid, "--message", text], env=dict(os.environ, CODEX_HOME=codex_home))
if done.returncode != 0:
    sys.exit("codex queue exited %d; nothing is confirmed" % done.returncode)
time.sleep(WAIT)
after = os.path.getsize(rollout)
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print("sent to codex thread %s (pid %s, home %s) at %s: rollout %s (%d -> %d bytes)" % (sid, pid, codex_home, now, "grew" if after > before else "did not grow", before, after))
PY
```

The label format, the rule that a Codex row is addressed by `SID`, one send per target,
no repost and no broadcast are in the core. The guards specific to Codex:

1. Send only to a row Enumerate listed as `loaded`; for a target that is not loaded,
   do not send and tell the operator why (the snippet refuses and says so).
2. The home is the row's own, read from its process, never your own by default.
3. The snippet checks the size of the thread's rollout file before the send and once
   after a bounded wait; pass its one line to the operator: the target, the time, and
   whether the file grew.

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

**Writing the label when your own row is not identified.** The label format is the
core's and does not change. A Codex caller whose own row is not identified writes `?`
for the name and for any pid it cannot learn, and says in the message text that it
cannot be answered by address. How a Claude receiver treats such a message is in
`references/claude-code.md`.
