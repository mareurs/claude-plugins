"""Admit an inbox friction as a verified entry with the next FR-N, and print the commit to run.

    codescout box frictions admit <key>

The entry must be `inbox` and its body must hold the four evidence parts of the template in `docs/trackers/frictions/entry-template.md`:
`**Query:**`, `**Window:**`, `**Corpus:**` and `**Recovery sample:**` with at least five `- ` lines
under it. Otherwise the verb refuses and names every missing part.

It then sets `status: open`, `fr: FR-N` (one more than the highest `FR-N` held by any entry, in its
`fr` field or its first heading; `FR-1` for an empty collection) and puts `## FR-N — <title>` at
the top of the body, in one `doc(update)`. It reads the collection again afterwards: if another
entry holds the same number, this entry takes the next one (at most three tries, then it refuses
naming both entries).

The verb does not commit: the box commit step takes new files only. It prints the path and the two
commands to run: `git add -- <path>` and `git commit -m "..." -- <path>`.
A refusal prints `NOT DONE — <reason>` and exits 2.
"""
import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path

import codescout

# `python -P` keeps the script's folder off sys.path, so the shared helpers load by path.
_spec = importlib.util.spec_from_file_location(
    "frictions_note", Path(__file__).resolve().with_name("note.py")
)
note = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(note)

Refusal = note.Refusal
REFUSAL = note.REFUSAL
LABELS = ["**Query:**", "**Window:**", "**Corpus:**", "**Recovery sample:**"]
RECOVERY = "**Recovery sample:**"
MIN_RECOVERY_LINES = 5
MAX_TRIES = 3
FR_TOKEN = re.compile(r"FR-(\d+)")
FR_HEADING = re.compile(r"(?m)^## (FR-\d+) — ")
NEXT_LABEL = re.compile(r"^\*\*[^*\n]+:\*\*")
ANY_HEADING = re.compile(r"^#{1,6} ")
BULLET_WITH_TEXT = re.compile(r"\s*-\s+\S")


def tokens(entry):
    """The `FR-N` tokens an entry holds: its `fr` field and the first `## FR-N — ` heading."""
    found = []
    fr = (entry.get("extra") or {}).get("fr")
    if isinstance(fr, str) and FR_TOKEN.fullmatch(fr):
        found.append(fr)
    heading = FR_HEADING.search(entry.get("body") or "")
    if heading:
        found.append(heading.group(1))
    return found


def next_fr(entries):
    """`FR-N` with N one more than the highest number any entry holds; `FR-1` when none does."""
    highest = 0
    for entry in entries:
        for token in tokens(entry):
            highest = max(highest, int(FR_TOKEN.fullmatch(token).group(1)))
    return f"FR-{highest + 1}"


def missing_parts(body):
    """The evidence parts a body lacks.

    A label that is absent is named as it is (`**Query:**`); one with no text is named
    `**Query:** has no text`. Text counts when it follows the label on its line or comes in the lines
    before the next label or heading. `five recovery lines` is added when fewer than five `- ` lines
    with text after the dash follow `**Recovery sample:**` before the next label or heading.
    """
    lines = body.splitlines()
    missing = []
    for label in LABELS:
        index = next((i for i, line in enumerate(lines) if label in line), None)
        if index is None:
            missing.append(label)
        elif label != RECOVERY:  # its content is the bullet lines, counted below
            text = [lines[index].split(label, 1)[1]]
            for line in lines[index + 1 :]:
                if ANY_HEADING.match(line) or NEXT_LABEL.match(line):
                    break
                text.append(line)
            if not "".join(text).strip():
                missing.append(f"{label} has no text")
    start = next((i for i, line in enumerate(lines) if RECOVERY in line), None)
    count = 0
    if start is not None:
        for line in lines[start + 1 :]:
            if ANY_HEADING.match(line) or NEXT_LABEL.match(line):
                break
            if BULLET_WITH_TEXT.match(line):
                count += 1
    if count < MIN_RECOVERY_LINES:
        missing.append("five recovery lines")
    return missing


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal(f"bad arguments: {message}")


def key_of(row):
    """The entry key: the stem of the row's file (`abs_path`, else `rel_path`), else its `key`."""
    path = row.get("abs_path") or row.get("rel_path")
    return Path(path).stem if path else str(row.get("key") or "")


def entry_rows(root):
    prefix = codescout.box.dir().rstrip("/") + "/"
    rows = codescout.doc.find_iter(filter={"rel_path": {"contains": prefix}})
    return [r for r in rows if note.is_entry(r, root)]


def numbered_docs(root):
    """Every entry that can hold an `FR-N` (not `inbox`), read in full."""
    return [
        codescout.doc.get(id=note.ref_of(r), full=True)
        for r in entry_rows(root)
        if r.get("status") != "inbox"
    ]


def admit(argv):
    p = Parser(prog="codescout box frictions admit", add_help=False)
    p.add_argument("key")
    args = p.parse_args(argv)
    root = os.environ.get("CODESCOUT_PROJECT", "")

    rows = entry_rows(root)
    wanted = args.key.removesuffix(".md")
    target_row = next((r for r in rows if key_of(r) == wanted or note.ref_of(r) == wanted), None)
    if target_row is None:
        raise Refusal(f"no entry has the key {args.key}; run `codescout box frictions` to list them")
    target = codescout.doc.get(id=note.ref_of(target_row), full=True)
    key = key_of(target_row)
    if target.get("status") != "inbox":
        raise Refusal(f"{key} is {target.get('status')}, not inbox; only an inbox entry is admitted")
    gaps = missing_parts(target.get("body") or "")
    if gaps:
        raise Refusal(
            f"{key} lacks evidence: {', '.join(gaps)}. Add them (rule 1 and 2 of the readme) "
            "and run admit again"
        )

    docs = numbered_docs(root)
    fr = next_fr(docs)
    body = f"## {fr} — {target['title']}\n\n{target['body']}"
    patch = {"status": "open", "extra": {"fr": fr}, "body": body}
    tries = 0
    while True:
        tries += 1
        codescout.doc.update(id=note.ref_of(target), patch=patch)
        docs = numbered_docs(root)
        rivals = [d for d in docs if key_of(d) != key and fr in tokens(d)]
        if not rivals:
            break
        if tries == MAX_TRIES:
            rival = key_of(rivals[0])
            raise Refusal(
                f"{key} and {rival} both hold {fr} after {tries} tries; "
                "`codescout box frictions check` lists the clash, fix one number by hand"
            )
        fr = next_fr(docs)
        body = FR_HEADING.sub(f"## {fr} — ", body, count=1)
        patch = {"extra": {"fr": fr}, "body": body}

    path = note.relative(target_row, root)
    print(f"admitted {key} as {fr}")
    print(f"path: {path}")
    print("commit it with:")
    print(f"git add -- {path}")
    print(f'git commit -m "docs(frictions): {key} is {fr}" -- {path}')


def main(argv=None):
    try:
        admit(sys.argv[1:] if argv is None else argv)
    except Refusal as e:
        print(f"{REFUSAL}{e}")
        return 2
    except codescout.CodescoutError as e:
        print(f"{REFUSAL}codescout failed: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
