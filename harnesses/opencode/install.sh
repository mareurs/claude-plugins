#!/usr/bin/env bash
# install.sh — wire this repo's plugins into OpenCode (v2).
# Run from anywhere: paths resolve from this file, not from your CWD.
#
# usage: install.sh [--project] [--plugins a,b,…|all]  install (user level by default)
#        install.sh --check [--plugins a,b,…|all]      report, change nothing
#        install.sh --help
#
# Plugins: codescout-companion sdd legible session-bridge (the default set), and
#          buddy statusline hint-echo (opt-in: name them, or --plugins all).
#
# What it does, per plugin:
#   plugin   symlinks harnesses/opencode/plugins/<plugin>.js into OpenCode's plugins/ dir
#            (the server part; statusline and hint-echo have none)
#   tui      symlinks the DIRECTORY harnesses/opencode/tui/<plugin>/ (holding tui.js) as
#            plugins/<plugin>-tui/: OpenCode loads a plugin dir's root tui.js as its TUI
#            part (buddy, statusline, hint-echo)
#   skills   symlinks each <plugin>/skills/<name>/ into OpenCode's skills/ dir
#   commands writes OpenCode commands into commands/: sdd's and buddy's are RENDERED (the
#            ${CLAUDE_PLUGIN_ROOT} placeholder filled in, command names mapped to their
#            dashed OpenCode spelling); the rest are symlinks
#   state    hint-echo: creates the advisory channel dir the bridges write to
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
ALL_PLUGINS="codescout-companion sdd legible session-bridge buddy statusline hint-echo"
# The default set is the four bridges that came before buddy, statusline and hint-echo. Those
# three are opt-in. buddy puts a node → Python run on the critical path of every tool call
# (up to 5 s) and of each session's first request (up to 15 s), in every session the service
# hosts, and needs Python with PyYAML. A user who re-runs a bare install.sh after a pull must
# not get that unasked, and a bare --check must keep passing on an existing 4-plugin install.
DEFAULT_PLUGINS="codescout-companion sdd legible session-bridge"

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
MODE="user"
PLUGINS="$DEFAULT_PLUGINS"

die()   { echo "error: $*" >&2; exit 1; }
info()  { echo "  $*"; }
usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }
HINT_ECHO_DIR="${OPENCODE_HINT_ECHO_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/opencode-hint-echo}"

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
case " $PLUGINS " in *" all "*) PLUGINS="$ALL_PLUGINS" ;; esac
for p in $PLUGINS; do
  case " $ALL_PLUGINS " in *" $p "*) ;; *) die "unknown plugin: $p (known: $ALL_PLUGINS)" ;; esac
done

case "$MODE" in
  project) BASE="$PWD/.opencode" ;;
  *)       BASE="$CONFIG_DIR" ;;
esac

command -v node >/dev/null 2>&1 || die "'node' not found — the bridges spawn hooks with it"
# buddy's launcher (buddy/hooks/run.mjs) runs the first of python3, python that works. Without
# PyYAML, buddy's SessionStart does nothing and says nothing (CLAUDE.md § buddy), so check it
# here, where someone is reading.
case " $PLUGINS " in *" buddy "*)
  py=""
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1; then py="$c"; break; fi
  done
  if [ -z "$py" ]; then
    echo "warning: no python3/python on PATH — buddy's hooks and statusline are Python and will do nothing" >&2
  elif ! "$py" -c 'import yaml' >/dev/null 2>&1; then
    echo "warning: $py has no PyYAML — buddy's SessionStart will do nothing, silently (pip install pyyaml)" >&2
  fi ;;
esac

