---
id: 229a16aa58a5f915
kind: bug
status: mitigated
title: "scripts/check-versions.sh working-tree copy drifted to CRLF, invisible to `git status`/`git diff`"
owners: []
tags:
- windows
- wsl
- crlf
- git-attributes
- scripts
topic: null
time_scope: null
---

## Summary

`scripts/check-versions.sh` failed under Ubuntu WSL with:

```
scripts/check-versions.sh: line 7: $'\r': command not found
: invalid option names.sh: line 8: set: pipefail
```

Classic CRLF-in-a-bash-script symptom. Surprising part: `.gitattributes` already
declares `*.sh text eol=lf` (line 1-2, with a comment explicitly warning about
this exact failure mode), and `git check-attr eol -- scripts/check-versions.sh`
correctly reports `eol: lf`. Yet `git ls-files --eol` showed:

```
i/lf    w/lf    attr/text eol=lf   scripts/bump-cache.sh          (every other .sh file)
i/lf    w/crlf  attr/text eol=lf   scripts/check-versions.sh      (this one, alone)
```

So this was **not** a systemic `.gitattributes`/`core.autocrlf` failure — every
other shell script in the repo was correctly LF on disk. Only this one file's
**working-tree copy** had drifted to CRLF while the git index/blob stayed LF.

**The dangerous part: `git status --short` and `git diff` both showed nothing —
a fully "clean" tree.** Git's diff/status machinery normalizes CRLF↔LF before
comparing when the `eol` attribute is set, so a CRLF-drifted working file looks
identical to its LF index entry from git's point of view. The drift is silent;
only actually *executing* the script (or `git ls-files --eol`) surfaces it.

## Root cause (probable, not fully confirmed)

Root cause of the original drift is unconfirmed — most likely some Windows-side
tool/editor rewrote the file with CRLF outside of a git-aware write path at some
point after it was last checked out cleanly. Not reproduced from a fresh clone;
this was a single pre-existing working-tree file on one developer machine.

## Fix applied

```
Remove-Item scripts/check-versions.sh
git checkout -- scripts/check-versions.sh
```

Note `git checkout -- <path>` **alone was not sufficient** — git's checkout also
skips rewriting a file it considers unchanged (same CRLF/LF-normalized
comparison as `status`/`diff`), so the CRLF bytes survived a first
`git checkout --` attempt. Deleting the file first forces a real rewrite from
the LF-normalized index blob.

Verified via `git ls-files --eol` (now `i/lf w/lf`) and by re-running the
script successfully under Ubuntu WSL (`bash scripts/check-versions.sh` →
`All versions consistent.`).

## Follow-up ideas (not yet done)

- `git ls-files --eol` could be run as a cheap pre-flight/CI check across
  `*.sh`/`*.py`/`*.mjs`/`*.env` to catch a `w/crlf` drift on any
  `attr/text eol=lf` file before it ships — `check-versions.sh` itself already
  runs at the top of `release.sh`'s pre-flight; a line-ending check could ride
  along there.
- Consider whether `core.autocrlf=true` (set globally on this machine) is worth
  turning off for repos with strict `eol=lf` scripts, to remove one more way
  for a working-tree file to end up CRLF in the first place.
