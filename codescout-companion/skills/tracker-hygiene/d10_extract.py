#!/usr/bin/env python3
"""Print one table row per F-N / W-N entry of a session log (tracker-hygiene D10).

usage: d10_extract.py LOG.md [--range W-1..W-82]

An entry runs from its `## <F|W>-<number> — <title>` heading to the next `## ` heading.
Template headings (`## W-N — <title>`) and anything inside a code fence are skipped,
so a count by this table matches the count of real entries.
Columns: id, line, status (first token), status tail, promote-when (`-` when the entry has none).
"""
import re
import sys

HEADING = re.compile(r"^## ([FW])-(\d+) — (.*)$")
FIELD = re.compile(r"^\*\*([^*:]+):\*\*\s*(.*)$")

FENCE = re.compile(r"^(`{3,}|~{3,})(.*)$")


def parse(text):
    entries, cur, fence = [], None, None
    for n, line in enumerate(text.split("\n"), 1):
        fm = FENCE.match(line)
        if fence is None:
            if fm and "`" not in fm[2]:
                fence = fm[1]
        elif fm and fm[1][0] == fence[0] and len(fm[1]) >= len(fence) and not fm[2].strip():
            fence = None
            continue
        if fence is None:
            m = HEADING.match(line)
            if m:
                cur = {"id": f"{m[1]}-{m[2]}", "kind": m[1], "num": int(m[2]), "line": n, "fields": {}}
                entries.append(cur)
                continue
            if line.startswith("## "):
                cur = None
                continue
            if cur is not None and line.startswith("**"):
                for part in line.split(" · "):
                    f = FIELD.match(part)
                    if f and f[1] not in cur["fields"]:
                        cur["fields"][f[1]] = f[2].strip()
    return entries


def status_parts(raw):
    if raw is None:
        return "(none)", ""
    m = re.match(r"([A-Za-z][\w-]*)[.,:;]?\s*(?:[—-]\s*)?(.*)$", raw)
    return (m[1], m[2]) if m else (raw, "")


def in_range(e, lo, hi):
    return lo[0] == e["kind"] and lo[1] <= e["num"] <= hi[1]


def cell(s, width=100):
    s = s.replace("|", "\\|")
    return s if len(s) <= width else s[: width - 1] + "…"


def main(argv):
    if not argv or argv[0].startswith("-"):
        print(__doc__, file=sys.stderr)
        return 2
    path, rng = argv[0], None
    if len(argv) == 3 and argv[1] == "--range":
        m = re.fullmatch(r"([FW])-(\d+)\.\.([FW])-(\d+)", argv[2])
        if not m or m[1] != m[3]:
            print("--range wants one kind, e.g. W-1..W-82", file=sys.stderr)
            return 2
        rng = ((m[1], int(m[2])), (m[3], int(m[4])))
    elif len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    entries = parse(open(path, encoding="utf8").read())
    if rng:
        entries = [e for e in entries if in_range(e, *rng)]
    print("| id | line | status | status tail | promote-when |")
    print("|---|---:|---|---|---|")
    for e in entries:
        status, tail = status_parts(e["fields"].get("Status"))
        pw = e["fields"].get("Promote-when") or "-"
        print(f"| {e['id']} | {e['line']} | {status} | {cell(tail, 60)} | {cell(pw)} |")
    for kind in "FW":
        ks = [e["num"] for e in entries if e["kind"] == kind]
        if ks:
            print(f"\n{kind}: {len(ks)} entries, high-water mark {max(ks)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
