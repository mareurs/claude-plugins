#!/usr/bin/env python3
"""Writes the two prompts of the hold-ack probe. Deterministic: same bytes every run.

S  one short note (about 900 bytes of body): doing it inline is the right choice.
M  four notes (about 500 bytes each): several edits, so a scribe fork is the right choice.
"""
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

FACTS = [
    "The cache key is built from the request path and the query string, and it leaves out the locale header.",
    "Two users who ask for the same page in different languages therefore read each other's cached copy.",
    "The bug appears only behind the proxy, because the proxy strips Accept-Language before the cache layer reads it.",
    "A local run does not show it: the dev server sends the header straight through and the keys differ.",
    "The fix adds the resolved locale to the key and keeps the old key as a fallback read for one release.",
    "The regression test requests one page twice with two locales and asserts that the bodies differ.",
    "Cached entries written before the fix stay valid until their ttl ends, so no purge is needed.",
    "The metrics dashboard shows the hit rate dropping by about four percent after the key change, as expected.",
    "A follow-up should move the locale resolution before the cache layer, so the key never depends on a header.",
    "Until then the resolver must run first in the middleware chain, and a test pins that order.",
    "The rollout is behind a flag named cache_locale_key, off by default, with a one-line removal after two weeks.",
    "Owners: the web platform team. Reviewer: whoever holds the on-call rotation that week.",
]


def body(seed: int, size: int) -> str:
    parts, n = [], 0
    i = seed
    while n < size:
        s = FACTS[i % len(FACTS)]
        parts.append(s)
        n += len(s) + 1
        i += 1
    return "\n".join(parts)


S = f"""File one note in the project box. Run this command, with the body on stdin as a heredoc, then reply with the title only.

./boxw add --title 'Cache key omits the locale' --text body - <<'EOF'
{body(0, 900)}
EOF
"""

titles = ["Cache key omits the locale", "Proxy strips Accept-Language", "Dev server hides the bug", "Locale resolution should run first"]
blocks = []
for k, t in enumerate(titles):
    blocks.append(f"Note {k + 1}: ./boxw add --title '{t}' --text body - <<'EOF'\n{body(k * 3, 500)}\nEOF")
M = "File these four notes in the project box. Run one command per note, each with its body on stdin as a heredoc. When all four are filed, reply with the word done.\n\n" + "\n\n".join(blocks) + "\n"

open(os.path.join(out, "S.txt"), "w").write(S)
open(os.path.join(out, "M.txt"), "w").write(M)
print("S", len(S), "M", len(M))

# Task F: the content is on disk, in findings.md; a fork needs only a short brief.
secs = []
for k, t in enumerate(titles):
    secs.append(f"## {k + 1}. {t}\n\n{body(k * 3, 600)}\n")
open(os.path.join(out, "findings.md"), "w").write("# Findings\n\n" + "\n".join(secs))
F = ("The four findings of this investigation are in findings.md in the working directory. "
     "File each of them as a note in the project box: run one `./boxw add --title '<the heading text>' --text body -` per finding, "
     "with the text under that heading on stdin. When all four are filed, reply with the word done.\n")
open(os.path.join(out, "F.txt"), "w").write(F)
print("F", len(F))
