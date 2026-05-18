#!/usr/bin/env bash
# session-bridge/scripts/build.sh — test + release build.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mcp-server"
cargo test --quiet
cargo build --release --quiet
echo "binary: $ROOT/mcp-server/target/release/session-bridge-mcp"
