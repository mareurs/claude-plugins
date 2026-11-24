#!/usr/bin/env bash
# export-feedback.test.sh: the box export redacts with CS_PRIVACY on, exports raw with it off,
# reads every box through the codescout CLI, and fails with a message that names the fix.
# A stub `codescout` on PATH serves the fixture, so the run is deterministic and needs no binary.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
EXPORT="$HERE/export_feedback.py"

if ! command -v python3 >/dev/null 2>&1; then echo "SKIP: python3 not found"; exit 0; fi
if ! command -v git >/dev/null 2>&1; then echo "SKIP: git not found"; exit 0; fi

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
has()   { if grep -qF -- "$2" "$1"; then ok "$3"; else bad "$3 (missing: $2)"; fi; }
lacks() { if grep -qF -- "$2" "$1"; then bad "$3 (leaked: $2)"; else ok "$3"; fi; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/export-feedback-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/work/acme-repo"
HOMEDIR="$TMP/home/tester-kx"
BIN="$TMP/bin"
mkdir -p "$REPO" "$HOMEDIR" "$BIN" "$TMP/empty"
git -C "$REPO" init -q
git -C "$REPO" config user.name "Jane Q Tester"

# --- the stub codescout --------------------------------------------------------
cat > "$BIN/codescout" <<'PY'
#!/usr/bin/env python3
import json, os, sys
data = json.load(open(os.environ["STUB_DATA"]))
a = sys.argv[1:]
if a and a[-1] == "--json":
    a = a[:-1]
if a == ["box"]:
    print(json.dumps(data["index"])); sys.exit(0)
if len(a) >= 3 and a[0] == "box":
    key, verb = a[1], a[2]
    box = data["boxes"].get(key)
    if box is None or (box.get("fail_list") and verb == "list"):
        sys.exit(1)
    if verb == "list":
        print(json.dumps({"entries": [{k: e[k] for k in ("key", "title", "status", "kind")} for e in box["entries"]]}))
        sys.exit(0)
    if verb == "show":
        for e in box["entries"]:
            if e["key"] == a[3]:
                print(json.dumps(e)); sys.exit(0)
        sys.exit(1)
sys.exit(2)
PY
chmod +x "$BIN/codescout"

# --- the fixture -----------------------------------------------------------------
REPO="$REPO" DATA="$TMP/data.json" EMPTY="$TMP/empty.json" FRESH="$TMP/fresh.json" python3 -I - <<'PY'
import json, os
repo = os.environ["REPO"]
fence = "`" * 3
text1 = "\n".join([
    "**What happened:** reported by jane.doe@example.org, owners tester-kx, reviewed by Jane Q Tester.",
    "Session codescout:0f1e2d3c-4b5a-4968-8777-665544332211 hit it.",
    f"Repo file {repo}/src/guard.mjs and /home/tester-kx/notes.txt and /home/tester-kx/work/mirela/src/x.py.",
    "Also ~/work/mirela/src/y.py and /opt/acme-internal/app/main.py and the dir /opt/acme-internal/ too.",
    r"Windows C:\Users\jdoe\proj\a.txt and C:/Users/jdoe/proj/b.txt and WSL /mnt/c/Users/jdoe/proj/c.txt.",
    "Config ~/.claude-kat/settings.json and /home/tester-kx/.codex/config.toml but /home/tester-kx/work/.git/config.",
    "Transcript ~/.claude/projects/-home-tester-kx-work-acme-repo/abc.jsonl and branch fix/tester-kx-login.",
    fence + "js",
    "const SECRET_CODE_MARKER = 1;",
    fence,
    "Secrets: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    "export DB_PASSWORD=hunter2hunter2 and api_key: abcd1234efgh5678 and token sk-abcdefghijklmnop1234.",
    "Header Authorization: Bearer abcdefghijklmnop12345678.",
    "Network: host 10.20.30.40 and db.internal.acme.corp and https://deploy:s3cr3tpass@git.example.org/x.git",
    "Kept: inline `symbols`, route GET /api/v1/users, https://github.com/org/repo, version 0.15.0, author: reviewer.",
])
text2 = "Text before the fence.\n" + fence + "\nUNCLOSED_MARKER stays unseen\n"
def entry(key, title, status, kind, text, **kw):
    d = dict(key=key, title=title, status=status, kind=kind, text=text, status_since="2026-11-24", archived=False)
    d.update(kw); return d
data = {
    "index": {"version": "0.15.0", "os": "linux x86_64",
              "collections": [{"key": k} for k in ("frictions", "bugs", "runtime", "broken")]},
    "boxes": {
        "frictions": {"entries": [entry("e1", f"plan drift in {repo}/src", "inbox", "friction", text1)]},
        "bugs": {"entries": [entry("e2", "an unclosed fence", "open", "bug", text2),
                             entry("e3", "an archived one", "wontfix", "bug", "old text", archived=True)]},
        "runtime": {"entries": [entry("e4", "a runtime fact", "open", "measurement", "plain runtime text")]},
        "broken": {"fail_list": True, "entries": []},
    },
}
json.dump(data, open(os.environ["DATA"], "w"))
json.dump({"index": {"version": "0.15.0", "os": "linux x86_64", "collections": []}, "boxes": {}}, open(os.environ["EMPTY"], "w"))
# A repository with no box: the first `codescout box` call made the skeleton, so `runtime` is the only collection.
made = ["skeleton: made .codescout/harness.md, docs/trackers/ledgers/runtime/readme.md"]
json.dump({"index": {"version": "0.15.0", "os": "linux x86_64", "collections": [{"key": "runtime"}], "skeleton": made}, "boxes": {}}, open(os.environ["FRESH"], "w"))
PY

# $1 = CS_PRIVACY ("" = unset), $2 = data file, rest = script args. Prints the script's stdout.
run() {
  local priv="$1" data="$2"; shift 2
  if [ -z "$priv" ]; then
    env -u CS_PRIVACY STUB_DATA="$data" PATH="$BIN:$PATH" USER=tester-kx HOME="$HOMEDIR" python3 -I "$EXPORT" --project "$REPO" "$@"
  else
    env CS_PRIVACY="$priv" STUB_DATA="$data" PATH="$BIN:$PATH" USER=tester-kx HOME="$HOMEDIR" python3 -I "$EXPORT" --project "$REPO" "$@"
  fi
}

echo "== privacy on"
ON="$TMP/on.md"
LINE="$(run on "$TMP/data.json" --out "$ON" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "export exits 0" || bad "export exits 0 (rc=$RC: $LINE)"
case "$LINE" in *"Read it before you send it"*) ok "stdout line asks for a read-through";; *) bad "stdout line asks for a read-through: $LINE";; esac
has    "$ON" "- Privacy: on" "header says privacy on"
has    "$ON" "- Codescout: 0.15.0 (linux x86_64)" "header names version and os"
has    "$ON" "- Boxes: frictions, bugs, runtime, broken" "header lists every box from the CLI"
has    "$ON" "- Not read: box broken: list failed" "a failing box is reported, not fatal"
has    "$ON" "- Redacted:" "header counts the redactions"
has    "$ON" "## runtime (1)" "a box the old code never read is exported"
has    "$ON" "an archived one" "archived and closed entries are exported"
lacks  "$ON" "$REPO" "repository path redacted"
has    "$ON" "<repo>/src/guard.mjs" "repository path becomes <repo>"
has    "$ON" "<path>/notes.txt" "a path outside the repo keeps only its file name"
lacks  "$ON" "/home/tester-kx" "no home path of the person remains"
for leak in "jane.doe@example.org" "0f1e2d3c-4b5a-4968-8777-665544332211" "tester-kx" "Jane Q Tester" "mirela" \
            "acme-internal" 'C:\Users\jdoe' "jdoe" "SECRET_CODE_MARKER" "UNCLOSED_MARKER" \
            "eyJhbGciOiJIUzI1NiJ9" "hunter2hunter2" "abcd1234efgh5678" "sk-abcdefghijklmnop1234" \
            "abcdefghijklmnop12345678" "10.20.30.40" "db.internal.acme.corp" "s3cr3tpass" "deploy:"; do
  lacks "$ON" "$leak" "redacted: $leak"
