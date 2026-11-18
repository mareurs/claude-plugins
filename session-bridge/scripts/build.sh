#!/usr/bin/env bash
# session-bridge/scripts/build.sh — test, lint and install the binary.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mcp-server"
cargo test --quiet
cargo clippy --all-targets --quiet -- -D warnings
cargo install --path . --locked --quiet
echo "binary: ${CARGO_HOME:-$HOME/.cargo}/bin/session-bridge"
