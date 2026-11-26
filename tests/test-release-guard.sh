#!/bin/bash
# tests/test-release-guard.sh — release.sh refuses to sweep a peer's edit into the bump commit.
#
# 2026-11-26: the session-bridge 0.4.0 release ran for minutes after its clean-tree check, a peer
# session edited README.md meanwhile, and `git add README.md` staged the peer's sdd row into the
# release commit. release.sh now re-checks README.md and the version files right before the bump.
#
# The release runs in a scratch clone with a fake HOME (no profile, no Codex, no Copilot), so the
# real checkout and the real profiles are never touched. The "peer edit" is made by a replaced
# scripts/gen-local-instructions.sh, which release.sh runs after its step-0 check.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── release-guard ──"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$(mktemp -d)"
trap 'rm -rf "$H"' EXIT
mkdir -p "$H/home"

make_clone() {
  rm -rf "$H/repo"
  git clone -q --no-hardlinks "$ROOT" "$H/repo" || return 1
  cp "$ROOT/scripts/release.sh" "$H/repo/scripts/release.sh"
  git -C "$H/repo" config user.email t@example.com; git -C "$H/repo" config user.name t
  git -C "$H/repo" commit -qam "test: the release.sh under test" 2>/dev/null || true
}
release() { (cd "$H/repo" && HOME="$H/home" SKIP_TESTS=1 NO_PUSH=1 ./scripts/release.sh sdd patch 2>&1); }

# --- a peer edits README.md after the pre-flight check ---
make_clone || { fail "fixture: scratch clone" "git clone failed"; print_summary "release-guard"; exit 1; }
printf '#!/bin/bash\necho "peer edit" >> README.md\n' > "$H/repo/scripts/gen-local-instructions.sh"
git -C "$H/repo" commit -qam "test: a peer edits README.md during the run"
before="$(git -C "$H/repo" rev-parse HEAD)"; ver="$(jq -r .version "$H/repo/sdd/.claude-plugin/plugin.json")"
out="$(release)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "README.md changed since the pre-flight check" \
  && pass "a README.md edit made after the pre-flight check stops the release" \
  || fail "a README.md edit made after the pre-flight check stops the release" "rc=$rc $out"
[ "$(git -C "$H/repo" rev-parse HEAD)" = "$before" ] && [ "$(jq -r .version "$H/repo/sdd/.claude-plugin/plugin.json")" = "$ver" ] \
  && pass "the refused release leaves no bump commit and no bumped version" \
  || fail "the refused release leaves no bump commit and no bumped version" "$(git -C "$H/repo" log --oneline -2)"

# --- control: no peer edit, the same release passes and stages only its own files ---
make_clone
printf '#!/bin/bash\nexit 0\n' > "$H/repo/scripts/gen-local-instructions.sh"
git -C "$H/repo" commit -qam "test: no peer edit"
out="$(release)"; rc=$?
[ "$rc" = 0 ] && git -C "$H/repo" log -1 --format=%s | grep -q "^chore: bump sdd to" \
  && pass "control: without a peer edit the release commits the bump" \
  || fail "control: without a peer edit the release commits the bump" "rc=$rc $(printf '%s' "$out" | tail -8)"
files="$(git -C "$H/repo" show --name-only --format= HEAD | sort | tr '\n' ' ')"
[ "$files" = "README.md sdd/.claude-plugin/plugin.json " ] && pass "control: the bump commit holds README.md and plugin.json only" \
  || fail "control: the bump commit holds README.md and plugin.json only" "$files"
nl="$(git -C "$H/repo" show --numstat --format= HEAD -- README.md | awk '{print $1 + $2}')"
[ "$nl" = 2 ] && pass "control: README.md changes one row" || fail "control: README.md changes one row" "changed lines: $nl"

print_summary "release-guard"
