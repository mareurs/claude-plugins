#!/bin/bash
# scripts/lib-plugin-build.sh — run_plugin_build <repo-root> <plugin> [<version>]
#
# Runs <plugin>/scripts/build.sh when the plugin has one, so a release also
# builds and installs what the plugin runs. Today only session-bridge has such a
# script: it runs cargo test and clippy, then installs the binary into
# ${CARGO_HOME:-$HOME}/.cargo/bin, which is where its hooks and MCP server read it.
#
# - No <plugin>/scripts/build.sh: return 0 without output (the plugin needs no build).
# - build.sh fails: return 1. The caller must stop the release before it changes anything.
# - <version> given and <plugin>/mcp-server/Cargo.toml exists: write <version> into
#   Cargo.toml and into the crate's own Cargo.lock entry BEFORE the build, so the installed
#   binary prints the release version. If the build fails, both files are restored, so a
#   red build still changes nothing. A plugin without a crate ignores <version>.

# set_crate_version <crate-dir> <version> — Cargo.toml [package] version and the crate's
# own entry in Cargo.lock. Other Cargo.lock entries stay as they are.
set_crate_version() {
  local dir="$1" version="$2" name tmp
  name="$(awk -F'"' '/^name *=/{print $2; exit}' "$dir/Cargo.toml")"
  tmp="$(mktemp)"
  awk -v v="$version" '!done && /^version *= *"/ { print "version = \"" v "\""; done=1; next } { print }' \
    "$dir/Cargo.toml" > "$tmp" && cat "$tmp" > "$dir/Cargo.toml"
  if [ -f "$dir/Cargo.lock" ] && [ -n "$name" ]; then
    awk -v n="$name" -v v="$version" '
      $0 == "name = \"" n "\"" { hit=1; print; next }
      hit && /^version *= *"/ { print "version = \"" v "\""; hit=0; next }
      { print }' "$dir/Cargo.lock" > "$tmp" && cat "$tmp" > "$dir/Cargo.lock"
  fi
  rm -f "$tmp"
}

run_plugin_build() {
  local root="$1" plugin="$2" version="${3:-}"
  local script="$root/$plugin/scripts/build.sh"
  [ -f "$script" ] || return 0
  local crate="$root/$plugin/mcp-server" saved=""
  if [ -n "$version" ] && [ -f "$crate/Cargo.toml" ]; then
    saved="$(mktemp -d)"
    cp "$crate/Cargo.toml" "$saved/Cargo.toml"
    [ -f "$crate/Cargo.lock" ] && cp "$crate/Cargo.lock" "$saved/Cargo.lock"
    set_crate_version "$crate" "$version"
  fi
  echo "▶ build: $plugin/scripts/build.sh"
  if ! bash "$script"; then
    if [ -n "$saved" ]; then
      cp "$saved/Cargo.toml" "$crate/Cargo.toml"
      [ -f "$saved/Cargo.lock" ] && cp "$saved/Cargo.lock" "$crate/Cargo.lock"
      rm -rf "$saved"
    fi
    echo "✗ $plugin build failed — nothing bumped, NOT releasing"
    return 1
  fi
  [ -n "$saved" ] && rm -rf "$saved"
  echo "✓ $plugin built and installed"
}
