"""Check the frictions collection: an FR-N held twice, an fr that disagrees with its heading, an open or fixing entry with no FR-N.

`codescout box frictions check` reports the findings of the collection, then runs this script. It
prints one line per finding and exits 1 when there is one, 0 when there is none (it prints nothing
then). Read-only: it writes nothing.

Findings (entry tags that differ only in spelling are reported by the core `check`, before this script):
  - one `FR-N` held by two entries, in the `fr` field or the first `## FR-N — ` heading;
  - an entry whose `fr` field and first-heading token differ;
  - an entry with status `open` or `fixing` and no `FR-N` in either place (`admit` gives it one);
  - a tag used by one entry that `## Known tags` does not list, and tags that differ only in
    spelling when one of them is listed there (both skipped when the template or its section is
    missing).
An `inbox`, `fixed-verified`, `wontfix`, `not-a-friction` or `duplicate` entry may have no `FR-N`:
an inbox entry that a fix closes at once never passes `admit`.
"""
import importlib.util
import os
import re
import sys
from pathlib import Path

import codescout

# `python -P` keeps the script's folder off sys.path, so the shared code loads by path.
_spec = importlib.util.spec_from_file_location(
    "frictions_admit", Path(__file__).resolve().with_name("admit.py")
)
admit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(admit)

REFUSAL = admit.REFUSAL
NEEDS_FR = {"open", "fixing"}


def field_of(doc):
    fr = (doc.get("extra") or {}).get("fr")
    return fr if isinstance(fr, str) and admit.FR_TOKEN.fullmatch(fr) else None


def heading_of(doc):
    match = admit.FR_HEADING.search(doc.get("body") or "")
    return match.group(1) if match else None


def findings(docs):
    found = []
    holders = {}
    for doc in docs:
        key = admit.key_of(doc)
        field, heading = field_of(doc), heading_of(doc)
        for token in {field, heading} - {None}:
            holders.setdefault(token, []).append(key)
        if field and heading and field != heading:
            found.append(f"{key}: the fr field says {field} but the heading says {heading}")
        if not field and not heading and doc.get("status") in NEEDS_FR:
            found.append(f"{key} is {doc.get('status')} and has no FR-N")
    for token, keys in sorted(holders.items(), key=lambda kv: int(kv[0][3:])):
        if len(keys) > 1:
            found.append(f"{token} is held by {' and '.join(sorted(keys))}")
    return found


def tag_key(tag):
    """What two spellings of one tag share: lower case, no `-`, `_` or `/`, one trailing `s` dropped.
    The core `check` uses the same key for the tags of the entries."""
    key = re.sub(r"[-_/]", "", tag.lower())
    return key[:-1] if key.endswith("s") and len(key) > 1 else key


def tag_findings(docs, known):
    """What the vocabulary adds to the core `check`: a tag used by one entry that `known` does not
    list, and tags that differ only in spelling when one of them is listed in `known`.

    `docs` are the entries read in full; `known` is `note.known_tags(root)`: None when the
    vocabulary is missing, which skips both findings. Entry tags that drift among themselves, with
    no listed tag among them, are a finding of `codescout box <key> check` itself, which runs before
    this script, so they are not reported twice.
    """
    if known is None:
        return []
    users = {}
    for doc in docs:
        for tag in dict.fromkeys(doc.get("tags") or []):
            users.setdefault(tag, []).append(admit.key_of(doc))
    groups = {}
    for tag in [*users, *known]:
        groups.setdefault(tag_key(tag), set()).add(tag)
    found = [
        "tags " + " and ".join(repr(s) for s in sorted(group)) + " differ only in spelling; keep one"
        for _, group in sorted(groups.items())
        if len(group) > 1 and group & set(known)
    ]
    found += [
        f"tag {tag!r} is used once, by {keys[0]}, and is not in Known tags ({admit.note.TEMPLATE_REL})"
        for tag, keys in sorted(users.items())
        if len(keys) == 1 and tag not in known
    ]
    return found


def main(argv=None):
    root = os.environ.get("CODESCOUT_PROJECT", "")
    try:
        docs = [
            codescout.doc.get(id=admit.note.ref_of(r), full=True) for r in admit.entry_rows(root)
        ]
        found = findings(docs) + tag_findings(docs, admit.note.known_tags(root))
    except codescout.CodescoutError as e:
        print(f"{REFUSAL}codescout failed: {e}")
        return 2
    for line in found:
        print(line)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