# ── what each plugin installs ─────────────────────────────────────────────
skills_of() {
  case "$1" in
    codescout-companion) echo "$REPO_DIR/codescout-companion/skills" ;;
    sdd)                 echo "$REPO_DIR/sdd/skills" ;;
    legible)             echo "$REPO_DIR/legible/skills" ;;
    buddy)               echo "$REPO_DIR/buddy/skills" ;;
    *)                   echo "" ;;
  esac
}
# server part: harnesses/opencode/plugins/<p>.js, when the plugin has one
server_of() { if [ -f "$HARNESS/plugins/$1.js" ]; then echo "$HARNESS/plugins/$1.js"; fi; }
# TUI part: a directory with a root tui.js, when the plugin has one
tui_of() { if [ -f "$HARNESS/tui/$1/tui.js" ]; then echo "$HARNESS/tui/$1"; fi; }
# "<source>|<installed name>|render|link"
commands_of() {
  case "$1" in
    codescout-companion) echo "$REPO_DIR/codescout-companion/commands/dashboard.md|codescout-dashboard.md|link" ;;
    sdd) echo "$HARNESS/commands/sdd-approve.md|sdd-approve.md|link"
         echo "$REPO_DIR/sdd/commands/review.md|sdd-review.md|render"
         echo "$REPO_DIR/sdd/commands/sdd-init.md|sdd-init.md|render" ;;
    legible) echo "$HARNESS/commands/legible-explain.md|legible-explain.md|link" ;;
    # install/uninstall set up Claude Code's statusline; on OpenCode that is the TUI part.
    # status/legend are TUI commands (tui/buddy/tui.js): answered without the model, so they
    # do not interrupt a busy session. Installing them here too would shadow those names.
    buddy) for f in "$REPO_DIR"/buddy/commands/*.md; do
             n="$(basename "$f" .md)"
             case "$n" in install|uninstall|status|legend) continue ;; esac
             echo "$f|buddy-$n.md|render"
           done ;;
    *) ;;
  esac
}

# OpenCode spelling of sdd's command names: OpenCode has a BUILT-IN /review, and a ':' is
# not allowed in a Windows filename, so the names are dashed (`sdd:approve.md` does load on
# Linux — measured — but would not install everywhere). sdd.js applies the same mapping to
# hook messages at runtime.
render_command() { # src plugin
  if [ "${2:-sdd}" = "buddy" ]; then render_buddy_command "$1"; return; fi
  sed -e "s#\${CLAUDE_PLUGIN_ROOT}#$REPO_DIR/sdd#g" \
      -e 's#/sdd:approve#/sdd-approve#g' \
      -e 's#/sdd:review#/sdd-review#g' \
      -e 's#`/review`#`/sdd-review`#g' \
      -e 's#^\# /review#\# /sdd-review#' \
      "$1"
}

# buddy's commands: plugin root filled in, `/buddy:x` → `/buddy-x` (the same ':' rule as
# sdd), and the Claude-only `name: buddy:x` frontmatter key dropped (the file name is the
# command name). /buddy-summon gets one extra line: buddy's summon fast path
# (summon_bootstrap.py, run by the UserPromptSubmit hook) keys on a prompt that starts with
# `/buddy:summon <arg>`. OpenCode sends the expanded template as the user message, so the
# template's first body line IS that prompt, and plugins/buddy.js hands it to the hook.
render_buddy_command() {
  local summon=0
  [ "$(basename "$1")" = "summon.md" ] && summon=1
  sed -e "s#\${CLAUDE_PLUGIN_ROOT}#$REPO_DIR/buddy#g" \
      -e 's#/buddy:\([a-z]\)#/buddy-\1#g' \
      -e '1,6{/^name: /d;}' \
      "$1" |
  awk -v summon="$summon" '{ print } /^---[[:space:]]*$/ { fm++; if (summon && fm == 2) { print ""; print "/buddy:summon $ARGUMENTS" } }'
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
    found_server=0; found_tui=0
    for b in "$CONFIG_DIR" "$PWD/.opencode"; do
      for part in "$p.js" "$p-tui"; do
        s="$(status_of "$b/plugins/$part")"
        [ "$s" = "missing" ] && continue
        case "$part" in *.js) found_server=1 ;; *) found_tui=1 ;; esac
        info "plugin $b/plugins/$part: $s"; case "$s" in DANGLING*) bad=1 ;; esac
      done
    done
    if [ -n "$(server_of "$p")" ] && [ "$found_server" -eq 0 ]; then info "plugin $p.js: missing"; bad=1; fi
    if [ -n "$(tui_of "$p")" ] && [ "$found_tui" -eq 0 ]; then info "tui $p-tui/: missing"; bad=1; fi
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
  src="$(server_of "$p")"
  tui="$(tui_of "$p")"
  [ -n "$src$tui" ] || die "no OpenCode part for $p under $HARNESS (is this checkout intact?)"
  if [ -n "$src" ]; then
    link "$src" "$BASE/plugins/$p.js"
    info "plugin   $p → $BASE/plugins/$p.js"
  fi
  if [ -n "$tui" ]; then
    link "$tui" "$BASE/plugins/$p-tui"
    info "tui      $p → $BASE/plugins/$p-tui/"
  fi
  if [ "$p" = "buddy" ]; then
    # Earlier versions rendered status/legend as model commands; they are TUI commands now.
    # Remove only OUR rendered copies (they carry this checkout's buddy path).
    for n in status legend; do
      f="$BASE/commands/buddy-$n.md"
      if [ -f "$f" ] && [ ! -L "$f" ] && grep -qF "$REPO_DIR/buddy" "$f"; then
        rm "$f"; info "removed  /buddy-$n model command (now a TUI command)"
      fi
    done
  fi
  if [ "$p" = "hint-echo" ]; then
    # 0700: the advisories hold paths, commands and session ids (lib/host.mjs, hint-echo).
    mkdir -p "$HINT_ECHO_DIR" && chmod 700 "$HINT_ECHO_DIR"
    info "state    advisory channel $HINT_ECHO_DIR"
  fi
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
      render_command "$csrc" "$p" > "$dest"
      info "command  /${name%.md} (rendered from ${csrc#"$REPO_DIR"/})"
    else
      link "$csrc" "$BASE/commands/$name"
      info "command  /${name%.md}"
    fi
  done < <(commands_of "$p")
done
info "note: these are symlinks into $REPO_DIR — if you move the repo, re-run this installer."
info "      sdd's and buddy's rendered commands are copies: re-run after editing their commands/."

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
