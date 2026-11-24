# export-feedback: one export for every box

Date: 2026-11-24. Size: small change. Approach A of three, chosen by the operator.

## Intent

The operator gives codescout to colleagues and wants their frictions and notes back, to improve codescout. A colleague must be able to send what the boxes hold without sending who they are, where they work or what they hold secret. The export must work for every box, present and future.

## Design

`codescout-companion/skills/export-feedback/export_feedback.py` reads boxes through the codescout CLI, not through files:

- `codescout box --json` gives the box keys (`collections`).
- `codescout box <key> list --all --json` gives the entries.
- `codescout box <key> show <entry> --full --json` gives the text.

It writes one Markdown file: per box, per entry, the title, status, kind, date and the body. It prints one line: the path, the counts, and the redactions made.

`CS_PRIVACY` decides the redaction. Unset, `on`, or an unknown value: redact. `off`, `0`, `false`, `no`: raw. The flag changes the export only. Recording is unchanged.

With privacy on, the export replaces:

- fenced code blocks (omitted);
- the repository path (`<repo>`); any other absolute or home path keeps only its file name, so project and organisation names go. A tool directory directly under home (`~/.claude`, `~/.codex`) keeps its name, because it names no person and is often the subject of the feedback;
- the encoded project directory of Claude Code (`projects/-home-jane-work-app`), which spells out a path;
- Windows, WSL, macOS and `~/` paths;
- e-mail addresses, UUIDs, JWTs, token prefixes, `key=value` secrets, credentials in URLs;
- IPv4 addresses and hosts under private top-level domains (`.internal`, `.corp`, `.local`, `.lan`, `.intranet`, `.home`, `.private`);
- the login name and the git display name.

Front matter is never exported (it holds session ids and the `log`). Raw tool input is never read.

## Approaches

- A. Script in the plugin that goes through the CLI. Chosen. Works with any box, survives folder moves and batched boxes, ships with the plugin.
- B. A native `codescout box <key> export` verb in the binary. Cleanest in the long run, but needs a binary release. The output format here is the contract it can take over.
- C. Glob every `kind: collection` readme. Cheaper, but breaks on moves and on batched boxes.

## Iron Law cost

- Simplicity: one source (boxes), one method (the CLI). The first version read two fixed folders and a SQLite table; this replaces it.
- Token economy: the skill is short, and the export goes to a file, not to the context.

## Limits

- Redaction is a blacklist. Free text may hold a name or a project secret it does not know. The operator or colleague reads the file before sending.
- Custom front-matter fields (for example `severity`) are not in `show --json`, so they are not exported.
- The raw `pika_observations` table is no longer exported. A pika lesson that matters is filed with `codescout box frictions note`.
- Text already committed to git stays in git history.
