#!/usr/bin/env bash
# session-bridge git hooks: shared functions.
# Sourced by `prepare-commit-msg` and `pre-push`. Defines functions and variables only;
# it changes no state at source time.
#
# Every setting is an environment variable with a default. A repository sets none of them
# unless it needs a different value.
#
#   SESSION_BRIDGE_IDENTITY_CMD     A command that prints the session token of the caller, and
#                                   exits non-zero when the identity is in conflict. Default:
#                                   $CLAUDE_CODE_SESSION_ID, then $AGENT_SESSION_ID.
#   SESSION_BRIDGE_TRAILER          The commit trailer that names the author session.
#                                   Default: Session-Id.
#   SESSION_BRIDGE_COAUTHOR_TRAILER The trailer that names other sessions that wrote part of a
#                                   commit. The push guard reads it for holds only.
#                                   Default: Co-Authored-Session-Id.
#   SESSION_BRIDGE_ACK_VARS         Space-separated names of the variables that carry a push
#                                   ack. The guard joins their values. Default:
#                                   SESSION_BRIDGE_PUSH_ACK.
#   SESSION_BRIDGE_HOLD_NS          The ref namespace of publish holds. Default: refs/holds.
#
# Tokens. A token is an opaque string. A token `<harness>:<id>` has a hold ref under
# `<HOLD_NS>/_<harness>/<id>`. A bare token has one under `<HOLD_NS>/<id>`.

# session-bridge-git-hook
SBG_TRAILER="${SESSION_BRIDGE_TRAILER:-Session-Id}"
SBG_COAUTHOR_TRAILER="${SESSION_BRIDGE_COAUTHOR_TRAILER:-Co-Authored-Session-Id}"
SBG_HOLD_NS="${SESSION_BRIDGE_HOLD_NS:-refs/holds}"
SBG_ACK_VARS="${SESSION_BRIDGE_ACK_VARS:-SESSION_BRIDGE_PUSH_ACK}"

# Print the caller's session token, or nothing when there is none (a person at a terminal).
# Return the identity command's exit code when it fails: a conflict is not "no identity".
sbg_identity() {
    local out rc=0
    if [ -n "${SESSION_BRIDGE_IDENTITY_CMD:-}" ]; then
        out="$(bash -c "$SESSION_BRIDGE_IDENTITY_CMD" </dev/null)" || rc=$?
        [ "$rc" -eq 0 ] || return "$rc"
    else
        out="${CLAUDE_CODE_SESSION_ID:-${AGENT_SESSION_ID:-}}"
    fi
    out="${out%%$'\n'*}"
    out="${out//[[:space:]]/}"
    printf '%s\n' "$out"
}

# Lower-case a string and drop all whitespace.
sbg_norm() {
    printf '%s' "${1:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]'
}

# Print the values of every variable named in SESSION_BRIDGE_ACK_VARS, joined with commas.
sbg_collect_ack() {
    local name val out=""
    for name in $SBG_ACK_VARS; do
        case "$name" in '' | *[!A-Za-z0-9_]*) continue ;; esac
        val="${!name:-}"
        [ -n "$val" ] || continue
        out="${out:+$out,}$val"
    done
    printf '%s\n' "$out"
}

# Print the hold ref of a token. Return 1 for a token that cannot name a ref.
sbg_hold_ref() {
    local tok="${1:-}" harness="" id
    case "$tok" in
        *:*) harness="${tok%%:*}"; id="${tok#*:}" ;;
        *) id="$tok" ;;
    esac
    case "$id" in '' | *[!A-Za-z0-9-]*) return 1 ;; esac
    if [ -n "$harness" ]; then
        case "$harness" in *[!a-z0-9-]*) return 1 ;; esac
        printf '%s/_%s/%s\n' "$SBG_HOLD_NS" "$harness" "$id"
    else
        printf '%s/%s\n' "$SBG_HOLD_NS" "$id"
    fi
}

# State of one ref: prints `held`, `absent` or `error`. `show-ref --exists` separates a
# missing ref (2) from a lookup failure (1). An older git has no `--exists` (129): `rev-parse`
# stands in, and it cannot tell absence from a failure.
sbg_ref_state() {
    local rc=0
    git show-ref --exists "$1" >/dev/null 2>&1 </dev/null || rc=$?
    case "$rc" in
        0) echo held ;;
        2) echo absent ;;
        129)
            if git rev-parse -q --verify "$1" >/dev/null 2>&1 </dev/null; then echo held; else echo absent; fi
            ;;
        *) echo error ;;
    esac
}

# Whole seconds -> the largest unit that fits: 45s, 30m, 3h, 2d. Needs GNU `date -d`; it prints
# nothing and returns 1 when the date cannot be read, so the caller says "unknown time".
# Usage: sbg_age <UTC ISO-8601 time>
sbg_age() {
    local iso="${1:-}" t0 now d
    [ -n "$iso" ] || return 1
    t0="$(date -u -d "$iso" +%s 2>/dev/null </dev/null)" || return 1
    now="$(date -u +%s)"
    d=$((now - t0))
    [ "$d" -ge 0 ] || d=0
    if [ "$d" -lt 60 ]; then printf '%ss\n' "$d"
    elif [ "$d" -lt 3600 ]; then printf '%sm\n' $((d / 60))
    elif [ "$d" -lt 86400 ]; then printf '%sh\n' $((d / 3600))
    else printf '%sd\n' $((d / 86400))
    fi
}

# What a hold says about itself, on one line, or nothing. A hold ref that points at a BLOB with
# `reason: <text>` and `set-at: <UTC ISO-8601>` lines (the format codescout's hold-publish.sh
# writes) gives `held for 3h, reason: waiting`. A hold that points at a commit, as
# `git update-ref <ref> HEAD` makes it, says nothing: it carries neither.
# The reason was written by another session and goes to the terminal of this one, so control
# characters are dropped and the length is capped.
# Usage: sbg_hold_detail <ref>
sbg_hold_detail() {
    local ref="${1:-}" body at reason age
    [ "$(git cat-file -t "$ref" 2>/dev/null </dev/null)" = blob ] || return 0
    body="$(git cat-file -p "$ref" 2>/dev/null </dev/null)" || return 0
    at="$(printf '%s\n' "$body" | sed -n 's/^set-at: //p' | sed -n 1p)"
    reason="$(printf '%s\n' "$body" | sed -n 's/^reason: //p' | sed -n 1p | tr -d '[:cntrl:]' | cut -c1-200)"
    age="$(sbg_age "$at")" || age=""
    printf 'held for %s' "${age:-unknown time}"
    [ -n "$reason" ] && printf ', reason: %s' "$reason"
    printf '\n'
}
