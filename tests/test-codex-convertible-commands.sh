#!/usr/bin/env bash
# tests/test-codex-convertible-commands.sh — buddy's status, check and legend
# stay convertible into Codex skills, and no command reads CLAUDE_PLUGIN_ROOT
# from the environment.
#
# WHY THIS EXISTS. Codex converts a Claude plugin's commands/*.md into skills at
# install (codex-rs/core-plugins/src/command_migration.rs, blob 1544b25296,
# identical at rust-v0.160.0, rust-v0.162.1 and origin/main on 2026-10-13). It
# SKIPS a command, silently, when its frontmatter has no `description`, when
# its body uses `$ARGUMENTS`, a `$`-plus-digit, `{{...}}`, a `!`-backtick exec
# or an `@token`, or when the rendered skill is over 4,000 bytes. Measured
# 2026-10-13: Codex converted codescout-companion's dashboard and none of
# buddy's 12 commands. status, check and legend take no argument, so they are
# the buddy commands Codex CAN carry -- and one stray `$ARGUMENTS` or a few
# hundred extra bytes drops them from Codex with no error anywhere.
# (docs/trackers/portable-workflows-session-log.md F-5.)
#
# THE ENV CHECK. Claude Code substitutes the TEXT `${CLAUDE_PLUGIN_ROOT}` in a
# command body before the model reads it, but the variable is not in the
# environment of the shell the model runs. Reproduced 2026-10-13: legend's
# `os.environ.get("CLAUDE_PLUGIN_ROOT", "")` import failed with
# ModuleNotFoundError. A Python `os.environ` read is never substituted, so it
# is always wrong; write the `${CLAUDE_PLUGIN_ROOT}` text instead.
#
# The replica below mirrors the Rust rules. A positive control (dashboard,
# which Codex did convert) and a negative control (remember, which uses
# `$ARGUMENTS`) keep it from passing vacuously.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Replica of command_migration.rs (parse_command_content, frontmatter_end,
# command_skill_name_if_supported, has_unsupported_command_template_features,
# render_command_skill) with plugin.rs's RequireFrontmatter mode and 4,000-byte
# cap. Prints `OK` or the reasons Codex would skip the file. The frontmatter
# check is stricter than serde_yaml on purpose: a line it cannot vouch for is a
# failure, because a frontmatter that does not parse loses its description.
cat > "$TMP/replica.py" <<'PY'
import re, sys
from pathlib import Path

MAX_BYTES = 4000
MAX_NAME = 64
SAFE_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
UNSAFE_START = tuple("-?:,[]{}#&*!|>'\"%@`")

def parse(text):
    if text.startswith("---\n"):
        rest = text[4:]
    elif text.startswith("---\r\n"):
        rest = text[5:]
    else:
        return None, text, []
    ends = []
    for d in ("\r\n---\r\n", "\r\n---\n", "\n---\r\n", "\n---\n", "\r\n---", "\n---"):
        i = rest.find(d)
        if i >= 0:
            ends.append((i, i + len(d)))
    if not ends:
        return None, text, []
    end, body_start = min(ends, key=lambda e: e[0])
    problems, desc = [], None
    for line in rest[:end].splitlines():
        if not line.strip():
            continue
        key, sep, value = line.partition(": ")
        value = value.strip()
        if (not sep or not SAFE_KEY.match(key) or not value
                or value.startswith(UNSAFE_START) or ": " in value or " #" in value):
            problems.append(f"frontmatter line may not parse as YAML: {line!r}")
        elif key == "description":
            desc = value
    return desc, rest[body_start:], problems

def reasons(path):
    desc, body, out = parse(path.read_text(encoding="utf-8"))
    if not desc:
        out.append("no frontmatter description")
    source = path.stem
    name = re.sub(r"[^a-z0-9]+", "-", f"source-command-{source}".lower()).strip("-")
    if len(name) > MAX_NAME:
        out.append("skill name over 64 characters")
    if "$ARGUMENTS" in body:
        out.append("uses $ARGUMENTS")
    if re.search(r"\$[0-9]", body):
        out.append("uses $ + digit")
    if "{{" in body and "}}" in body:
        out.append("uses {{ }}")
    if "!`" in body or "! `" in body:
        out.append("uses a ! + backtick exec")
    ats = [t for t in body.split() if t.startswith("@") and len(t) > 1]
    if ats:
        out.append(f"has the @token {ats[0]}")
    if desc:
        q = lambda s: '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
        template = body.strip() or "No command template body was found."
        rendered = (
            f"---\nname: {q(name)}\ndescription: {q(desc)}\n---\n\n# {name}\n\n"
            f"Use this skill when the user asks to run the migrated source command `{source}`.\n\n"
            f"## Command Template\n\n{template}\n"
        )
        size = len(rendered.encode("utf-8"))
        if size > MAX_BYTES:
            out.append(f"rendered skill is {size} B, over {MAX_BYTES}")
    return out

r = reasons(Path(sys.argv[1]))
print("OK" if not r else "; ".join(r))
PY
verdict() { python3 -I "$TMP/replica.py" "$1" 2>&1; }

TARGETS=(buddy/commands/status.md buddy/commands/check.md buddy/commands/legend.md)
CONTROL_OK=codescout-companion/commands/dashboard.md
CONTROL_BAD=buddy/commands/remember.md

