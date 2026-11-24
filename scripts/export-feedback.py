#!/usr/bin/env python3
"""Export codescout feedback (recon entries, frictions, pika observations) as Markdown.

Usage:
    python3 scripts/export-feedback.py [--repo DIR] [--usage-db FILE] [--out FILE]

Privacy flag (environment variable CS_PRIVACY):
    unset, on, 1, true, yes  -> on  (default; redact before export)
    off, 0, false, no        -> off (export raw text)
    any other value          -> on  (fail safe)

Privacy only affects this export. Recording is unchanged: the boxes and the
usage database keep their full text. With privacy on, the export:
  - replaces the repository path, the home directory and the login name;
  - replaces e-mail addresses, UUIDs and token-like strings;
  - replaces fenced code blocks with a marker;
  - leaves out the raw tool input and output (input_json, output_json)
    and the Claude Code session ids, which the pika query never selects.

Nothing is sent anywhere. The script only writes the file you name (or stdout).
"""

import argparse
import getpass
import os
import re
import sqlite3
import subprocess
import sys
from datetime import date
from pathlib import Path

FALSE_VALUES = {"off", "0", "false", "no"}

RECON_DIR = Path("docs/trackers/streams/recon")
FRICTION_DIR = Path("docs/trackers/ledgers/frictions")
SKIP_NAMES = {"readme.md", "entry-template.md"}

PIKA_SQL = """
SELECT o.kind, o.subkind, o.predicate, o.verdict, o.severity, o.recurrence,
       o.notes, t.tool_name, t.called_at, t.outcome, t.err_family, t.friction_target
FROM pika_observations o
JOIN tool_calls t ON t.id = o.tool_call_id
ORDER BY o.id
"""


def privacy_on() -> bool:
    """Return the privacy mode named by CS_PRIVACY. Unset or unknown means on."""
    raw = os.environ.get("CS_PRIVACY")
    if raw is None:
        return True
    return raw.strip().lower() not in FALSE_VALUES


def detect_repo() -> Path:
    """Return the git top level of the working directory, or the directory itself."""
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(top)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


class Redactor:
    """Replace identifying text. Built once, applied to every exported string."""

    UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
    EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
    TOKEN = re.compile(r"\b(?:sk|ghp|gho|ghu|ghs|xox[abprs]|AKIA)[-_A-Za-z0-9]{12,}")
    BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
    FENCE = re.compile(r"^```.*?^```", re.DOTALL | re.MULTILINE)
    HOME = re.compile(r"/home/[^/\s'\"`)]+|/Users/[^/\s'\"`)]+|[A-Za-z]:\\\\Users\\\\[^\\\s'\"`)]+")

    def __init__(self, repo: Path, login: str):
        self.repo = str(repo.resolve())
        self.login = login
        self.login_re = re.compile(r"\b" + re.escape(login) + r"\b") if len(login) >= 3 else None

    def __call__(self, text: str) -> str:
        if not text:
            return text
        text = self.FENCE.sub("[code block omitted]", text)
        text = text.replace(self.repo, "<repo>")
        text = self.HOME.sub("<home>", text)
        if self.login_re:
            text = self.login_re.sub("<user>", text)
        text = self.EMAIL.sub("<email>", text)
        text = self.UUID.sub("<uuid>", text)
        text = self.TOKEN.sub("<token>", text)
        text = self.BEARER.sub("Bearer <token>", text)
        return text


def identity(text: str) -> str:
    """Pass text through unchanged (privacy off)."""
    return text


def md_files(folder: Path) -> list[Path]:
    """Return the entry files of a box folder, without its readme and template."""
    if not folder.is_dir():
        return []
    return sorted(
        p for p in folder.glob("*.md")
        if p.name.lower() not in SKIP_NAMES and "template" not in p.name.lower()
    )


def section_files(title: str, folder: Path, scrub) -> list[str]:
    """Render one section that holds the entry files of a box folder."""
    out = [f"## {title}", ""]
    files = md_files(folder)
    if not files:
        out += [f"No entries in `{folder.as_posix()}`.", ""]
        return out
    for path in files:
        out += [f"### {path.name}", "", scrub(path.read_text(encoding="utf-8")).rstrip(), ""]
    return out


def pika_section(usage_db: Path, scrub) -> list[str]:
    """Render the pika observations, with only the fields the export allows."""
    out = ["## Pika observations", ""]
    if not usage_db.is_file():
        out += [f"No usage database at `{usage_db}`.", ""]
        return out
    con = sqlite3.connect(f"file:{usage_db}?mode=ro", uri=True)
    try:
        has_table = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pika_observations'"
        ).fetchone()
        if not has_table:
            out += ["The usage database has no `pika_observations` table.", ""]
            return out
        rows = con.execute(PIKA_SQL).fetchall()
    finally:
        con.close()
    if not rows:
        out += ["No pika observations.", ""]
        return out
    cols = ["kind", "subkind", "predicate", "verdict", "severity", "recurrence",
            "notes", "tool_name", "called_at", "outcome", "err_family", "friction_target"]
    out += ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for row in rows:
        cells = [scrub("" if v is None else str(v)).replace("|", "\\|").replace("\n", " ") for v in row]
        out.append("| " + " | ".join(cells) + " |")
    out.append("")
    return out


def build(repo: Path, usage_db: Path, on: bool) -> str:
    """Build the whole export as one Markdown string."""
    if on:
        login = os.environ.get("USER") or os.environ.get("LOGNAME") or getpass.getuser()
        scrub = Redactor(repo, login)
    else:
        scrub = identity
    lines = [
        "# Codescout feedback export",
        "",
        f"Privacy: {'on' if on else 'off'}",
        f"Generated: {date.today().isoformat()}",
        "",
    ]
    lines += section_files("Recon entries", repo / RECON_DIR, scrub)
    lines += section_files("Friction entries", repo / FRICTION_DIR, scrub)
    lines += pika_section(usage_db, scrub)
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--repo", type=Path, help="repository root (default: git top level)")
    parser.add_argument("--usage-db", type=Path, help="codescout usage database (default: <repo>/.codescout/usage.db)")
    parser.add_argument("--out", type=Path, help="output file (default: stdout)")
    args = parser.parse_args(argv)

    repo = (args.repo or detect_repo()).resolve()
    usage_db = args.usage_db or (repo / ".codescout" / "usage.db")
    text = build(repo, usage_db, privacy_on())
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
