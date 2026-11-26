---
name: export-feedback
description: Use when the user wants to export, share or send the entries of the codescout boxes (frictions, bugs, recon, any box) to the codescout maintainers, or asks what such an export would reveal. Writes one redacted Markdown file and sends nothing.
---

# Export feedback

Write every box of this repository as one Markdown file. With privacy on, the file has no paths, names, e-mail addresses, secrets or code blocks. The skill sends nothing: the person reads the file and sends it. In a repository with no box, the `codescout box` call that the export makes first creates the box skeleton and prints what it made on stderr; the export then has nothing to read.

## Run

Use the helper next to this skill (its directory is the "Base directory for this skill" path printed when the skill loaded):

```bash
python3 "<skill-dir>/export_feedback.py" [--box KEY ...] [--out FILE]
```

- No `--box`: every box. `--box frictions --box recon`: only those.
- No `--out`: the file is `~/codescout-feedback-<date>.md`. `--out -` prints to stdout; do not, it costs context.
- The run prints one line: the path, the entry count and the redactions made. Show that line to the person.

## Privacy

Privacy is on unless the file `codescout-companion-privacy-off` exists in the profile directory (`$CLAUDE_CONFIG_DIR`, default `~/.claude`, or `$CODEX_HOME`, default `~/.codex`). The file changes the export only; recording is unchanged. `touch` it to export raw text, `rm` it to redact again. On the maintainer's machine it exists.

Redaction is a list of known patterns, not a guarantee. Tell the person to read the file before sending it, and offer to open it. A secret in free text that matches no pattern stays in the file.

## Failures

Exit 2 means nothing was written. The message names the fix: codescout not on PATH, no box in this directory, or an unknown `--box` key with the keys that exist.