# 1. POPULATION. A missing target would make case 4 skip it silently.
missing=""
for f in "${TARGETS[@]}" "$CONTROL_OK" "$CONTROL_BAD"; do
  [ -f "$REPO_ROOT/$f" ] || missing="$missing $f"
done
if [ -z "$missing" ]; then
  pass "targets and controls exist"
else
  fail "targets and controls exist" "missing:$missing"
fi

# 2. POSITIVE CONTROL. Codex converted dashboard on 2026-10-13
#    (~/.codex/.../codescout-companion/1.20.17/.codex-plugin/migrated-command-skills/
#    source-command-dashboard), so a replica that rejects it is wrong.
v=$(verdict "$REPO_ROOT/$CONTROL_OK")
if [ "$v" = "OK" ]; then
  pass "replica converts dashboard, as Codex did"
else
  fail "replica converts dashboard, as Codex did" "$v"
fi

# 3. NEGATIVE CONTROL. remember takes its argument as `$ARGUMENTS`, which Codex
#    rejects; a replica that accepts it checks nothing.
v=$(verdict "$REPO_ROOT/$CONTROL_BAD")
case "$v" in
  *ARGUMENTS*) pass "replica rejects remember for \$ARGUMENTS" ;;
  *) fail "replica rejects remember for \$ARGUMENTS" "got: $v" ;;
esac

# 4. THE ACTUAL ASSERTION.
for f in "${TARGETS[@]}"; do
  v=$(verdict "$REPO_ROOT/$f")
  if [ "$v" = "OK" ]; then
    pass "$f converts into a Codex skill"
  else
    fail "$f converts into a Codex skill" "$v"
  fi
done

# 5. NO COMMAND READS CLAUDE_PLUGIN_ROOT FROM THE ENVIRONMENT. Population first,
#    then the pattern's own controls, then the scan.
ENV_RE='(environ|getenv).{0,12}CLAUDE_PLUGIN_ROOT'
mapfile -t COMMANDS < <(find "$REPO_ROOT" -path '*/commands/*.md' -not -path '*/.git/*' | sort)
printf '%s\n' 'sys.path.insert(0, os.environ["CLAUDE_PLUGIN_ROOT"])' > "$TMP/env_bad.md"
printf '%s\n' "sys.path.insert(0, '\${CLAUDE_PLUGIN_ROOT}')" 'BUDDY_ROOT="${CLAUDE_PLUGIN_ROOT}"' > "$TMP/env_good.md"
if grep -qE "$ENV_RE" "$TMP/env_bad.md" && ! grep -qE "$ENV_RE" "$TMP/env_good.md" \
   && printf '%s\n' "${COMMANDS[@]}" | grep -q '/buddy/commands/'; then
  hits=""
  for f in "${COMMANDS[@]}"; do
    while IFS= read -r line; do
      [ -n "$line" ] && hits="$hits${f#"$REPO_ROOT"/}:$line"$'\n'
    done < <(grep -nE "$ENV_RE" "$f" 2>/dev/null || true)
  done
  if [ -z "$hits" ]; then
    pass "no command reads CLAUDE_PLUGIN_ROOT from the environment (${#COMMANDS[@]} commands)"
  else
    fail "no command reads CLAUDE_PLUGIN_ROOT from the environment" \
         "unset in the model's shell; write the \${CLAUDE_PLUGIN_ROOT} text instead:"$'\n'"$hits"
  fi
else
  fail "no command reads CLAUDE_PLUGIN_ROOT from the environment" \
       "pattern controls or command discovery failed (${#COMMANDS[@]} commands found)"
fi

# 6. LEGEND'S SNIPPET RUNS. Static checks cannot see a call that no longer
#    matches its callee. Extract legend.md's python heredoc and run it the way
#    Claude Code leaves it -- BUDDY_ROOT already holding the plugin path --
#    against a scratch project with two active specialists. Caught 2026-10-13:
#    the call still passed `home=`, which 344c4d7 removed from resolve_labels
#    on 2026-05-21, so the Currently Active list raised TypeError.
snippet="$TMP/legend_snippet.py"
awk "/^BUDDY_ROOT=.*<<'PY'/{f=1;next} /^PY\$/{f=0} f" "$REPO_ROOT/buddy/commands/legend.md" > "$snippet"
proj="$TMP/legend-proj"
mkdir -p "$proj/.buddy/sid-x"
echo sid-x > "$proj/.buddy/.current_session_id"
echo '{"active_specialists": ["debugging-yeti", "architecture-snow-lion"]}' > "$proj/.buddy/sid-x/state.json"
if [ "$(wc -l < "$snippet")" -lt 5 ]; then
  fail "legend's active-list snippet runs" "extracted $(wc -l < "$snippet") lines -- the BUDDY_ROOT heredoc anchor in legend.md moved"
else
  out=$(cd "$proj" && env -u CLAUDE_PROJECT_DIR BUDDY_ROOT="$REPO_ROOT/buddy" python3 "$snippet" 2>&1); rc=$?
  if [ "$rc" -eq 0 ] && grep -qF '(`debugging-yeti`)' <<<"$out" && grep -qF '(`architecture-snow-lion`)' <<<"$out"; then
    pass "legend's active-list snippet runs and labels both specialists"
  else
    fail "legend's active-list snippet runs and labels both specialists" "exit $rc: $out"
  fi
fi

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
