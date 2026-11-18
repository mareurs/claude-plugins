#!/bin/bash
# scripts/lib-plugin-build.sh — run_plugin_build <repo-root> <plugin>
#
# Runs <plugin>/scripts/build.sh when the plugin has one, so a release also
# builds and installs what the plugin runs. Today only session-bridge has such a
# script: it runs cargo test and clippy, then installs the binary into
# ${CARGO_HOME:-$HOME}/.cargo/bin, which is where its hooks and MCP server read it.
#
# - No <plugin>/scripts/build.sh: return 0 without output (the plugin needs no build).
# - build.sh fails: return 1. The caller must stop the release before it changes anything.
run_plugin_build() {
  local root="$1" plugin="$2"
  local script="$root/$plugin/scripts/build.sh"
  [ -f "$script" ] || return 0
  echo "▶ build: $plugin/scripts/build.sh"
  if ! bash "$script"; then
    echo "✗ $plugin build failed — nothing bumped, NOT releasing"
    return 1
  fi
  echo "✓ $plugin built and installed"
}
