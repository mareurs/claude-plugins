#!/usr/bin/env bash
# tests/test-claude-md-citations.sh — every `CLAUDE.md § <name>` citation in a live file
# must name a heading of the root CLAUDE.md.
#
# Why: scripts, tests, memories and comments cite sections of CLAUDE.md by name. A heading
# that is renamed or removed leaves those citations pointing at nothing, and nothing else
# notices (measured 2026-11-24: "§ Testing Discipline" had no heading).
#
# Scope: live files only. History (docs/trackers, docs/issues, docs/superpowers) cites
# headings as they were when written, so it is out of scope. buddy/CLAUDE.md:60 says
# "the repo-root CLAUDE.md", so every citation here is read against the root file.
#
# A citation is `CLAUDE.md`, up to 12 characters that are not `§`, then `§`, then spaces,
# quotes, `*` or `_`, then the cited name (the following run of letters, digits, spaces
# and hyphens). It resolves when a heading, lowercased with markup stripped, contains the
# name. A longer name ("Testing Discipline" against the heading "Testing") does not resolve.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDEMD="$ROOT/CLAUDE.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── claude-md-citations ──"

norm() { tr 'A-Z' 'a-z' | tr -d '*`"_' | sed -E 's/^[[:space:]]+//; s/[[:space:]-]+$//'; }

HEADINGS="$(grep -E '^#{1,6} ' "$CLAUDEMD" | sed -E 's/^#+ +//' | norm)"

resolves() { # name -> 0 when some heading matches
  local name h
  name="$(printf '%s' "$1" | norm)"
  [ -n "$name" ] || return 1
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    case "$h" in *"$name"*) return 0 ;; esac
  done <<< "$HEADINGS"
  return 1
}

unresolved() { # paths... -> prints "file:line: § name" for each citation that resolves to no heading
  local hit loc name
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    loc="$(printf '%s' "$hit" | sed -E 's/^([^:]+:[0-9]+):.*$/\1/')"
    name="$(printf '%s' "$hit" | sed -E 's/^[^:]+:[0-9]+:.*§[ "*_]*//')"
    resolves "$name" || echo "$loc: § $name"
  done < <(grep -rnoE 'CLAUDE\.md[^§]{0,12}§[ "*_]*[A-Za-z0-9][A-Za-z0-9 -]*' \
      --exclude-dir=__pycache__ --exclude-dir=node_modules --exclude-dir=target \
      --exclude=test-claude-md-citations.sh "$@" 2>/dev/null)
}

cd "$ROOT" || exit 1
LIVE=()
for p in scripts tests .github AGENTS.md buddy/CLAUDE.md buddy/scripts buddy/pyproject.toml \
         codescout-companion/hooks .codescout/memories .codescout/system-prompt.md docs/templates; do
  [ -e "$p" ] && LIVE+=("$p")
done

MISSING="$(unresolved "${LIVE[@]}")"
if [ -z "$MISSING" ]; then
  ok "every CLAUDE.md § citation resolves"
else
  bad "every CLAUDE.md § citation resolves" "$(printf '%s' "$MISSING" | tr '\n' ';')"
fi

# Control: a citation to a heading that does not exist must be reported.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf 'see CLAUDE.md § No Such Heading for details\n' > "$T/control.txt"
if [ -n "$(unresolved "$T/control.txt")" ]; then
  ok "control: a citation to a missing heading fails"
else
  bad "control: a citation to a missing heading fails" "the checker accepted a bogus citation"
fi

echo "── claude-md-citations: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
