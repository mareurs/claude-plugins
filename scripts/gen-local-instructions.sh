#!/bin/bash
# scripts/gen-local-instructions.sh — write the two local instruction files from one source.
#
#   .codescout/private-facts.md  (local, untracked)  ──►  CLAUDE.local.md      facts only
#                                                    └─►  AGENTS.override.md   AGENTS.md + facts
#
# Why two shapes: Claude Code loads CLAUDE.local.md IN ADDITION to CLAUDE.md. Codex loads
# ONE file per directory and AGENTS.override.md replaces AGENTS.md there (measured on Codex
# 0.171.0, 2026-11-25), so the override must carry the whole text of AGENTS.md.
#
# Usage:
#   scripts/gen-local-instructions.sh           write both files (no facts file: write nothing)
#   scripts/gen-local-instructions.sh --check   exit 1 when a generated file is missing or
#                                               differs from what a run would write
#
# Both outputs are gitignored. Design: docs/superpowers/specs/2026-11-12-private-setup-separation-design.md (D3).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FACTS="$ROOT/.codescout/private-facts.md"
AGENTS="$ROOT/AGENTS.md"
OVERRIDE="$ROOT/AGENTS.override.md"
CLAUDE_LOCAL="$ROOT/CLAUDE.local.md"

MODE=write
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

if [ ! -f "$FACTS" ]; then
  echo "no .codescout/private-facts.md: nothing to generate"
  exit 0
fi
if [ ! -f "$AGENTS" ]; then
  echo "✗ AGENTS.md is missing: the override cannot be built" >&2
  exit 1
fi

WANT_OVERRIDE="$(mktemp)"
trap 'rm -f "$WANT_OVERRIDE"' EXIT
{ cat "$AGENTS"; printf '\n'; cat "$FACTS"; } > "$WANT_OVERRIDE"

if [ "$MODE" = check ]; then
  rc=0
  if ! cmp -s "$WANT_OVERRIDE" "$OVERRIDE" 2>/dev/null; then
    echo "✗ AGENTS.override.md is missing or stale: run scripts/gen-local-instructions.sh"; rc=1
  fi
  if ! cmp -s "$FACTS" "$CLAUDE_LOCAL" 2>/dev/null; then
    echo "✗ CLAUDE.local.md is missing or stale: run scripts/gen-local-instructions.sh"; rc=1
  fi
  exit $rc
fi

cp "$WANT_OVERRIDE" "$OVERRIDE"
cp "$FACTS" "$CLAUDE_LOCAL"
echo "wrote AGENTS.override.md and CLAUDE.local.md"
