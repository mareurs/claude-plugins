#!/usr/bin/env bash
# tests/test-marketplace-validate.sh — a plugin name Claude Code reserves must not
# reach .claude-plugin/marketplace.json.
#
# Why this exists: `claude-statusline` was reserved (the name starts with `claude-`),
# so `claude plugin validate` failed for the WHOLE marketplace while install and load
# kept working. Nothing in tests/run-all.sh noticed, because no suite called the
# validator. See docs/issues/2026-10-04-claude-statusline-name-is-reserved-and-fails-marketplace-validation.md.
#
# Two layers, because the second needs the `claude` CLI and CI does not install it:
#   1. OFFLINE — a jq check of the documented reserved-name rules against every
#      plugin name in marketplace.json. Runs everywhere, including CI.
#   2. CLI — the real `claude plugin validate`, when `claude` is on PATH. Skipped
#      with a loud notice otherwise (a silent skip reads as coverage).
# Each layer has a positive control: a case that MUST fail, so a check that cannot
# fail does not pass for the wrong reason.
#
# Rule source: https://code.claude.com/docs/en/plugins-reference.md, section `name`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MKT="$ROOT/.claude-plugin/marketplace.json"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cs-mkt-validate-XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

# Names the validator rejects, per the rule text it prints: a prefix list, an exact
# list, and "official" beside "claude" or "anthropic". Prints each offending name.
reserved_names() {  # <marketplace.json>
  jq -r '.plugins[].name
    | select(
        test("^(claude-|anthropic-|anthropics-|cc-plugin-)")
        or . == "claude" or . == "anthropic" or . == "anthropics"
        or . == "claude-code" or . == "claude-mods"
        or (test("official") and test("claude|anthropic"))
      )' "$1"
}

echo "── marketplace reserved plugin names (offline) ──"

# Positive control FIRST: a marketplace that must be flagged. Without it, "the real
# marketplace is clean" proves nothing — a broken filter would also report clean.
mkdir -p "$TMP/ctl/.claude-plugin"
printf '{"name":"fixture-mkt","owner":{"name":"t"},"plugins":[{"name":"claude-foo","source":"./claude-foo"},{"name":"fine","source":"./fine"},{"name":"anthropic","source":"./a"},{"name":"official-claude-x","source":"./b"}]}\n' \
  > "$TMP/ctl/.claude-plugin/marketplace.json"
FLAGGED="$(reserved_names "$TMP/ctl/.claude-plugin/marketplace.json" | tr '\n' ' ')"
if [ "$FLAGGED" = "claude-foo anthropic official-claude-x " ]; then
  ok "control: flags prefix, exact and 'official' cases and leaves a normal name alone"
else
  bad "control" "flagged [$FLAGGED]"
fi

if [ ! -f "$MKT" ]; then
  bad "marketplace.json exists" "missing $MKT"
else
  REAL="$(reserved_names "$MKT" | tr '\n' ' ')"
  if [ -z "$REAL" ]; then
    ok "no plugin name in marketplace.json is reserved"
  else
    bad "no plugin name in marketplace.json is reserved" "reserved: $REAL"
  fi
fi

echo "── claude plugin validate (CLI) ──"

if ! command -v claude >/dev/null 2>&1; then
  echo "  ▷ SKIPPED: \`claude\` is not on PATH, so the real validator did not run."
  echo "    The offline layer above still ran. This is not a pass of the CLI check."
else
  # Positive control: the validator must reject a reserved name, or its verdict on
  # the real marketplace means nothing.
  mkdir -p "$TMP/ctl/claude-foo/.claude-plugin"
  printf '{"name":"claude-foo","version":"0.0.1","description":"x"}\n' \
    > "$TMP/ctl/claude-foo/.claude-plugin/plugin.json"
  OUT="$(claude plugin validate "$TMP/ctl" 2>&1)"; RC=$?
  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q 'is reserved'; then
    ok "control: the validator rejects a reserved name (exit $RC)"
  else
    bad "control: the validator rejects a reserved name" "exit=$RC; output did not say 'is reserved'"
  fi

  OUT="$(claude plugin validate "$ROOT" 2>&1)"; RC=$?
  if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'Validation passed'; then
    ok "claude plugin validate passes for the marketplace"
  else
    bad "claude plugin validate passes for the marketplace" "exit=$RC: $(printf '%s' "$OUT" | grep -m3 '❯\|✘' | tr '\n' ' ')"
  fi
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
