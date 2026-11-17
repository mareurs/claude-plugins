#!/usr/bin/env bash
# Stand-in for `claude` as the filter worker runs it. Records what it was given under
# $CLAUDE_CONFIG_DIR; behaviour is picked by marker files there:
#   fake-flood  write >64 KiB to stdout and to stderr BEFORE reading stdin, then record flood-done
#   fake-wait   after reading stdin, wait (at most 10 s) for a `go` file
#   fake-sleep  sleep past any timeout     fake-exit1  exit 1
#   fake-stdout print that file verbatim   (none)      print `not json`
# Refuses to run (exit 97, writes nothing) unless $CLAUDE_CONFIG_DIR holds `.sb-test-config`,
# so a test that leaks a real CLAUDE_CONFIG_DIR into this script cannot write into a profile.
if [ -z "$CLAUDE_CONFIG_DIR" ] || [ ! -e "$CLAUDE_CONFIG_DIR/.sb-test-config" ]; then
  echo "fake-filter.sh: refusing to run: CLAUDE_CONFIG_DIR is not a test config dir (no .sb-test-config)" >&2
  exit 97
fi
d="$CLAUDE_CONFIG_DIR"
echo call >> "$d/filter-calls"
{
  echo "pwd=$(pwd)"
  echo "config=$CLAUDE_CONFIG_DIR"
  echo "session=${CLAUDE_CODE_SESSION_ID-unset}"
  echo "socket=${CLAUDE_CODE_MESSAGING_SOCKET-unset}"
  echo "token=${CLAUDE_CODE_MESSAGING_TOKEN-unset}"
  echo "claudecode=${CLAUDECODE-unset}"
  echo "bridge_child=${SESSION_BRIDGE_CHILD-unset}"
} > "$d/filter-env.txt"
printf '%s\n' "$@" > "$d/filter-argv.txt"
if [ -e "$d/fake-flood" ]; then
  # A caller that writes all of stdin before it reads any output deadlocks here.
  head -c 200000 /dev/zero | tr '\0' 'x'
  head -c 200000 /dev/zero | tr '\0' 'e' >&2
  echo done > "$d/flood-done"
fi
cat > "$d/filter-stdin.txt"
if [ -e "$d/fake-wait" ]; then
  for _ in $(seq 1 100); do
    [ -e "$d/go" ] && break
    sleep 0.1
  done
fi
if [ -e "$d/fake-sleep" ]; then
  exec sleep 30
fi
if [ -e "$d/fake-exit1" ]; then
  echo 'boom' >&2
  exit 1
fi
if [ -e "$d/fake-stdout" ]; then
  cat "$d/fake-stdout"
  exit 0
fi
echo 'not json'
