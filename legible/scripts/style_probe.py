#!/usr/bin/env python3
"""style_probe.py — does the legible output style shorten sentences, does it fade
in long sessions, and does it drop hedge words?

Reads Claude Code transcripts in ~/.claude, ~/.claude-sdd and ~/.claude-kat. Each
assistant message is assigned to the output style that was ACTIVE for it: the most
recent `attachment.type == "output_style"` record before it in the same file. A
message before any such record counts as `none-seen`.

Unit: a "sentence" is a unit split on [.!?] + whitespace or on a newline, after
removing fenced code, tables, headings and Insight-box border lines; inline code
counts as one word; units under 3 words are dropped. Words = whitespace tokens.

Population: assistant `text` blocks with timestamp >= --since, main chain only
(isSidechain false), interactive sessions only (entrypoint == "cli"), cwd not in a
scratchpad, /legible:explain outputs excluded, deduplicated on (message.id, text).

Compare within ONE model (--model). Sentence length differs by model, so a pooled
comparison measures the model mix as much as the style.

Usage:
  python3 legible/scripts/style_probe.py --since 2026-09-20 --model claude-sonnet-5-5
  python3 legible/scripts/style_probe.py --self-test
"""
import argparse, collections, datetime, glob, json, os, random, re, statistics, sys

PROFILES = [".claude", ".claude-sdd", ".claude-kat"]
ARMS = ["Explanatory", "legible:Explanatory STE"]
BUCKETS = [(1, 5), (6, 20), (21, 60), (61, 150), (151, 10**9)]
FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]+`")
LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
HEDGE = re.compile(r"\b(may|might|could|should|probably|likely)\b", re.I)


def sentences(text):
    """Word counts of the sentences in one text block (see the module docstring)."""
    text = LINK.sub(r"\1", INLINE.sub("X", FENCE.sub("\n", text)))
    keep = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith(("|", "#")) or "★ Insight" in s or set(s) <= set("`─- "):
            continue
        keep.append(re.sub(r"^([-*+>]|\d+\.)\s+", "", s).replace("**", ""))
    return [n for n in (len(u.split()) for u in SPLIT.split("\n".join(keep))) if n >= 3]


def collect(home, since, model):
    """(style, file) -> [(block index in session, sentence lengths, hedges, words)]"""
    per, seen = collections.defaultdict(list), set()
    for prof in PROFILES:
        for f in glob.glob(f"{home}/{prof}/projects/*/*.jsonl"):
            style, idx = "none-seen", 0
            for line in open(f, errors="replace"):
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("type") == "attachment" and (e.get("attachment") or {}).get("type") == "output_style":
                    style = e["attachment"].get("style") or "none-seen"
                    continue
                if e.get("type") != "assistant":
                    continue
                m = e.get("message") or {}
                texts = [b.get("text", "") for b in m.get("content", []) if b.get("type") == "text"]
                if not texts or (e.get("timestamp") or "") < since or e.get("isSidechain"):
                    continue
                if e.get("entrypoint") != "cli" or "/scratchpad/" in (e.get("cwd") or ""):
                    continue
                if model and m.get("model") != model:
                    continue
                for t in texts:
                    if (m.get("id"), t) in seen:
                        continue
                    seen.add((m.get("id"), t))
                    if "STE-inspired rewrite:" in t:
                        continue
                    idx += 1
                    lens = sentences(t)
                    if lens:
                        prose = INLINE.sub("X", FENCE.sub(" ", t))
                        per[(style, f)].append((idx, lens, len(HEDGE.findall(prose)), sum(lens)))
    return per


def flat(sessions, pred=lambda r: True):
    return [x for s in sessions for r in s if pred(r) for x in r[1]]


def summary(L):
    return statistics.mean(L), sum(x > 25 for x in L) / len(L)


def hedge_rate(sessions):
    w = sum(r[3] for s in sessions for r in s)
    return 1000 * sum(r[2] for s in sessions for r in s) / w if w else float("nan")


