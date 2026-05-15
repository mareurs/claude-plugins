#!/usr/bin/env bash
# eval/scripts/run.sh — run the full eval on one specialist (v1: Python harness)
#
# Thin wrapper around eval/scripts/harness.py. Promptfoo's role is reserved
# for CI regression (T-11); v1 offline eval runs through the python harness.
# See docs/trackers/active-plan.md § Decisions Log § D-1.
#
# Usage:
#   ./run.sh <specialist> [--case-id CASE_ID] [--output PATH]
#
# Env required:
#   OPENROUTER_API_KEY  (single key fronts all 3 judges + candidate via OpenRouter)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

specialist="${1:-}"
shift || true

if [[ -z "$specialist" ]]; then
  echo "Usage: $0 <specialist> [--case-id CASE_ID] [--output PATH]" >&2
  exit 2
fi

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY missing. Source /home/marius/agents/llm-proxy/.env or equivalent." >&2
  exit 3
fi

exec python3 "$SCRIPT_DIR/harness.py" --specialist "$specialist" --mode single "$@"