done
for kept in "<path>/x.py" "<path>/y.py" "<path>/main.py" "<path>/a.txt" "<path>/b.txt" "<path>/c.txt" \
            "[code block omitted]" "Text before the fence." "<email>" "<uuid>" "<user>" "<ip>" "<host>" \
            "<credentials>@git.example.org" "DB_PASSWORD=<secret>" "api_key: <secret>"; do
  has "$ON" "$kept" "placeholder in place: $kept"
done
for kept in 'inline `symbols`' "GET /api/v1/users" "https://github.com/org/repo" "0.15.0" "author: reviewer" \
            "~/.claude-kat/settings.json" "~/.codex/config.toml" "<path>/config" \
            "~/.claude/projects/<project>/abc.jsonl" "fix/<user>-login" \
            "plan drift in <repo>/src" "status: inbox" "kind: friction" "since: 2026-11-24"; do
  has "$ON" "$kept" "kept as written: $kept"
done

echo "== privacy off"
OFF="$TMP/off.md"
LINE="$(run off "$TMP/data.json" --out "$OFF" 2>&1)"
has    "$OFF" "- Privacy: off" "header says privacy off"
lacks  "$OFF" "- Redacted:" "no Redacted line when off"
has    "$OFF" "jane.doe@example.org" "raw e-mail kept when off"
has    "$OFF" "SECRET_CODE_MARKER" "raw code kept when off"
has    "$OFF" 'C:\Users\jdoe\proj\a.txt' "raw Windows path kept when off"
case "$LINE" in *"Read it before"*) bad "no read-through line when off";; *) ok "no read-through line when off";; esac

