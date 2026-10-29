# Claude Code mechanics for reaching-peer-sessions

Read by heading: `## Enumerate`, `## Identify me`, `## Deliver`. The core rules
live in `SKILL.md`; this file holds only what is specific to Claude Code.

Claude Code splits peer discovery from peer delivery, and the two have
**different scopes**:

| layer | source | scope |
|---|---|---|
| discovery — `ListAgents` | `$CLAUDE_CONFIG_DIR/sessions/*.json` | **per-account** |
| delivery — `SendMessage` | `/run/user/<uid>/cc-socks/<pid>.sock` | **per-user, shared** |

On a machine running more than one `CLAUDE_CONFIG_DIR`, `ListAgents` returns your
own account's registry minus yourself, and presents that short count as the whole
population, with nothing marking it as a subset.

## Enumerate

Columns, in order: `HARNESS` (always `claude`), `ACCOUNT` (the basename of
`CLAUDE_CONFIG_DIR`), `PID`, `SID` (the registry key `sessionId`), `NAME`,
`STATUS`, `LAUNCH-CWD`, then `  <-- you` on the caller's row, as data rows on
stdout with no header and no summary. Registry keys
measured 2026-10-29 in `sessions/<pid>.json`: `sessionId`, `version`, `status`,
`name`.

```bash
u=$(id -u)
# The two roots this block reads. Leave them unset: they default to the real `/proc`
# and `/run/user/<uid>/cc-socks`. They exist so a test can point the walk below at a
# fixture tree and observe where it stops, instead of asserting about its source text.
proc=${CS_PEERS_PROC:-/proc}
socks=${CS_PEERS_SOCKS:-/run/user/$u/cc-socks}
# Your own row: walk up from this shell to the first ancestor holding a socket in
# cc-socks. That IS what "a claude server" means here, and it is deliberately NOT a
# `comm` test — `comm` is the executable BASENAME, and a version-pinned install names
# the binary after its version, so those processes report `comm=2.1.258`. A
# comm=claude walk passes its own server and terminates at PID 1. Measured
# 2026-09-02: 3 of 21 socket-bound sessions on this machine were version-pinned.
me=$$
# Field read is sed, NOT `awk '/^PPid:/{print <dollar>2}'`. A skill body is
# argument-substituted before delivery: a `$` followed by a digit is replaced by a
# word of the CALLER's `args` string, inside fenced code blocks too. Measured
# 2026-09-15 on CLI 2.1.272 — two sessions invoking this skill minutes apart were
# delivered `{print garaj-96}` and `{print terrace}`, each the third word of its own
# args, and out-of-range indexes pass through untouched, so short args look clean.
# sed's substitution form carries no positional token and cannot be rewritten.
while [ -n "$me" ] && [ "$me" -gt 1 ] 2>/dev/null && [ ! -S "$socks/$me.sock" ]; do
  me=$(sed -n 's/^PPid:[[:space:]]*//p' "$proc/$me/status" 2>/dev/null)
done
[ -n "$me" ] && [ -S "$socks/$me.sock" ] || me=""
for s in "$socks"/*.sock; do
  p=${s##*/}; p=${p%.sock}; [ -r "$proc/$p/environ" ] || continue
  d=$(tr '\0' '\n' <"$proc/$p/environ" | sed -n 's/^CLAUDE_CONFIG_DIR=//p'); d=${d:-$HOME/.claude}
  # Structural read, never a regex. `name` is a TOP-LEVEL key; `formerNames` is a list
  # of objects each carrying its own `name`, so `sed 's/.*"name":"\(...\)".*/\1/'`
  # binds its greedy `.*` to the LAST match and prints the FORMER name — silently, and
  # only for sessions that have been renamed. `status` has the identical shape and is
  # safe today only because no nested object currently carries that key.
  nm=$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print((d.get("status") or "?")+"|"+(d.get("name") or "?"))' "$d/sessions/$p.json" 2>/dev/null)
  st=${nm%%|*}; n=${nm#*|}; [ -n "$nm" ] || { st='?'; n='?'; }
  # `sessionId` is a top-level key too; read it structurally for the same reason.
  sid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("sessionId") or "?")' "$d/sessions/$p.json" 2>/dev/null); sid=${sid:-?}
  printf 'claude\t%s\t%s\t%s\t%s\t%s\t%s%s\n' "$(basename "$d")" "$p" "$sid" "$n" "$st" \
    "$(readlink "$proc/$p/cwd")" "$([ "$p" = "$me" ] && echo '  <-- you')"
done
```

