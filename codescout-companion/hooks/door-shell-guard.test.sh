#!/usr/bin/env bash
# Test matrix for door-shell-guard.mjs.
#
# The hook repeats, for the native Bash tool, the test that codescout's run_command gate
# makes (`door_shell_hazard` in codescout's src/util/path_security.rs, step 2.6b in
# src/tools/run_command/inner.rs): refuse a `codescout call` / `codescout box` command
# line whose text the shell would expand before codescout reads it.
#
# The 17 rows of rows_json and the 17 rows of doc_rows_json below are copied from the Rust unit
# test `door_shell_hazard_table` (the doc rows are its `codescout doc create|update` rows).
# The two repositories cannot share a file, so the table is repeated; the command text is
# written as the Rust table writes it (the JS string escapes \n \" \\ mean what the Rust ones do).

set -uo pipefail

HOOK="${DOOR_SHELL_GUARD_HOOK:-$(cd "$(dirname "$0")" && pwd)/door-shell-guard.mjs}"

PASS=0
FAIL=0

# One JSON array of {name, cmd, want}; want is none | heredoc | json | body.
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
  ["here-string takes no body",
   "codescout call doc \x27{}\x27 <<< x", "none"],
  ["double-quoted delimiter is safe",
   "codescout call doc - <<\"EOF\"\n{}\nEOF", "none"],
  ["the words inside a quoted echo are not an invocation",
   "echo \"see codescout box docs\"; cat <<EOF >f\nx\nEOF", "none"],
];
process.stdout.write(JSON.stringify(rows.map(([name, cmd, want]) => ({ name, cmd, want }))));
'
}

