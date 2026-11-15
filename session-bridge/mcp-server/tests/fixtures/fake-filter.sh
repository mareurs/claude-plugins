#!/usr/bin/env bash
# Stand-in for `claude` as the filter worker runs it. Records what it was given under
# $CLAUDE_CONFIG_DIR; behaviour is picked by marker files there:
#   fake-sleep  sleep past any timeout     fake-exit1  exit 1
#   fake-stdout print that file verbatim   (none)      print `not json`
d="$CLAUDE_CONFIG_DIR"
echo call >> "$d/filter-calls"
{
  echo "pwd=$(pwd)"
  echo "config=$CLAUDE_CONFIG_DIR"
  echo "session=${CLAUDE_CODE_SESSION_ID-unset}"
  echo "socket=${CLAUDE_CODE_MESSAGING_SOCKET-unset}"
  echo "token=${CLAUDE_CODE_MESSAGING_TOKEN-unset}"
  echo "claudecode=${CLAUDECODE-unset}"
} > "$d/filter-env.txt"
printf '%s\n' "$@" > "$d/filter-argv.txt"
cat > "$d/filter-stdin.txt"
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
