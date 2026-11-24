#!/usr/bin/env python3
"""Measure the size of every tool result the model read in the last 48 hours, from Claude Code transcripts.

Numbers and tool names only; no text is saved. Tokens are an estimate: ceil(chars / 4), as codescout-display counts.
Usage: python3 -I scripts/measure-tool-result-sizes.py [results.jsonl]   (default: ./tool-result-sizes.jsonl)
It prints the percentiles of the call and of the reply, and the share of results in each color of the token row
(IN_MID, IN_HIGH, OUT_MID and OUT_HIGH in codescout-display/hooks/cards.ts). Calibration record:
docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md, section "Token colors".
"""
import glob, json, math, os, sys, time, datetime, collections

HOME = os.path.expanduser("~")
PROFILES = {".claude": "main", ".claude-sdd": "sdd", ".claude-kat": "kat", ".claude-stef": "stef"}
OUT = sys.argv[1] if len(sys.argv) > 1 else "tool-result-sizes.jsonl"
now = datetime.datetime.now(datetime.timezone.utc)
cutoff = now - datetime.timedelta(hours=48)
cutoff_ts = cutoff.timestamp()


def parse_ts(s):
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


calls = {}      # id -> (name, in_tokens)
seen = set()
results = []
stats = collections.Counter()
min_ts = max_ts = None
files = []
for prof in PROFILES:
    for p in glob.glob(os.path.join(HOME, prof, "projects", "**", "*.jsonl"), recursive=True):
        try:
            if os.path.getmtime(p) >= cutoff_ts:
                files.append((prof, p))
        except OSError:
            pass
stats["files_scanned"] = len(files)

for prof, path in files:
    sidechain_path = False
    last_ts = None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "api-request-blob" in line[:300]:
                stats["blob_lines_skipped"] += 1
                continue
            try:
                o = json.loads(line)
            except Exception:
                stats["bad_json"] += 1
                continue
            if not isinstance(o, dict):
                continue
            t = o.get("type")
            ts = parse_ts(o["timestamp"]) if isinstance(o.get("timestamp"), str) else None
            if ts is not None:
                last_ts = ts
            else:
                ts = last_ts
            if t not in ("user", "assistant"):
                if t == "api-request-blob":
                    stats["blob_lines_skipped"] += 1
                continue
            msg = o.get("message")
            content = msg.get("content") if isinstance(msg, dict) else None
            if not isinstance(content, list):
                continue
            if t == "assistant":
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        tid = b.get("id")
                        if tid and tid not in calls:
                            calls[tid] = (b.get("name") or "?",
                                          math.ceil(len(json.dumps(b.get("input"))) / 4))
            else:
                for b in content:
                    if not (isinstance(b, dict) and b.get("type") == "tool_result"):
                        continue
                    tid = b.get("tool_use_id")
                    stats["results_seen"] += 1
                    if tid in seen:
                        stats["dups_dropped"] += 1
                        continue
                    seen.add(tid)
                    if ts is None or ts < cutoff_ts:
                        stats["results_outside_window"] += 1
                        continue
                    c = b.get("content")
                    chars = 0
                    images = 0
                    head = ""
                    if isinstance(c, str):
                        chars = len(c)
                        head = c[:300]
                    elif isinstance(c, list):
                        for x in c:
                            if isinstance(x, dict) and x.get("type") == "text" and isinstance(x.get("text"), str):
                                if len(head) < 300:
                                    head += x["text"][:300]
                                chars += len(x["text"])
                            else:
                                images += 1
                    persisted = ("Output too large" in head[:300]) or ("saved to" in head[:300])
                    results.append([tid, prof, bool(o.get("isSidechain")), bool(b.get("is_error")),
                                    persisted, math.ceil(chars / 4), images, ts])
                    if min_ts is None or ts < min_ts:
                        min_ts = ts
                    if max_ts is None or ts > max_ts:
                        max_ts = ts

missing = 0
with open(OUT, "w") as out:
    for tid, prof, side, err, pers, outt, imgs, ts in results:
        name, intok = calls.get(tid, ("?", 0))
        if name == "?":
            missing += 1
        out.write(json.dumps({"tool": name, "profile": PROFILES[prof], "sidechain": side,
                              "is_error": err, "persisted": pers, "in_tokens": intok,
                              "out_tokens": outt, "images": imgs}) + "\n")
stats["results_kept"] = len(results)
stats["missing_call"] = missing
iso = lambda x: datetime.datetime.fromtimestamp(x, datetime.timezone.utc).isoformat() if x else None
print(json.dumps(dict(stats)))
print("window", iso(cutoff_ts), "->", iso(now.timestamp()), "covered", iso(min_ts), iso(max_ts))

# Percentiles of the call and of the reply, and the share of each color at the limits now in cards.ts.
import re
cards = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "codescout-display", "hooks", "cards.ts")).read()
limit = lambda n: int(re.search(rf"export const {n} = (\d+)", cards).group(1))
sides = {
    "in": (sorted(calls.get(r[0], ("?", 0))[1] for r in results), limit("IN_MID"), limit("IN_HIGH")),
    "out": (sorted(r[5] for r in results), limit("OUT_MID"), limit("OUT_HIGH")),
}
for side, (v, mid, high) in sides.items():
    if not v:
        continue
    pick = lambda p: v[min(len(v) - 1, int(p / 100 * len(v)))]
    low = sum(t < mid for t in v) / len(v)
    red = sum(t >= high for t in v) / len(v)
    print(f"{side:3} tokens p50/p75/p90/p95/p99: {[pick(p) for p in (50, 75, 90, 95, 99)]}")
    print(f"{side:3} limits {mid}/{high}: green {low:.1%} orange {1 - low - red:.1%} red {red:.1%}")
