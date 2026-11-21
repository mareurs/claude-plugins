#!/usr/bin/env bash
# Test matrix for door-shell-guard.mjs.
#
# The hook repeats, for the native Bash tool, the test that codescout's run_command gate
# makes (`door_shell_hazard` in codescout's src/util/path_security.rs, step 2.6b in
# src/tools/run_command/inner.rs): refuse a `codescout call` / `codescout box` command
# line whose text the shell would expand before codescout reads it.
#
# The 14 rows below are copied from the Rust unit test `door_shell_hazard_table`. The two
# repositories cannot share a file, so the table is repeated; the command text is written
# as the Rust table writes it (the JS string escapes \n \" \\ mean what the Rust ones do).

set -uo pipefail

HOOK="${DOOR_SHELL_GUARD_HOOK:-$(cd "$(dirname "$0")" && pwd)/door-shell-guard.mjs}"

PASS=0
FAIL=0

# One JSON array of {name, cmd, want}; want is none | heredoc | json.
rows_json() {
    node --input-type=module -e '
const rows = [
  ["quoted heredoc delimiter is safe",
   "codescout call doc \x27{\"action\":\"update\",\"id\":\"x\"}\x27 --text body - <<\x27EOF\x27\nC:\\temp `x` $HOME\nEOF", "none"],
  ["bare <<EOF",
   "codescout call doc \x27{\"action\":\"update\",\"id\":\"x\"}\x27 --text body - <<EOF\nbody\nEOF", "heredoc"],
  ["bare <<-END",
   "codescout call doc \x27{\"action\":\"update\",\"id\":\"x\"}\x27 --text body - <<-END\nbody\nEND", "heredoc"],
  ["cat <<EOF piped into call",
   "cat <<EOF | codescout call doc -\n{}\nEOF", "heredoc"],
  ["heredoc into a file, then a call on a later line",
   "cat > d.md <<EOF\nx\nEOF\ncodescout call doc \x27{\"action\":\"update\",\"id\":\"x\"}\x27 --text body d.md", "heredoc"],
  ["double-quoted JSON with a backtick",
   "codescout call doc \"{\\\"action\\\":\\\"create\\\",\\\"body\\\":\\\"run `ls`\\\"}\"", "json"],
  ["double-quoted JSON with $",
   "codescout call doc \"{\\\"action\\\":\\\"create\\\",\\\"body\\\":\\\"$HOME\\\"}\"", "json"],
  ["double-quoted --project $PWD is not JSON",
   "codescout call doc \x27{\"action\":\"find\"}\x27 --project \"$PWD\"", "none"],
  ["box verb with a bare heredoc",
   "codescout box horizon add \x27{\"title\":\"x\"}\x27 --text body - <<EOF\nb\nEOF", "heredoc"],
  ["path-prefixed binary",
   "./target/debug/codescout call doc - <<EOF\n{}\nEOF", "heredoc"],
  ["<<EOF inside single quotes",
   "codescout call doc \x27{\"body\":\"write <<EOF here\"}\x27", "none"],
  ["a mention in a heredoc body is not a door call",
   "git commit -F - <<EOF\nmentions codescout call doc\nEOF", "none"],
  ["no door call at all",
   "cat <<EOF > notes.md\nx\nEOF", "none"],
  ["backslash-escaped delimiter",
   "codescout call doc <<\\EOF\n{}\nEOF", "none"],
];
process.stdout.write(JSON.stringify(rows.map(([name, cmd, want]) => ({ name, cmd, want }))));
'
}

# Run the hook on a PreToolUse payload; echo its stdout.
run_hook() {
    local tool="$1" cmd="$2" input
    input=$(jq -n --arg t "$tool" --arg c "$cmd" --arg cwd "$PWD" \
        '{tool_name:$t, cwd:$cwd, tool_input:{command:$c}}')
    local out rc
    out=$(printf '%s' "$input" | node "$HOOK" 2>/dev/null)
    rc=$?
    printf '%s\nEXIT:%s\n' "$out" "$rc"
}

