#!/bin/bash
# Usage: bash test-detect.sh <CWD>
CWD="${1:-/tmp}"
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)/code-explorer-routing/hooks"
source "$HOOK_DIR/detect-tools.sh"
echo "HAS_CODE_EXPLORER=$HAS_CODE_EXPLORER"
echo "CE_SERVER_NAME=$CE_SERVER_NAME"
echo "CE_PREFIX=$CE_PREFIX"
echo "HAS_CE_ONBOARDING=$HAS_CE_ONBOARDING"
echo "HAS_CE_MEMORIES=$HAS_CE_MEMORIES"
echo "CE_MEMORY_NAMES=$CE_MEMORY_NAMES"
