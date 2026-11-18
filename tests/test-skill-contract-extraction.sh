#!/usr/bin/env bash
# Parser tests run on CI even when the live codescout binary is unavailable.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/tests/lib/test_skill_contract_calls.py"
