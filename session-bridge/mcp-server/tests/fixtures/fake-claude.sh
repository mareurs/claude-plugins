#!/usr/bin/env bash
# Stand-in for `claude`. Records what it was given under $CLAUDE_CONFIG_DIR, prints a canned result.
# Refuses to run (exit 97, writes nothing) unless $CLAUDE_CONFIG_DIR holds `.sb-test-config`,
# so a regression that lets it inherit a real CLAUDE_CONFIG_DIR cannot write into a profile.
if [ -z "$CLAUDE_CONFIG_DIR" ] || [ ! -e "$CLAUDE_CONFIG_DIR/.sb-test-config" ]; then
  echo "fake-claude.sh: refusing to run: CLAUDE_CONFIG_DIR is not a test config dir (no .sb-test-config)" >&2
  exit 97
fi
out="$CLAUDE_CONFIG_DIR/fake-out.txt"
{
  echo "pwd=$(pwd)"
  echo "config=$CLAUDE_CONFIG_DIR"
  echo "session=${CLAUDE_CODE_SESSION_ID-unset}"
  echo "socket=${CLAUDE_CODE_MESSAGING_SOCKET-unset}"
  echo "token=${CLAUDE_CODE_MESSAGING_TOKEN-unset}"
  echo "claudecode=${CLAUDECODE-unset}"
  echo "bridge_child=${SESSION_BRIDGE_CHILD-unset}"
  echo "argv=$*"
} > "$out"
echo $$ > "$CLAUDE_CONFIG_DIR/fake-pid"
if [ -e "$CLAUDE_CONFIG_DIR/fake-sleep" ]; then
  exec sleep 5
fi
if [ -e "$CLAUDE_CONFIG_DIR/fake-garbage" ]; then
  echo 'this is not json'
  exit 0
fi
if [ -e "$CLAUDE_CONFIG_DIR/fake-nocost" ]; then
  echo '{"type":"result","is_error":false,"result":"x","usage":{}}'
  exit 0
fi
echo '{"type":"result","is_error":false,"result":"canned answer","total_cost_usd":0.02,"usage":{"cache_read_input_tokens":1000,"cache_creation_input_tokens":50}}'