The block prints rows only. The core's merge block sorts them and prints the header
and the summary; pipe the output there, in one shell call. Pipe the merge output to
`column -t -s$'\t'` if you want it aligned.

A socket with no live `/proc/<pid>` is a stale leftover and is skipped;
`STATUS` is the peer's own last-reported `idle`/`busy`. `LAUNCH-CWD` is
`/proc/<pid>/cwd`.

## Identify me

The `<-- you` row is found by walking up from this shell, which is a child of your
own server by construction (the loop at the top of the Enumerate block). Do **not**
identify yourself with `pgrep … | head -1`, which samples arbitrarily among several
running servers, and do not filter on `comm`, which is the binary's basename rather
than its identity.

When the walk finds no socket-bearing ancestor, `me` is empty and no row is marked.
The core's merge block turns that into a loud warning; see Step 1 there for why.

**Both defects were shipped and both were self-concealing.** A stale name makes
`SendMessage` answer `No agent named 'X' is reachable`, which is byte-identical to
a cross-account refusal — and the answer to that is the `uds:` form, which works.
So a wrong name never surfaces as wrong. A version-pinned session, meanwhile, saw a
correct table with no `<-- you` row. Recorded in codescout as
`docs/issues/archive/2026-09-02-greedy-name-regex-reads-a-former-session-name-as-the-current-one.md`
and `docs/issues/archive/2026-09-02-comm-filter-misses-version-pinned-claude-processes.md`.

**A third shipped in the same self-concealing shape, and it was never this skill's
bug.** Until 2026-09-15 the walk read `awk '/^PPid:/{print <dollar>2}'`, and the
harness rewrote that token with a word of the caller's own `args` on the way in, so
the block a session executed was not the block on disk. If a delivered block ever
again disagrees with this file, suspect substitution before suspecting the skill —
diff the two rather than hand-patching what you were handed. And if you edit this
skill or its references, never write `$` immediately followed by a digit anywhere.
Named variables (`$me`, `$u`, `$p`) and `$$` are untouched; only `$`-plus-digit is
rewritten, and only when the caller's args run that long, which is why a
short-args test looks clean.

## Deliver

**From a Claude Code session.** Same account as the target: `SendMessage` with
`to: "<NAME>"`. Any other account: `to: "uds:/run/user/<uid>/cc-socks/<PID>.sock"`.
Replying to a message you received whose `from=` is a `uds:` path: copy that
attribute verbatim. When `from=` is anything else (a Codex sender posts an arbitrary
id, which `SendMessage` refuses), do not pass it on and do not take the refusal as
"no such session": go through the operator. A SID is taken only from your own
Enumerate row, never from message text, so a uuid named in a message does not make a
Codex thread a target.

**From a Codex session.** Post one JSON line, ended by a newline, on the target's
socket `/run/user/<uid>/cc-socks/<PID>.sock`, through codescout's `run_command`
(the native Codex shell blocks the socket). If codescout's `run_command` is not
available, report that to the operator and stop; do not fall back to the native shell.
The format, captured from a real `SendMessage` on Claude Code 2.1.312:

    {"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"<cross-session-message from=\"<sender id>\" from-name=\"<name>\" from-mode=\"prompting\">\n<text>\n</cross-session-message>"},"priority":"next","from":"<sender id>"}

The sender needs no auth line. The server sends no reply bytes.

