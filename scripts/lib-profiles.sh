#!/usr/bin/env bash
# scripts/lib-profiles.sh — the Claude Code profiles every release script covers.
#
# Source this file, then loop over "${PROFILES[@]}".
#
# One list, kept here, because release.sh, bump-cache.sh and check-profile-parity.sh
# each held a copy of it. ~/.claude-stef was missing from all three: the 1.20.22
# release seeded no cache there, and the parity gate passed on "3 profile(s)" while
# that profile stayed on 1.20.21 without the wake hook (2026-10-29).
# tests/test-profile-list-single-source.sh pins that no script keeps its own copy.
#
# A profile with no install record is skipped by release.sh and check-profile-parity.sh.
# bump-cache.sh still creates its cache directory.
PROFILES=("$HOME/.claude" "$HOME/.claude-sdd" "$HOME/.claude-kat" "$HOME/.claude-stef")