echo "== default and unknown values mean on"
run "" "$TMP/data.json" --out "$TMP/unset.md" >/dev/null 2>&1
has   "$TMP/unset.md" "- Privacy: on" "unset CS_PRIVACY means on"
run maybe "$TMP/data.json" --out "$TMP/unknown.md" >/dev/null 2>&1
has   "$TMP/unknown.md" "- Privacy: on" "unknown CS_PRIVACY value means on"
lacks "$TMP/unknown.md" "jane.doe@example.org" "unknown value still redacts"

echo "== output options"
run on "$TMP/data.json" >/dev/null 2>&1
DEFAULT="$HOMEDIR/codescout-feedback-$(date +%Y-%m-%d).md"
[ -f "$DEFAULT" ] && ok "default file is ~/codescout-feedback-<date>.md" || bad "default file is ~/codescout-feedback-<date>.md"
run on "$TMP/data.json" --out - 2>/dev/null | grep -qF "# Codescout feedback export" && ok "--out - prints to stdout" || bad "--out - prints to stdout"
run on "$TMP/data.json" --box frictions --out "$TMP/one.md" >/dev/null 2>&1
has   "$TMP/one.md" "## frictions (1)" "--box keeps the named box"
lacks "$TMP/one.md" "## runtime" "--box leaves the others out"

echo "== failures exit 2 and name the fix"
ERR="$(run on "$TMP/data.json" --box nope --out "$TMP/x.md" 2>&1 >/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "unknown box exits 2" || bad "unknown box exits 2 (rc=$RC)"
case "$ERR" in *"Boxes here: frictions, bugs, runtime, broken"*) ok "unknown box lists the keys";; *) bad "unknown box lists the keys: $ERR";; esac
ERR="$(run on "$TMP/empty.json" --out "$TMP/x.md" 2>&1 >/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "no box exits 2" || bad "no box exits 2 (rc=$RC)"
case "$ERR" in *"no boxes found"*) ok "no box says so";; *) bad "no box says so: $ERR";; esac
ERR="$(run on "$TMP/fresh.json" --out "$TMP/x.md" 2>&1 >/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "a repository whose only box was just made exits 2" || bad "a repository whose only box was just made exits 2 (rc=$RC)"
case "$ERR" in *"skeleton: made .codescout/harness.md"*) ok "the skeleton lines reach the user on stderr";; *) bad "the skeleton lines reach the user on stderr: $ERR";; esac
case "$ERR" in *"no boxes found"*) ok "a just-made skeleton has nothing to export";; *) bad "a just-made skeleton has nothing to export: $ERR";; esac
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); d["index"]["skeleton"]=["skeleton: made .codescout/harness.md"]; json.dump(d,open(sys.argv[2],"w"))' "$TMP/data.json" "$TMP/data-skel.json"
ERR="$(run on "$TMP/data-skel.json" --out "$TMP/y.md" 2>&1 >/dev/null)"; RC=$?
[ "$RC" -eq 0 ] && ok "a repository with boxes still exports when the call made the skeleton" || bad "a repository with boxes still exports when the call made the skeleton (rc=$RC)"
case "$ERR" in *"skeleton: made .codescout/harness.md"*) ok "an export that made the skeleton shows it on stderr";; *) bad "an export that made the skeleton shows it on stderr: $ERR";; esac
PYREAL="$(python3 -c 'import sys; print(sys.executable)')"  # python3 may be a shim that needs bash on PATH
ERR="$(env PATH="$TMP/empty" HOME="$HOMEDIR" "$PYREAL" -I "$EXPORT" --project "$REPO" --out "$TMP/x.md" 2>&1 >/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "missing codescout exits 2" || bad "missing codescout exits 2 (rc=$RC)"
case "$ERR" in *"codescout is not on PATH"*) ok "missing codescout names the fix";; *) bad "missing codescout names the fix: $ERR";; esac
[ ! -e "$TMP/x.md" ] && ok "a failed run writes no file" || bad "a failed run writes no file"

echo "== the first version is gone"
[ ! -e "$ROOT/scripts/export-feedback.py" ] && ok "scripts/export-feedback.py removed" || bad "scripts/export-feedback.py removed"

echo
echo "export-feedback: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