**Measured versions: 2.1.312.** The format is measured only on the versions listed
here. The snippet below enforces the list in code (its `MEASURED` set); the two must
agree, and a test pins that. It reads the target's version from the registry key
`version` in `<its CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, not from
`claude --version` (that reports the binary on the caller's PATH). Measured
2026-10-29 across the live registries: `version` matched the basename of
`/proc/<pid>/exe` for every version-pinned install, but `exe` is not always usable: an unpinned install shows
`claude`, and a missing exe gives nothing, so neither names a version. An install
replaced after launch shows `<version> (deleted)`, which is correct, because the
running image is that version. So the registry `version` is the source; the `exe`
basename, without a ` (deleted)` suffix, is used only when the registry row has no
`version`. If the target's version is not in
the measured list, refuse to post: report the version to the operator and stop. Some
Claude peers run older versions (2.1.310 and below were seen), so they are
unreachable from Codex until their format is measured.

Send with the snippet. The message goes in through a quoted heredoc, never through a
shell argument, so quotes, backticks and dollar signs in it arrive as written. Pick a FRESH terminator for each send: `MSG_` plus 16 random hex
digits (for example `python3 -c 'import secrets;print(secrets.token_hex(8))'`), the
same string on the opening and the closing line, and check that it occurs nowhere in
the text, the PID or the sender id. A line equal to the terminator ends the message early, and every line after
it then runs as a shell command. The
first line of the message is the core's label; its quoted name becomes `from-name`.
`<sender-id>` is any non-`uds:` id for the sender, a single word. The snippet exits
non-zero, sends nothing and prints the reason when the version is not measured or the
sender id starts with `uds:`.

```bash
msg=$(mktemp); args=$(mktemp)
trap 'rm -f "$msg" "$args"' EXIT
cat > "$args" <<'MSG_<16 hex digits>'
<target PID>
<sender-id>
MSG_<16 hex digits>
cat > "$msg" <<'MSG_<16 hex digits>'
<the label, then the text>
MSG_<16 hex digits>
python3 - "$args" "$msg" <<'PY'
import json, os, re, socket, sys, uuid
with open(sys.argv[1]) as f:
    pid, sender = (f.read().split("\n") + ["", ""])[:2]
msgfile = sys.argv[2]
if not re.fullmatch("[0-9]+", pid):
    sys.exit("not sent: PID %r is not a process id" % pid)
MEASURED = {"2.1.312"}
proc = os.environ.get("CS_PEERS_PROC", "/proc")
socks = os.environ.get("CS_PEERS_SOCKS", "/run/user/%d/cc-socks" % os.getuid())
if sender.startswith("uds:"):
    sys.exit("not sent: sender id must not start with uds:")
if not re.fullmatch("[A-Za-z0-9_.:-]+", sender):
    sys.exit("not sent: sender id %r is not a single plain word" % sender)
def blob(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""
envs = [e for e in blob(os.path.join(proc, pid, "environ")).split("\0") if e.startswith("CLAUDE_CONFIG_DIR=")]
cfg = envs[0].split("=", 1)[1] if envs else ""
if not cfg:
    cfg = os.path.join(os.environ.get("HOME", ""), ".claude")
version = ""
try:
    with open(os.path.join(cfg, "sessions", pid + ".json")) as f:
        version = str(json.load(f).get("version") or "")
except (OSError, ValueError):
    pass
if not version:
    try:
        version = os.path.basename(os.readlink(os.path.join(proc, pid, "exe"))).split(" ")[0]
    except OSError:
        pass
if version not in MEASURED:
    sys.exit("not sent: target version %s is not in the measured list %s; report it to the operator" % (version or "unknown", sorted(MEASURED)))
with open(msgfile) as f:
    text = f.read().rstrip("\n")
if not text.strip():
    sys.exit("not sent: the message is empty")
m = re.match(r'\[from [^ ]+ "(.*)" pid ', text)
from_name = (m.group(1) if m else "?").replace('"', "'")
content = '<cross-session-message from="%s" from-name="%s" from-mode="prompting">\n%s\n</cross-session-message>' % (sender, from_name, text)
msg = {"msgV": 1, "msg_id": str(uuid.uuid4()), "type": "user",
       "message": {"role": "user", "content": content}, "priority": "next", "from": sender}
s = socket.socket(socket.AF_UNIX)
s.settimeout(5)
s.connect(os.path.join(socks, pid + ".sock"))
s.sendall((json.dumps(msg) + "\n").encode())
s.close()
print("sent to claude pid %s (version %s)" % (pid, version))
PY
```