def report(per, since, model, resamples):
    arms = {a: [v for (s, _), v in per.items() if s == a] for a in sorted({s for s, _ in per})}
    print(f"run at {datetime.datetime.now().isoformat(timespec='seconds')} | since {since} | model {model or 'all'}")
    print("\n== by active style ==")
    for a, S in sorted(arms.items(), key=lambda kv: -len(flat(kv[1]))):
        L = flat(S)
        mean, over = summary(L)
        print(f"  {a:<24} sessions={len(S):3d} sentences={len(L):6d} mean={mean:5.2f} "
              f"p90={sorted(L)[int(0.9 * (len(L) - 1))]:3d} >25={over:6.2%} hedges/1000w={hedge_rate(S):.2f}")
    A, B = arms.get(ARMS[0], []), arms.get(ARMS[1], [])
    if len(A) < 5 or len(B) < 5:
        print(f"\nfewer than 5 sessions in an arm ({len(A)} vs {len(B)}): no comparison for model {model or 'all'}")
        return
    rnd, dm, dp, dh = random.Random(1), [], [], []
    for _ in range(resamples):
        a, b = [rnd.choice(A) for _ in A], [rnd.choice(B) for _ in B]
        (ma, pa), (mb, pb) = summary(flat(a)), summary(flat(b))
        dm.append(mb - ma); dp.append(100 * (pb - pa)); dh.append(hedge_rate(b) - hedge_rate(a))
    ci = lambda v: (lambda s: f"[{s[int(0.025 * len(s))]:+.2f}, {s[int(0.975 * len(s))]:+.2f}]")(sorted(v))
    print(f"\n== legible minus Explanatory, 95% CI, bootstrap over sessions ({resamples} resamples) ==")
    print(f"  mean words {ci(dm)}   share >25 {ci(dp)} pp   hedges/1000w {ci(dh)}")
    print("\n== within-session drift: late (block > 60) minus early (blocks 1-20), sessions with >= 30 sentences in each ==")
    for a in ARMS:
        d = []
        for s in arms.get(a, []):
            early, late = flat([s], lambda r: r[0] <= 20), flat([s], lambda r: r[0] > 60)
            if len(early) >= 30 and len(late) >= 30:
                d.append((statistics.mean(late) - statistics.mean(early),
                          100 * (summary(late)[1] - summary(early)[1])))
        if d:
            print(f"  {a:<24} sessions={len(d):3d} mean words {statistics.mean(x for x, _ in d):+.2f} "
                  f"(rises in {sum(x > 0 for x, _ in d)}/{len(d)})  share >25 {statistics.mean(y for _, y in d):+.2f} pp")
        else:
            print(f"  {a:<24} sessions=  0")


SMOKE = ("A `MutexGuard` releases the lock because it implements the `Drop` trait, and its `drop` method "
         "unlocks the mutex. `Mutex::lock()` returns this guard inside a `LockResult`. Through a shared "
         "`&Mutex`, the guard is the only path to the data, through `Deref` and `DerefMut`. When the guard's "
         "owner goes out of scope, the compiler automatically inserts the call to `drop`. So the unlock runs on "
         "every exit path: the normal end of the scope, an early `return`, `?` and panic unwinding. During a "
         "panic, `drop` also marks the mutex as poisoned. This pattern is called RAII: the lock lasts exactly as "
         "long as the guard, and the borrow checker stops code from using the data after the unlock. To release "
         "the lock early, call `drop(guard)`, but note that `std::mem::forget(guard)` skips `Drop` and leaves the "
         "mutex locked.")
FIXTURE = ("## Heading here is dropped\n- First bullet item has six words.\n"
           "- Second bullet: two parts. Then a third one here.\n| col | col |\n```\n"
           "code block line that is long and should never count at all\n```\n"
           "A sentence with `inline code` counts code as one word.")


def self_test():
    """The two calibration checks of 2026-10-11. The smoke text was counted by an
    independent awk splitter as 8 sentences, mean 16.8, max 27."""
    smoke = sentences(SMOKE)
    checks = [
        ("smoke text matches the awk count", (len(smoke), round(statistics.mean(smoke), 1), max(smoke)) == (8, 16.8, 27)),
        ("fixture drops heading, table and code", sentences(FIXTURE) == [6, 4, 5, 9]),
    ]
    for name, ok in checks:
        print(("PASS  " if ok else "FAIL  ") + name)
    return all(ok for _, ok in checks)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", default="2026-09-20", help="ISO date; messages before it are ignored")
    ap.add_argument("--model", help="compare within this model, e.g. claude-sonnet-5-5")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--resamples", type=int, default=2000)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(0 if self_test() else 1)
    report(collect(a.home, a.since, a.model), a.since, a.model, a.resamples)


if __name__ == "__main__":
    main()
