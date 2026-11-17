#!/usr/bin/env bash
# Install the session-bridge git hooks into a repository.
#
#   install.sh [--repo DIR] [--force]    copy the three files into DIR's hooks directory
#   install.sh [--repo DIR] --check      report OK, MISSING or DIFFERS for each file; exit 1 if any is not OK
#
# The hooks directory is the one git uses (`git rev-parse --git-path hooks`), so
# `core.hooksPath` is honoured. The hooks find their library next to themselves, so the three
# files must stay together.
#
# The installer never overwrites a hook that it did not install. A file that differs and does
# not carry the `session-bridge-git-hook` marker is a hook of another tool: the installer
# lists it, writes nothing, and exits 1. `--force` overwrites it.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="."
check=0
force=0
while [ $# -gt 0 ]; do
    case "$1" in
        --repo) repo="${2:-}"; shift 2 ;;
        --check) check=1; shift ;;
        --force) force=1; shift ;;
        -h | --help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "install.sh: unknown argument: $1" >&2; exit 2 ;;
    esac
done
[ -n "$repo" ] || { echo "install.sh: --repo needs a directory" >&2; exit 2; }

hooks="$(git -C "$repo" rev-parse --path-format=absolute --git-path hooks 2>/dev/null)" \
    || { echo "install.sh: $repo is not a git repository" >&2; exit 2; }

files="prepare-commit-msg pre-push session-bridge-lib.sh"
mode_of() { case "$1" in session-bridge-lib.sh) echo 644 ;; *) echo 755 ;; esac; }

if [ "$check" -eq 1 ]; then
    bad=0
    for f in $files; do
        if [ ! -e "$hooks/$f" ]; then
            echo "MISSING $f"; bad=1
        elif ! cmp -s "$here/$f" "$hooks/$f"; then
            echo "DIFFERS $f"; bad=1
        elif [ "$(mode_of "$f")" = 755 ] && [ ! -x "$hooks/$f" ]; then
            echo "NOT-EXECUTABLE $f"; bad=1
        else
            echo "OK $f"
        fi
    done
    exit "$bad"
fi

conflicts=""
for f in $files; do
    dest="$hooks/$f"
    [ -e "$dest" ] || continue
    cmp -s "$here/$f" "$dest" && continue
    if [ "$force" -eq 0 ] && ! grep -q 'session-bridge-git-hook' "$dest"; then
        conflicts="${conflicts}  $dest"$'\n'
    fi
done
if [ -n "$conflicts" ]; then
    {
        echo "install.sh: refused. These files exist and are not session-bridge hooks:"
        printf '%s' "$conflicts"
        echo "Nothing was written. Merge by hand, or run again with --force to overwrite."
    } >&2
    exit 1
fi

mkdir -p "$hooks"
for f in $files; do
    cp "$here/$f" "$hooks/$f" && chmod "$(mode_of "$f")" "$hooks/$f" || { echo "install.sh: could not write $hooks/$f" >&2; exit 1; }
    echo "installed $hooks/$f"
done