# The `codescout doc create|update` rows of the Rust table, same shape as rows_json.
doc_rows_json() {
    node --input-type=module -e '
const rows = [
  ["doc create, quoted heredoc delimiter is safe",
   "codescout doc create --kind spec --title t --rel-path docs/x.md --body - <<\x27EOF\x27\nb `x` $y\nEOF", "none"],
  ["doc create, bare <<EOF",
   "codescout doc create --kind spec --title t --rel-path docs/x.md --body - <<EOF\nb `x` $y\nEOF", "heredoc"],
  ["doc update, path-prefixed binary, bare <<EOF",
   "./target/debug/codescout doc update ID --body - <<EOF\nb\nEOF", "heredoc"],
  ["doc update, --body double-quoted with a backtick",
   "codescout doc update ID --body \"run `ls`\"", "body"],
  ["doc update, --body= double-quoted with $",
   "codescout doc update ID --body=\"$HOME\"", "body"],
  ["doc update, --body single-quoted is safe",
   "codescout doc update ID --body \x27run `ls`\x27", "none"],
  ["doc update, --body double-quoted plain text is safe",
   "codescout doc update ID --body \"plain text\"", "none"],
  ["doc update, --title \"$X\" is not examined",
   "codescout doc update ID --title \"$X\" --body -", "none"],
  ["doc get is not examined",
   "codescout doc get ID --heading \"## A `x`\"", "none"],
  ["doc find is not examined",
   "codescout doc find --semantic \"a `b`\"", "none"],
  ["doc get with a bare heredoc is not a door write",
   "codescout doc get ID <<EOF\nx\nEOF", "none"],
  ["the words inside a quoted echo are not a doc invocation",
   "echo \"run codescout doc create\"", "none"],
  ["call with --body double-quoted: only doc verbs judge --body",
   "codescout call doc \x27{}\x27 --body \"$HOME\"", "none"],
  ["doc update, double-quoted JSON --patch-params is not examined",
   "codescout doc update ID --patch-params \"{\\\"a\\\":\\\"$V\\\"}\"", "none"],
  ["doc update, --title starting with { is not judged as JSON",
   "codescout doc update ID --title \"{$X}\"", "none"],
  ["doc update, a {-led --body is judged as a body",
   "codescout doc update ID --body \"{$x}\"", "body"],
  ["doc create, --body double-quoted with a backtick",
   "codescout doc create --kind spec --title t --rel-path docs/x.md --body \"a `x`\"", "body"],
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

# $1 label, $2 tool name, $3 command, $4 expectation: none | heredoc | json | body,
# $5 (optional) the example the deny reason must carry (default: the call form)
check() {
    local label="$1" tool="$2" cmd="$3" want="$4" hint out body exit_line reason decision
    if [[ $# -ge 5 ]]; then hint="$5"; else hint="--text body - <<'EOF'"; fi
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
        heredoc|json|body)
            local needle="is unquoted"
            [[ "$want" == "json" ]] && needle="the JSON argument is in double quotes"
            [[ "$want" == "body" ]] && needle="the --body text is in double quotes"
            if [[ "$decision" != "deny" ]]; then bad "$label" "expected deny, got: ${body:-<empty>}"; return; fi
            if [[ "$reason" != *"$needle"* ]]; then bad "$label" "reason lacks '$needle': $reason"; return; fi
            if [[ "$reason" != *"$hint"* ]]; then bad "$label" "reason lacks the example '$hint': $reason"; return; fi
            if [[ "$reason" != *"use run_command with acknowledge_risk=true"* ]]; then bad "$label" "reason lacks the run_command acknowledge_risk sentence: $reason"; return; fi
            ok "$label"
            ;;
    esac
}

# --- The 17-row table -------------------------------------------------------------
ROWS=$(rows_json)
N=$(printf '%s' "$ROWS" | jq 'length')
if [[ "$N" != "17" ]]; then
    bad "table has 17 rows" "got $N"
fi
for ((i = 0; i < N; i++)); do
    name=$(printf '%s' "$ROWS" | jq -r ".[$i].name")
    cmd=$(printf '%s' "$ROWS" | jq -r ".[$i].cmd")
    want=$(printf '%s' "$ROWS" | jq -r ".[$i].want")
    check "row $((i + 1)): $name" Bash "$cmd" "$want"
done

# --- The doc create|update rows of the Rust table -----------------------------------
DOC_ROWS=$(doc_rows_json)
DN=$(printf '%s' "$DOC_ROWS" | jq 'length')
if [[ "$DN" != "17" ]]; then
    bad "doc table has 17 rows" "got $DN"
fi
for ((i = 0; i < DN; i++)); do
    name=$(printf '%s' "$DOC_ROWS" | jq -r ".[$i].name")
    cmd=$(printf '%s' "$DOC_ROWS" | jq -r ".[$i].cmd")
    want=$(printf '%s' "$DOC_ROWS" | jq -r ".[$i].want")
    check "doc row $((i + 1)): $name" Bash "$cmd" "$want" "--body - <<'EOF'"
done

# --- Refusal text, ported exactly from run_command step 2.6b ----------------------
HEREDOC_CMD=$'codescout call doc \'{"action":"update","id":"x"}\' --text body - <<EOF\nbody\nEOF'
JSON_CMD='codescout call doc "{\"body\":\"run `ls`\"}"'
out=$(run_hook Bash "$HEREDOC_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
want_heredoc_err='the heredoc `<<EOF` is unquoted, so the shell runs backticks and expands `$` in its body before codescout reads it'
want_create='codescout call doc '\''{"action":"create","kind":"…","title":"…","rel_path":"docs/…"}'\'' --text body - <<'\''EOF'\'
want_update='codescout call doc '\''{"action":"update","id":"…","patch":{}}'\'' --text /patch/body - <<'\''EOF'\'
want_last='To run it as written anyway, use run_command with acknowledge_risk=true.'
for needle in "$want_heredoc_err" "$want_create" "$want_update" "$want_last" \
    'Put the body after the command with a quoted delimiter, and keep the JSON in single quotes:' \
    'An update that overwrites a whole body:'; do
    if [[ "$reason" == *"$needle"* ]]; then ok "heredoc refusal contains: ${needle:0:50}"; else bad "heredoc refusal contains: ${needle:0:50}" "$reason"; fi
done
if [[ "$reason" == *"ask the user to approve"* ]]; then bad "refusal does not ask for an approval a hard deny cannot give" "$reason"; else ok "refusal does not ask for an approval a hard deny cannot give"; fi

out=$(run_hook Bash "$JSON_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
want_json_err='the JSON argument is in double quotes, so the shell runs backticks and expands `$` in it before codescout reads it: {\"body\":\"run `ls`\"}'
if [[ "$reason" == *"$want_json_err"* ]]; then ok "json refusal names the argument excerpt"; else bad "json refusal names the argument excerpt" "$reason"; fi

# --- Doc refusal text: the --body wording, the excerpt, the doc example only --------
BODY_CMD='codescout doc update ID --body "run `ls`" --json'
out=$(run_hook Bash "$BODY_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
want_body_err='the --body text is in double quotes, so the shell runs backticks and expands `$` in it before codescout reads it: run `ls`'
want_doc_hint="codescout doc update <id> --body - <<'EOF'"
if [[ "$reason" == *"$want_body_err"* && "$reason" != *"run \`ls\`\""* ]]; then ok "body refusal names the body word, cut at the closing quote"; else bad "body refusal names the body word, cut at the closing quote" "$reason"; fi
if [[ "$reason" == *"$want_doc_hint"* && "$reason" != *"codescout call doc"* ]]; then ok "doc-only refusal carries the doc example, not the call one"; else bad "doc-only refusal carries the doc example, not the call one" "$reason"; fi
MIXED_CMD=$'codescout call doc \'{}\' --text body - <<EOF\nb\nEOF\ncodescout doc update ID --body -'
out=$(run_hook Bash "$MIXED_CMD" | sed '$d')
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
if [[ "$reason" == *"codescout call doc"* && "$reason" == *"$want_doc_hint"* ]]; then ok "call plus doc refusal carries both examples"; else bad "call plus doc refusal carries both examples" "$reason"; fi

# --- Not a Bash call, or nothing to judge: the hook stays silent -------------------
check "non-Bash tool is ignored" Read "$HEREDOC_CMD" none
check "codescout's own run_command is ignored (its gate refuses there)" run_command "$HEREDOC_CMD" none
check "empty command is ignored" Bash "" none
out=$(printf 'not json' | node "$HOOK" 2>/dev/null; echo "EXIT:$?")
if [[ "$out" == "EXIT:0" ]]; then ok "unparseable stdin exits 0 silently"; else bad "unparseable stdin exits 0 silently" "$out"; fi

echo
echo "door-shell-guard: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
