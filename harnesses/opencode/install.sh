#!/usr/bin/env bash
# install.sh — wire this repo's plugins into OpenCode (v2).
# Run from anywhere: paths resolve from this file, not from your CWD.
#
# usage: install.sh [--project] [--plugins a,b,…]     install (user level by default)
#        install.sh --check [--plugins a,b,…]         report, change nothing
#        install.sh --help
#
# Plugins: codescout-companion, sdd, legible, session-bridge (default: all four).
#
# What it does, per plugin:
#   plugin   symlinks harnesses/opencode/plugins/<plugin>.js into OpenCode's plugins/ dir
#   skills   symlinks each <plugin>/skills/<name>/ into OpenCode's skills/ dir
#   commands writes OpenCode commands into commands/: sdd's are RENDERED (the
#            ${CLAUDE_PLUGIN_ROOT} placeholder filled in, command names mapped to their
#            OpenCode spelling); the rest are symlinks
#
# What it does NOT do: edit your opencode.json. That file holds provider API keys on real
# machines, and a script rewriting it is how a setup guide becomes a data-loss story. The
# one config edit codescout-companion needs is printed instead, and `--check` tells you
# whether you did it.
#
# Skills go to OpenCode's own skills/ dir, NOT ~/.claude/skills: OpenCode reads that one
# too (measured on 2.1.3), and so does Claude Code, which already loads these skills from
# the plugin — linking them there would load every skill twice in Claude Code.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS="$REPO_DIR/harnesses/opencode"
ALL_PLUGINS="codescout-companion sdd legible session-bridge"

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
MODE="user"
PLUGINS="$ALL_PLUGINS"

die()   { echo "error: $*" >&2; exit 1; }
info()  { echo "  $*"; }
usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project) MODE="project" ;;
    --check)   MODE="check" ;;
    --plugins) shift; [ $# -gt 0 ] || die "--plugins needs a value"; PLUGINS="$(echo "$1" | tr ',' ' ')" ;;
    --plugins=*) PLUGINS="$(echo "${1#--plugins=}" | tr ',' ' ')" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
  shift
done
for p in $PLUGINS; do
  case " $ALL_PLUGINS " in *" $p "*) ;; *) die "unknown plugin: $p (known: $ALL_PLUGINS)" ;; esac
done

case "$MODE" in
  project) BASE="$PWD/.opencode" ;;
  *)       BASE="$CONFIG_DIR" ;;
esac

command -v node >/dev/null 2>&1 || die "'node' not found — the bridges spawn hooks with it"

# ── what each plugin installs ─────────────────────────────────────────────
skills_of() {
  case "$1" in
    codescout-companion) echo "$REPO_DIR/codescout-companion/skills" ;;
    sdd)                 echo "$REPO_DIR/sdd/skills" ;;
    legible)             echo "$REPO_DIR/legible/skills" ;;
    *)                   echo "" ;;
  esac
}
# "<source>|<installed name>|render|link"
commands_of() {
  case "$1" in
    codescout-companion) echo "$REPO_DIR/codescout-companion/commands/dashboard.md|codescout-dashboard.md|link" ;;
    sdd) echo "$HARNESS/commands/sdd-approve.md|sdd-approve.md|link"
         echo "$REPO_DIR/sdd/commands/review.md|sdd-review.md|render"
         echo "$REPO_DIR/sdd/commands/sdd-init.md|sdd-init.md|render" ;;
    legible) echo "$HARNESS/commands/legible-explain.md|legible-explain.md|link" ;;
    *) ;;
  esac
}

# OpenCode spelling of sdd's command names: OpenCode has a BUILT-IN /review, and a ':' is
# not allowed in a Windows filename, so the names are dashed (`sdd:approve.md` does load on
# Linux — measured — but would not install everywhere). sdd.js applies the same mapping to
# hook messages at runtime.
render_command() {
  sed -e "s#\${CLAUDE_PLUGIN_ROOT}#$REPO_DIR/sdd#g" \
      -e 's#/sdd:approve#/sdd-approve#g' \
      -e 's#/sdd:review#/sdd-review#g' \
      -e 's#`/review`#`/sdd-review`#g' \
      -e 's#^\# /review#\# /sdd-review#' \
      "$1"
}

link() { # src dest
  if [ -e "$2" ] || [ -L "$2" ]; then
    if [ ! -L "$2" ]; then
      if [ -d "$2" ]; then info "SKIP $2 — a real directory is there, not ours"; return 0; fi
      cp "$2" "$2.bak-$(date +%Y%m%d%H%M%S)"; info "backed up existing $2"
    fi
    rm "$2"
  fi
  ln -s "$1" "$2"
}

status_of() { # path → present | dangling | missing
  if [ -L "$1" ] && [ ! -e "$1" ]; then echo "DANGLING → $(readlink "$1")"
  elif [ -e "$1" ]; then echo "present"
  else echo "missing"; fi
}

