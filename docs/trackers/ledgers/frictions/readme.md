---
kind: collection
title: Frictions
commit: new-entries
entry_kinds:
- friction
fields:
  severity:
    type: enum
    values:
    - low
    - med
    - high
  friction_kind:
    type: enum
    values:
    - wrong-guidance
    - misleading-output
    - gate-too-strict
    - gate-too-loose
    - param-confusion
    - missing-capability
    - silent-failure
    - discoverability
    - hint-ineffective
    - latency
    - other
  tool:
    type: scalar
  session:
    type: scalar
hot_cap: 12
initial_status: open
key_style: dated
owner: operator
stale_after: 30d
statuses:
  open: open
  fixing: open
  fixed-verified: terminal
  not-a-friction: terminal
  wontfix: terminal
  duplicate: terminal
template: issues
---

# Frictions

Measured places where an agent loses calls, work or trust to a hook, deny message, skill, mod or script of a plugin here. A friction of the codescout tools goes to the codescout repository's `frictions` box. Plan drift goes to the `recon` box.

## What counts as a friction

Count is not friction: a gate that the next call obeys is healthy teaching. File an entry when one of these holds, and say which:

- the agent repeats the same call after an error, needs three or more calls to recover, or never recovers;
- it routes around the surface it was meant to use (a native `Read`, `Grep` or `Bash` where a codescout tool was meant);
- the text is wrong or gives no hint, or the call succeeded but misled;
- it passes a parameter the tool does not declare;
- a hook or mod refuses what it should allow, or two surfaces disagree about one call;
- latency makes agents retry or give up.

## Statuses

- `open`: filed with evidence. `fixing`: the entry names the branch in progress.
- `fixed-verified`: re-measured after the fix, with the commit SHA.
- `not-a-friction`: the recovery is healthy. `wontfix`: says why. `duplicate`: names the other key.

## How to add

Run `codescout box frictions add --kind friction --title "<one line>" --text body -` and write the body from the template below. Start the title with the surface (`codescout-redirect`, `pre-tool-guard`). A fix cites its entry key in the commit message.

## Entry template

**What happened:** the call, the output, the number of calls lost. Quote the text verbatim.

**Evidence:** the session id, the transcript path or the command that reproduces it. Every number names its window and corpus.

**Recovery:** what the next calls were. Sample five rows or more when you claim a rate.

**Severity:** recovery cost. `low`: one call lost. `med`: three or more calls, or a wrong first choice. `high`: never recovered, or work lost.

**Fix:** where the change lives, and the re-measurement that closes it.
