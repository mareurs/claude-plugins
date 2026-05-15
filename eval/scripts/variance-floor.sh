#!/usr/bin/env bash
# eval/scripts/variance-floor.sh — measure noise floor on identical inputs
#
# Thin wrapper around eval/scripts/harness.py --mode variance.
# Source: pheasant-llm Method 8 + hamsa H7 applied to ourselves.
#
# Usage:
#   ./variance-floor.sh <specialist>
#   N_RUNS=10 ./variance-floor.sh <specialist>   # override default 5

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

specialist="${1:-}"
N_RUNS="${N_RUNS:-5}"

if [[ -z "$specialist" ]]; then
  echo "Usage: $0 <specialist>" >&2
  echo "Env: N_RUNS=<N> overrides default 5" >&2
  exit 2
fi

if [[ "$N_RUNS" -lt 2 ]]; then
  echo "N_RUNS must be >= 2 to measure variance" >&2
  exit 2
fi

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY missing. Source /home/marius/agents/llm-proxy/.env or equivalent." >&2
  exit 3
fi

exec python3 "$SCRIPT_DIR/harness.py" --specialist "$specialist" --mode variance --n "$N_RUNS"