ok() { PASS=$((PASS + 1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1"; echo "      $2"; }

# $1 label, $2 tool name, $3 command, $4 expectation: none | heredoc | json
check() {
    local label="$1" tool="$2" cmd="$3" want="$4" out body exit_line reason decision
    out=$(run_hook "$tool" "$cmd")
    exit_line=$(printf '%s\n' "$out" | tail -n1)
    body=$(printf '%s\n' "$out" | sed '$d')
    if [[ "$exit_line" != "EXIT:0" ]]; then
        bad "$label" "hook exit was not 0: $exit_line"
        return
    fi
    decision=allow
    if [[ -n "$body" ]]; then
        decision=$(printf '%s' "$body" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo "unparseable")
    fi
    reason=$(printf '%s' "$body" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
    case "$want" in
        none)
            if [[ -z "$body" && "$decision" == "allow" ]]; then ok "$label"; else bad "$label" "expected no output, got: $body"; fi
            ;;
        heredoc|json)
            local needle="is unquoted"
            [[ "$want" == "json" ]] && needle="double quotes"
            if [[ "$decision" != "deny" ]]; then bad "$label" "expected deny, got: ${body:-<empty>}"; return; fi
            if [[ "$reason" != *"$needle"* ]]; then bad "$label" "reason lacks '$needle': $reason"; return; fi
            if [[ "$reason" != *"--text body - <<'EOF'"* ]]; then bad "$label" "reason lacks the --text body - <<'EOF' form: $reason"; return; fi
            ok "$label"
            ;;
    esac
}

# --- The 14-row table -------------------------------------------------------------
ROWS=$(rows_json)
N=$(printf '%s' "$ROWS" | jq 'length')
if [[ "$N" != "14" ]]; then
    bad "table has 14 rows" "got $N"
fi
for ((i = 0; i < N; i++)); do
    name=$(printf '%s' "$ROWS" | jq -r ".[$i].name")
    cmd=$(printf '%s' "$ROWS" | jq -r ".[$i].cmd")
    want=$(printf '%s' "$ROWS" | jq -r ".[$i].want")
    check "row $((i + 1)): $name" Bash "$cmd" "$want"
done

# --- Refusal text, ported exactly from run_command step 2.6b ----------------------
HEREDOC_CMD=$'codescout call doc \'{"action":"update","id":"x"}\' --text body - <<EOF\nbody\nEOF'
JSON_CMD='codescout call doc "{\"body\":\"run `ls`\"}"'
out=$(run_hook Bash "$HEREDOC_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
want_heredoc_err='the heredoc `<<EOF` is unquoted, so the shell runs backticks and expands `$` in its body before codescout reads it'
want_create='codescout call doc '\''{"action":"create","kind":"…","title":"…"}'\'' --text body - <<'\''EOF'\'
want_update='codescout call doc '\''{"action":"update","id":"…","patch":{}}'\'' --text /patch/body - <<'\''EOF'\'
want_last='To run it as written anyway, ask the user to approve the command.'
for needle in "$want_heredoc_err" "$want_create" "$want_update" "$want_last" \
    'Put the body after the command with a quoted delimiter, and keep the JSON in single quotes:' \
    'An update that overwrites a whole body:'; do
    if [[ "$reason" == *"$needle"* ]]; then ok "heredoc refusal contains: ${needle:0:50}"; else bad "heredoc refusal contains: ${needle:0:50}" "$reason"; fi
done
if [[ "$reason" == *"acknowledge_risk"* ]]; then bad "refusal does not mention acknowledge_risk" "$reason"; else ok "refusal does not mention acknowledge_risk"; fi

out=$(run_hook Bash "$JSON_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
want_json_err='the JSON argument is in double quotes, so the shell runs backticks and expands `$` in it before codescout reads it: {\"body\":\"run `ls`\"}'
if [[ "$reason" == *"$want_json_err"* ]]; then ok "json refusal names the argument excerpt"; else bad "json refusal names the argument excerpt" "$reason"; fi

# --- Not a Bash call, or nothing to judge: the hook stays silent -------------------
check "non-Bash tool is ignored" Read "$HEREDOC_CMD" none
check "empty command is ignored" Bash "" none
out=$(printf 'not json' | node "$HOOK" 2>/dev/null; echo "EXIT:$?")
if [[ "$out" == "EXIT:0" ]]; then ok "unparseable stdin exits 0 silently"; else bad "unparseable stdin exits 0 silently" "$out"; fi

echo
echo "door-shell-guard: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
