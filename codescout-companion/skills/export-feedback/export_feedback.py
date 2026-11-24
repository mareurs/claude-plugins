#!/usr/bin/env python3
"""Export the boxes of this repository as one Markdown file, with identifying text redacted.

Usage:
    python3 export_feedback.py [--project DIR] [--box KEY ...] [--out FILE | --out -]

Reads every box through the codescout CLI (`box --json`, `box <key> list`,
`box <key> show`), so it needs no box-specific code and no folder paths.
Sends nothing. Writes one file (default: ~/codescout-feedback-<date>.md).

Privacy flag CS_PRIVACY:
    unset, on, 1, true, yes, any other value -> on  (redact; the default)
    off, 0, false, no                        -> off (export raw text)
The flag changes the export only. Recording is unchanged.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import date
from pathlib import Path

FALSE_VALUES = {"off", "0", "false", "no"}
TIMEOUT_S = 60

# Roots that mark a POSIX path as a file-system path (not a URL route such as /api/v1).
POSIX_ROOTS = "home|Users|root|tmp|var|opt|usr|etc|mnt|srv|media|Volumes|private|snap|nix|run"
SEG = r"[\w.@+<>-]+"
WIN_SEG = r"[^\\/\s'\"`<>|:*?]"

SECRET_WORD = (
    r"(?:password|passwd|secret|token|api[_-]?key|apikey|credentials?|"
    r"private[_-]?key|authorization|auth[_-]?token)"
)


def privacy_on() -> bool:
    """Return the mode named by CS_PRIVACY. Unset or unknown means on."""
    raw = os.environ.get("CS_PRIVACY")
    if raw is None:
        return True
    return raw.strip().lower() not in FALSE_VALUES


def _last_segment_path(text: str) -> str:
    """Keep only the file name of a path; a path that ends in a separator keeps nothing."""
    last = re.split(r"[\\/]", text)[-1]
    return "<path>/" + last if last else "<path>/"


# A tool directory directly under the home directory (~/.claude, ~/.codex) names no person
# or project, and it is often the subject of the feedback, so it stays as ~/<dir>/...
HOME_DOT_DIR = re.compile(r"^(?:~|/(?:home|Users)/[^/]+|/root)/(?=\.)")


def _redact_path(match: re.Match) -> str:
    """Return the replacement of one file-system path match."""
    text = match.group(0)
    home = HOME_DOT_DIR.match(text)
    if home:
        return "~/" + text[home.end():]
    return _last_segment_path(text)


class Redactor:
    """Replace identifying text. One instance counts the replacements by class."""

    def __init__(self, repo: Path, names: list[str]):
        self.counts: Counter = Counter()
        self.repo_forms = sorted({str(repo), str(repo.resolve())}, key=len, reverse=True)
        names = [n for n in names if n and len(n) >= 3]
        self.names_re = None
        if names:
            alts = "|".join(re.escape(n) for n in sorted(set(names), key=len, reverse=True))
            self.names_re = re.compile(r"(?i)(?<!\w)(?:" + alts + r")(?!\w)")

        flags = re.DOTALL | re.MULTILINE
        self.fence = re.compile(r"^[ \t]*```.*?^[ \t]*```[ \t]*$", flags)
        self.fence_open = re.compile(r"^[ \t]*```.*\Z", flags)
        # Claude Code names a project directory after its path: projects/-home-jane-work-app
        self.project_dir = re.compile(r"(?<=/projects/)-[\w.-]+")
        self.url_cred = re.compile(r"(\b[a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s@:]+(?::[^/\s@]*)?@")
        self.secret_kv = re.compile(
            r"(?i)\b([\w.-]{0,40}" + SECRET_WORD + r"[\w.-]{0,40})(\s*[:=]\s*)(['\"]?)([^\s'\",;`<>]{4,})"
        )
        self.jwt = re.compile(r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}")
        self.token = re.compile(
            r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}"
            r"|\bgithub_pat_[A-Za-z0-9_]{16,}|\bxox[abprs]-[A-Za-z0-9-]{10,}"
            r"|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}"
            r"|(?i:\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{12,}"
        )
        self.email = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        self.uuid = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
        self.win_path = re.compile(
            r"(?<![\w])[A-Za-z]:[\\/](?:" + WIN_SEG + r"+[\\/])*" + WIN_SEG + r"*"
        )
        self.tilde_path = re.compile(r"(?<![\w<>.:/~-])~(?:/" + SEG + r")+/?")
        self.posix_path = re.compile(
            r"(?<![\w<>.:/~-])/(?:" + POSIX_ROOTS + r")(?:/" + SEG + r")+/?"
        )
        octet = r"(?:25[0-5]|2[0-4]\d|1?\d?\d)"
        self.ipv4 = re.compile(r"\b(?:" + octet + r"\.){3}" + octet + r"\b")
        self.host = re.compile(
            r"(?i)\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:internal|corp|local|lan|intranet|home|private)\b"
        )

    def _sub(self, label: str, pattern: re.Pattern, repl, text: str) -> str:
        text, n = pattern.subn(repl, text)
        if n:
            self.counts[label] += n
        return text

    def __call__(self, text: str) -> str:
        # Order matters. The repository path goes first, before a name or a UUID inside it
        # can change it. Token shapes go before the key=value rule, which would otherwise
        # take the word "Bearer" as the value and leave the token behind.
        if not text:
            return text
        text = self._sub("code block", self.fence, "[code block omitted]", text)
        text = self._sub("code block", self.fence_open, "[code block omitted]", text)
        for form in self.repo_forms:
            n = text.count(form)
            if n:
                self.counts["path"] += n
                text = text.replace(form, "<repo>")
        text = self._sub("path", self.project_dir, "<project>", text)
        text = self._sub("credential", self.url_cred, r"\1<credentials>@", text)
        text = self._sub("secret", self.jwt, "<token>", text)
        text = self._sub("secret", self.token, "<token>", text)
        text = self._sub(
            "secret", self.secret_kv, lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}<secret>", text
        )
        text = self._sub("email", self.email, "<email>", text)
        text = self._sub("uuid", self.uuid, "<uuid>", text)
        if self.names_re:
            text = self._sub("name", self.names_re, "<user>", text)
        for rx in (self.win_path, self.tilde_path, self.posix_path):
            text = self._sub("path", rx, _redact_path, text)
        text = self._sub("network", self.ipv4, "<ip>", text)
        text = self._sub("network", self.host, "<host>", text)
        return text

    def summary(self) -> str:
        if not self.counts:
            return "nothing to redact"
        return ", ".join(f"{n} {label}" for label, n in sorted(self.counts.items()))


def identity(text: str) -> str:
    """Pass text through unchanged (privacy off)."""
    return text


def git_value(project: Path, key: str) -> str:
    """Return one `git config` value of the project, or an empty string."""
    try:
        return subprocess.run(
            ["git", "-C", str(project), "config", key],
            capture_output=True, text=True, timeout=TIMEOUT_S,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def identity_names(project: Path) -> list[str]:
    """Return the names that identify the person: login, home name, git display name and its parts."""
    names = [os.environ.get("USER", ""), os.environ.get("LOGNAME", ""), Path.home().name]
    full = git_value(project, "user.name")
    if full:
        names.append(full)
        names.extend(full.split())
    return names


class ExportError(Exception):
    """The export cannot read what it needs. The message names the fix."""


class CodescoutMissing(ExportError):
    """The codescout binary is not on PATH."""


def codescout_json(args: list[str], project: Path):
    """Run `codescout <args> --json` in the project. Return the parsed object, or None on failure."""
    try:
        proc = subprocess.run(
            ["codescout", *args, "--json"],
            cwd=str(project), capture_output=True, text=True, timeout=TIMEOUT_S,
        )
    except FileNotFoundError as exc:
        raise CodescoutMissing from exc
    except subprocess.SubprocessError:
        return None
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None


def read_box(key: str, project: Path):
    """Return (entries, failures) of one box. Each entry is the `show` object."""
    listing = codescout_json(["box", key, "list", "--all"], project)
    if not isinstance(listing, dict) or "entries" not in listing:
        return [], [f"box {key}: list failed"]
    entries, failures = [], []
    for item in listing["entries"]:
        shown = codescout_json(["box", key, "show", item["key"], "--full"], project)
        if isinstance(shown, dict) and "text" in shown:
            entries.append(shown)
        else:
            failures.append(f"box {key}: entry could not be read")
    return entries, failures


def render_entry(entry: dict, scrub) -> list[str]:
    """Render one entry: title, a status line, then the body."""
    meta = [f"status: {entry.get('status')}", f"kind: {entry.get('kind')}"]
    if entry.get("status_since"):
        meta.append(f"since: {entry['status_since']}")
    if entry.get("archived"):
        meta.append("archived")
    return [f"### {scrub(entry.get('title') or '(untitled)')}", "", " · ".join(meta), "",
            scrub((entry.get("text") or "").strip()), ""]


def build(project: Path, only: list[str], on: bool):
    """Return (markdown, entry count, box count, summary). Raise ExportError when nothing is readable."""
    index = codescout_json(["box"], project)
    if not isinstance(index, dict) or not index.get("collections"):
        raise ExportError(f"no boxes found in {project}. Run it inside a repository that has a codescout box.")
    boxes = [c["key"] for c in index["collections"]]
    if only:
        unknown = [k for k in only if k not in boxes]
        if unknown:
            raise ExportError(f"unknown box {', '.join(unknown)}. Boxes here: {', '.join(boxes)}.")
        boxes = [k for k in boxes if k in only]

    scrub = Redactor(project, identity_names(project)) if on else identity
    body, failures, total = [], [], 0
    for key in boxes:
        entries, failed = read_box(key, project)
        failures += failed
        total += len(entries)
        body += [f"## {key} ({len(entries)})", ""]
        for entry in entries:
            body += render_entry(entry, scrub)

    head = [
        "# Codescout feedback export",
        "",
        f"- Privacy: {'on' if on else 'off'}",
        f"- Generated: {date.today().isoformat()}",
        f"- Codescout: {index.get('version', '?')} ({index.get('os', '?')})",
        f"- Boxes: {', '.join(boxes)}",
    ]
    summary = scrub.summary() if on else "privacy off, nothing redacted"
    if on:
        head.append(f"- Redacted: {summary}")
    if failures:
        head.append(f"- Not read: {'; '.join(failures)}")
    return "\n".join(head + [""] + body), total, len(boxes), summary


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--project", type=Path, default=Path.cwd(), help="repository root (default: current directory)")
    parser.add_argument("--box", action="append", default=[], metavar="KEY", help="export only this box; repeatable")
    parser.add_argument("--out", default=None, help="output file, or - for stdout (default: ~/codescout-feedback-<date>.md)")
    args = parser.parse_args(argv)

    project = args.project.resolve()
    on = privacy_on()
    try:
        text, entries, boxes, summary = build(project, args.box, on)
    except CodescoutMissing:
        print("export-feedback: codescout is not on PATH. Install it or add it to PATH.", file=sys.stderr)
        return 2
    except ExportError as exc:
        print(f"export-feedback: {exc}", file=sys.stderr)
        return 2

    if args.out == "-":
        print(text)
        return 0
    out = Path(args.out) if args.out else Path.home() / f"codescout-feedback-{date.today().isoformat()}.md"
    out.write_text(text + "\n", encoding="utf-8")
    note = " Read it before you send it." if on else ""
    print(f"wrote {out}: {entries} entries from {boxes} boxes; {summary}.{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
