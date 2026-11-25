#!/usr/bin/env python3
"""List live trackers over a size limit (tracker-hygiene D12, oversized-tracker).

usage: d12_sizes.py TRACKERS_DIR [--bytes 150000] [--entries 300]

Reads every `*.md` file directly in TRACKERS_DIR (the archive folder and any other
subfolder are skipped). An entry is a `## <PREFIX>-<number> — <title>` heading outside a
code fence; template headings (`## F-N — <title>`) do not count.
Prints one line per file over a limit: name, bytes, entries. Exit 1 when any file is
listed, 0 when none is, 2 on a usage error.
"""
import re
import sys
from pathlib import Path

HEADING = re.compile(r"^## [A-Za-z]+-\d+ — ")
FENCE = re.compile(r"^(`{3,}|~{3,})(.*)$")


def count_entries(text):
    n, fence = 0, None
    for line in text.split("\n"):
        fm = FENCE.match(line)
        if fence is None:
            if fm and "`" not in fm[2]:
                fence = fm[1]
                continue
        elif fm and fm[1][0] == fence[0] and len(fm[1]) >= len(fence) and not fm[2].strip():
            fence = None
            continue
        if fence is None and HEADING.match(line):
            n += 1
    return n


def main(argv):
    args, limits, i = [], {"--bytes": 150000, "--entries": 300}, 0
    while i < len(argv):
        if argv[i] in limits and i + 1 < len(argv):
            limits[argv[i]] = int(argv[i + 1])
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if len(args) != 1:
        print("usage: d12_sizes.py TRACKERS_DIR [--bytes 150000] [--entries 300]", file=sys.stderr)
        return 2
    hits = []
    for p in sorted(Path(args[0]).glob("*.md")):
        text = p.read_text(encoding="utf-8", errors="replace")
        size, entries = p.stat().st_size, count_entries(text)
        if size >= limits["--bytes"] or entries >= limits["--entries"]:
            hits.append(f"{p.name}\t{size} bytes\t{entries} entries")
    if hits:
        print("\n".join(hits))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
