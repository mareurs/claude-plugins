#!/bin/bash
# Shared detection logic — sourced by other hooks.
# Thin shim around scripts/detect.py — keeps the historical sourcing pattern
# (`source detect-tools.sh`) so callers don't change.
#
# Expects: CWD to be set before sourcing
# Sets: HAS_CODESCOUT, CS_SERVER_NAME, CS_PREFIX, CS_BINARY, CS_PROJECT_DIR,
#       HAS_CS_ONBOARDING, HAS_CS_MEMORIES, CS_MEMORY_NAMES,
#       HAS_CS_SYSTEM_PROMPT, CS_SYSTEM_PROMPT, BLOCK_READS, WORKSPACE_ROOT,
#       SOURCE_EXT_PATTERN
#
# Detection logic (and its unit tests) lives in scripts/detect.py — see
# I-11 in docs/trackers/2026-05-07-shine-improvements.md.

_DETECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
eval "$(CWD="$CWD" HOME="$HOME" CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}" \
        python3 "$_DETECT_DIR/detect.py")"
unset _DETECT_DIR