# ── check mode ────────────────────────────────────────────────────────────
if [ "$MODE" = "check" ]; then
  echo "OpenCode wiring (config: $CONFIG_DIR, project: $PWD/.opencode)"
  bad=0
  for p in $PLUGINS; do
    echo "• $p"
    for b in "$CONFIG_DIR" "$PWD/.opencode"; do
      s="$(status_of "$b/plugins/$p.js")"
      [ "$s" = "missing" ] && continue
      info "plugin $b/plugins/$p.js: $s"; case "$s" in DANGLING*) bad=1 ;; esac
    done
    sd="$(skills_of "$p")"
    if [ -n "$sd" ]; then
      for d in "$sd"/*/; do
        n="$(basename "$d")"; s="$(status_of "$CONFIG_DIR/skills/$n")"
        [ "$s" = "present" ] || info "skill $n: $s"; case "$s" in DANGLING*|missing) bad=1 ;; esac
      done
    fi
    while IFS='|' read -r _src name _how; do
      [ -n "$name" ] || continue
      s="$(status_of "$CONFIG_DIR/commands/$name")"
      [ "$s" = "present" ] || info "command $name: $s"; case "$s" in DANGLING*|missing) bad=1 ;; esac
    done < <(commands_of "$p")
  done
  for f in "$PWD/opencode.json" "$CONFIG_DIR/opencode.json"; do
    [ -f "$f" ] || continue
    command -v jq >/dev/null 2>&1 || continue
    if jq -e '.mcp.servers.codescout' "$f" >/dev/null 2>&1; then
      info "codescout MCP registered in $f"
    else
      info "codescout MCP NOT registered in $f"
    fi
  done
  [ "$bad" -eq 0 ] && echo "all requested components present" || echo "some components missing or broken — re-run ./install.sh"
  exit "$bad"
fi

# ── install ───────────────────────────────────────────────────────────────
mkdir -p "$BASE/plugins" "$BASE/skills" "$BASE/commands"
for p in $PLUGINS; do
  src="$HARNESS/plugins/$p.js"
  [ -f "$src" ] || die "plugin source missing at $src (is this checkout intact?)"
  link "$src" "$BASE/plugins/$p.js"
  info "plugin   $p → $BASE/plugins/$p.js"
  sd="$(skills_of "$p")"
  if [ -n "$sd" ]; then
    for d in "$sd"/*/; do
      n="$(basename "$d")"
      link "${d%/}" "$BASE/skills/$n"
      info "skill    $n"
    done
  fi
  while IFS='|' read -r csrc name how; do
    [ -n "$name" ] || continue
    [ -f "$csrc" ] || die "command source missing at $csrc"
    if [ "$how" = "render" ]; then
      dest="$BASE/commands/$name"
      [ -L "$dest" ] && rm "$dest"
      render_command "$csrc" > "$dest"
      info "command  /${name%.md} (rendered from ${csrc#"$REPO_DIR"/})"
    else
      link "$csrc" "$BASE/commands/$name"
      info "command  /${name%.md}"
    fi
  done < <(commands_of "$p")
done
info "note: these are symlinks into $REPO_DIR — if you move the repo, re-run this installer."
info "      sdd's rendered commands are copies: re-run after editing sdd/commands/."

# ── the manual step: MCP registration (codescout-companion only) ──────────
case " $PLUGINS " in *" codescout-companion "*)
  REGISTERED="no"
  for f in "$PWD/opencode.json" "$CONFIG_DIR/opencode.json"; do
    [ -f "$f" ] || continue
    command -v jq >/dev/null 2>&1 || continue
    jq -e '.mcp.servers.codescout' "$f" >/dev/null 2>&1 && REGISTERED="yes"
  done
  if [ "$REGISTERED" = "no" ]; then
    cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUAL STEP — register the codescout MCP server

Add this to $CONFIG_DIR/opencode.json (or a project's opencode.json).
opencode exposes its tools as codescout_<tool>, which is what the bridge
matches on.

  "mcp": {
    "servers": {
      "codescout": {
        "type": "local",
        "command": ["codescout", "start", "--project", "."],
        "cwd": "."
      }
    }
  }

If your opencode.json has no "mcp" key yet, add the whole block above. If it
already has one, add only the "codescout" entry inside mcp.servers. Back the
file up first: cp $CONFIG_DIR/opencode.json $CONFIG_DIR/opencode.json.bak
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
  fi ;;
esac

echo
echo "done — restart opencode to load the plugins."
echo "If a background 'opencode serve --service' is running, restarting the TUI is NOT enough:"
echo "it keeps the old plugins cached. Stop it first:  pgrep -af 'opencode.*serve --service'  then kill <pid>"
echo "verify with: $0 --check"
