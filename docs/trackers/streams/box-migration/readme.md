---
kind: collection
title: 'Migration to ledgers and boxes: frictions, lessons and residuals'
commit: new-entries
entry_kinds:
- friction
- win
- residual
exit_when: every entry is terminal
hot_cap: 12
initial_status: open
key_style: dated
owner: marius
stale_after: 30d
statuses:
  open: open
  done: terminal
  promoted: terminal
  dropped: terminal
template: worklog
template_version: 1
---

# Migration to ledgers and boxes: frictions, lessons and residuals

The log of one work stream. It ends: when every entry is terminal, the stream is archived whole.

## What goes here

- `friction`: something that cost a failed call, a retry or a wrong turn. Say what happened and what you did.
- `win`: a way of working that prevented a worse outcome. Say what would have happened without it.
- `residual`: work that this stream leaves undone.

## How an entry ends

- `done`: finished, and nothing is worth keeping.
- `promoted`: the lesson went to a box that lasts, or to a file. The entry names it in a `**Promoted to:**` line.
- `dropped`: nobody will act on it. The entry says why in one line.

A confirmed win stays `open` until it is promoted or dropped.

## Entry template

**What happened:** <one or two lines>

**What I did:** <the recovery, or the way of working>

**Worth keeping:** <the lesson in one line, or "nothing">
