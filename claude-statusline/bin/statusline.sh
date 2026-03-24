#!/usr/bin/env bash
# claude-statusline v1.0.0
# Claude Code status line — informative single-line display
# Reads JSON from stdin, outputs ANSI-colored status line to stdout

# No set -e: status line should degrade gracefully, not crash
export LC_NUMERIC=C

# -- Check jq --
if ! command -v jq &>/dev/null; then
  echo -e "\033[31m[statusline: jq not installed — run: sudo apt install jq]\033[0m"
  exit 0
fi

# -- Read stdin --
input=$(cat)

# -- Extract all fields in one jq call (one field per line) --
jq_out="$(echo "$input" | jq -r '
  (.model.display_name // ""),
  (.context_window.used_percentage // ""),
  (.context_window.context_window_size // ""),
  (.rate_limits.five_hour.used_percentage // ""),
  (.rate_limits.five_hour.resets_at // ""),
  (.rate_limits.seven_day.used_percentage // ""),
  (.rate_limits.seven_day.resets_at // ""),
  (.cost.total_cost_usd // 0),
  (.cost.total_duration_ms // 0),
  (.cost.total_lines_added // 0),
  (.cost.total_lines_removed // 0),
  (.context_window.current_usage.cache_creation_input_tokens // ""),
  (.context_window.current_usage.cache_read_input_tokens // ""),
  (.agent.name // ""),
  (.worktree.name // ""),
  (.worktree.branch // ""),
  "END"
' 2>/dev/null)" || exit 0

readarray -t F <<< "$jq_out"

# Bail if jq produced insufficient output (17 fields: 16 data + sentinel)
[[ ${#F[@]} -ge 17 ]] || exit 0

MODEL="${F[0]}"
CTX_PCT="${F[1]}"
CTX_SIZE="${F[2]}"
RATE_5H="${F[3]}"
RATE_5H_RESET="${F[4]}"
RATE_7D="${F[5]}"
RATE_7D_RESET="${F[6]}"
COST_USD="${F[7]}"
DURATION_MS="${F[8]}"
LINES_ADD="${F[9]}"
LINES_DEL="${F[10]}"
CACHE_CREATE="${F[11]}"
CACHE_READ="${F[12]}"
AGENT_NAME="${F[13]}"
WT_NAME="${F[14]}"
WT_BRANCH="${F[15]}"

# -- ANSI codes --
RST='\033[0m'
DIM='\033[90m'
WHITE='\033[97m'
BLUE='\033[38;5;75m'
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
MODEL_BG='\033[48;5;53m\033[38;5;177m'
AGENT_BG='\033[48;5;24m\033[38;5;75m'

# -- Truncate float to int --
int_pct() { local v=${1%.*}; echo "${v:-0}"; }

# -- Color threshold function --
color_pct() {
  local pct=$(int_pct "${1:-0}")
  if   (( pct >= 90 )); then printf '\033[31m'
  elif (( pct >= 70 )); then printf '\033[38;5;208m'
  elif (( pct >= 50 )); then printf '\033[33m'
  else                       printf '\033[32m'
  fi
}

# -- Format duration --
format_duration() {
  local ms=${1:-0}
  ms=${ms%.*}
  local secs=$(( ms / 1000 ))
  if (( secs < 60 )); then
    printf '%ds' "$secs"
  elif (( secs < 3600 )); then
    printf '%dm%ds' "$(( secs / 60 ))" "$(( secs % 60 ))"
  else
    printf '%dh%dm' "$(( secs / 3600 ))" "$(( (secs % 3600) / 60 ))"
  fi
}

# -- Format cache tokens in k units --
format_k() {
  local val=${1:-0}
  if [[ -z "$val" || "$val" == "0" ]]; then
    printf '0k'
    return
  fi
  if (( val >= 10000 )); then
    printf '%dk' "$(( val / 1000 ))"
  else
    local tenth=$(( (val * 10) / 1000 ))
    local whole=$(( tenth / 10 ))
    local frac=$(( tenth % 10 ))
    printf '%d.%dk' "$whole" "$frac"
  fi
}

# -- Format time remaining from unix timestamp --
format_remaining() {
  local reset_at=${1:-0}
  [[ -z "$reset_at" || "$reset_at" == "0" ]] && return
  local now=$(date +%s)
  local diff=$(( reset_at - now ))
  (( diff <= 0 )) && { printf 'now'; return; }
  local days=$(( diff / 86400 ))
  local hours=$(( (diff % 86400) / 3600 ))
  if (( days > 0 )); then
    printf '%dd%dh' "$days" "$hours"
  elif (( hours > 0 )); then
    printf '%dh' "$hours"
  else
    printf '%dm' "$(( diff / 60 ))"
  fi
}

# -- Separator --
SEP=" \\033[90m|\\033[0m "

# -- Build output --
out=""

# Model badge
if [[ -n "$MODEL" ]]; then
  out+="${MODEL_BG} ${MODEL} ${RST}"
else
  out+="${MODEL_BG} -- ${RST}"
fi

# Agent badge (conditional)
if [[ -n "$AGENT_NAME" ]]; then
  out+=" ${AGENT_BG} ${AGENT_NAME} ${RST}"
fi

# Context %
out+="${SEP}"
if [[ -n "$CTX_PCT" ]]; then
  ctx_int=$(int_pct "$CTX_PCT")
  c=$(color_pct "$ctx_int")
  out+="${DIM}ctx${RST} ${c}${ctx_int}%${RST}"
  if [[ -n "$CTX_SIZE" && "$CTX_SIZE" != "0" ]]; then
    ctx_used=$(( CTX_SIZE * ctx_int / 100 ))
    out+="${DIM}($(format_k "$ctx_used"))${RST}"
  fi
else
  out+="${DIM}ctx --${RST}"
fi

# Rate limits
rate_seg=""
if [[ -n "$RATE_5H" ]]; then
  r5_int=$(int_pct "$RATE_5H")
  c=$(color_pct "$r5_int")
  r5_remain=$(format_remaining "$RATE_5H_RESET")
  rate_seg+="${DIM}5h${RST} ${c}${r5_int}%${RST}"
  if [[ -n "$r5_remain" ]]; then
    rate_seg+="${DIM}(${r5_remain})${RST}"
  fi
fi
if [[ -n "$RATE_5H" && -n "$RATE_7D" ]]; then
  rate_seg+="${DIM}/${RST}"
fi
if [[ -n "$RATE_7D" ]]; then
  r7_int=$(int_pct "$RATE_7D")
  c=$(color_pct "$r7_int")
  r7_remain=$(format_remaining "$RATE_7D_RESET")
  rate_seg+="${DIM}7d${RST} ${c}${r7_int}%${RST}"
  if [[ -n "$r7_remain" ]]; then
    rate_seg+="${DIM}(${r7_remain})${RST}"
  fi
fi
if [[ -n "$rate_seg" ]]; then
  out+="${SEP}${rate_seg}"
fi

# Git branch / worktree
out+="${SEP}"
if [[ -n "$WT_NAME" ]]; then
  out+="${CYAN}wt:${RST}${BLUE}${WT_NAME}${RST}"
  if [[ -n "$WT_BRANCH" ]]; then
    out+=" ${DIM}on${RST} ${CYAN}${WT_BRANCH}${RST}"
  fi
else
  branch=$(git branch --show-current 2>/dev/null || true)
  if [[ -n "$branch" ]]; then
    out+="${BLUE}${branch}${RST}"
  else
    out+="${DIM}--${RST}"
  fi
fi

# Lines +/-
out+="${SEP}${GREEN}+${LINES_ADD}${RST} ${RED}-${LINES_DEL}${RST}"

# Right side
right=""

# Cache stats
if [[ -n "$CACHE_CREATE" || -n "$CACHE_READ" ]]; then
  c_create=$(format_k "${CACHE_CREATE:-0}")
  c_read=$(format_k "${CACHE_READ:-0}")
  right+="${DIM}cache${RST} ${GREEN}${c_create}${RST}${DIM}/${RST}${BLUE}${c_read}${RST}"
  right+="${SEP}"
fi

# Cost (always 2 decimal places)
right+="${DIM}\$${RST}${WHITE}$(printf '%.2f' "$COST_USD")${RST}"

# Duration
dur=$(format_duration "$DURATION_MS")
right+="${SEP}${DIM}${dur}${RST}"

# Final output
echo -e "${out}    ${right}"
