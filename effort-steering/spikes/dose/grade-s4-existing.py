#!/usr/bin/env python3
"""Exploratory quality check of the S4 second-registration answers (ES-21), no model call.
Reads the 33 transcripts of the run, drops the canary, keeps the final answer text of each run, and checks what is
checkable: tiling count (571 by dynamic programming), the three real bugs of the bug-hunt snippet (crude keywords),
and the Python code of the palindrome and LRU prompts by RUNNING it against a reference in an isolated subprocess
(python3 -I, temp cwd, 10 s timeout). Arm = presence of a hook_additional_context attachment. Brittle by design:
an API mismatch is reported as 'untestable', not as a failure."""
import glob, json, os, re, subprocess, sys, tempfile, textwrap

D = sys.argv[1]  # the directory with the run's transcripts


def sessions():
    out = []
    for f in glob.glob(D + '/*.jsonl'):
        steered, first, texts = False, None, []
        for line in open(f):
            o = json.loads(line)
            m = o.get('message') or {}
            if o.get('type') == 'user' and first is None:
                c = m.get('content')
                first = c if isinstance(c, str) else str(c)
            if o.get('type') == 'attachment' and (o.get('attachment') or {}).get('type') == 'hook_additional_context':
                steered = True
            if o.get('type') == 'assistant':
                texts += [b['text'] for b in m.get('content', []) if b.get('type') == 'text']
        ts = json.loads(open(f).readline()).get('timestamp')
        out.append({'ts': ts, 'prompt': first, 'arm': 'treated' if steered else 'holdout', 'text': '\n'.join(texts)})
    out.sort(key=lambda r: r['ts'])
    return out[1:]  # the first session is the canary


def code_blocks(text):
    return re.findall(r'```(?:python|py)?\n(.*?)```', text, re.S)


def run_py(src, timeout=10):
    # `from __future__` lines must come first in a file: hoist them above the harness imports.
    fut = [l for l in src.splitlines() if l.startswith('from __future__')]
    src = '\n'.join(fut) + '\n' + '\n'.join(l for l in src.splitlines() if not l.startswith('from __future__'))
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 't.py')
        open(p, 'w').write(src)
        try:
            r = subprocess.run([sys.executable, '-I', p], cwd=d, capture_output=True, text=True, timeout=timeout, env={'PATH': os.environ['PATH']})
            return r.returncode, r.stdout.strip(), r.stderr.strip()[-200:]
        except subprocess.TimeoutExpired:
            return 124, '', 'timeout'


PAL_HARNESS = '''
import random, inspect
{code}
fns = [v for k, v in list(globals().items()) if callable(v) and getattr(v, "__module__", None) == "__main__" and not k.startswith("_") and not inspect.isclass(v)]
def brute(s):
    best = ""
    for i in range(len(s)):
        for j in range(i, len(s)):
            t = s[i:j+1]
            if t == t[::-1] and len(t) > len(best): best = t
    return best
random.seed(1)
tests = ["", "a", "ab", "babad", "cbbd", "forgeeksskeegfor", "abacdfgdcaba"] + ["".join(random.choice("ab") for _ in range(random.randint(1, 14))) for _ in range(40)]
f = fns[0] if fns else None
if f is None: print("UNTESTABLE no function"); raise SystemExit
bad = 0; ex = None
for s in tests:
    try:
        r = f(s)
    except Exception as e:
        print("UNTESTABLE", type(e).__name__, str(e)[:60]); raise SystemExit
    if isinstance(r, tuple): r = s[r[0]:r[1]+1] if len(r) == 2 and all(isinstance(x, int) for x in r) else r
    if not isinstance(r, str): print("UNTESTABLE return type", type(r).__name__); raise SystemExit
    ok = (r == r[::-1]) and (r in s) and len(r) == len(brute(s))
    if not ok: bad += 1; ex = ex or (s, r)
print("PASS" if bad == 0 else "FAIL %d/%d e.g. %r" % (bad, len(tests), ex))
'''

LRU_HARNESS = '''
import inspect
{code}
cls = [v for k, v in list(globals().items()) if inspect.isclass(v) and getattr(v, "__module__", None) == "__main__"]
cls = [c for c in cls if hasattr(c, "get") and hasattr(c, "put")]
if not cls: print("UNTESTABLE no class with get and put"); raise SystemExit
C = cls[-1] if len(cls) == 1 else [c for c in cls if "lru" in c.__name__.lower()][0] if any("lru" in c.__name__.lower() for c in cls) else cls[-1]
try:
    c = C(2)
except Exception as e:
    print("UNTESTABLE ctor", type(e).__name__); raise SystemExit
def g(k):
    r = c.get(k)
    return -1 if r is None else r
try:
    c.put(1, 1); c.put(2, 2)
    assert g(1) == 1
    c.put(3, 3)                 # evicts 2
    assert g(2) == -1
    c.put(4, 4)                 # evicts 1
    assert g(1) == -1 and g(3) == 3 and g(4) == 4
    c.put(3, 30); c.put(5, 5)   # update 3 (most recent), evicts 4
    assert g(4) == -1 and g(3) == 30 and g(5) == 5
    print("PASS")
except AssertionError:
    print("FAIL")
except Exception as e:
    print("UNTESTABLE", type(e).__name__, str(e)[:60])
'''

rows = []
for s in sessions():
    p = s['prompt']
    if p.startswith('Count the ways to tile'):
        ok = bool(re.findall(r'\b\d+\b', s['text'])) and re.findall(r'\b\d+\b', s['text'])[-1] == '571'
        rows.append(('tiling', s['arm'], 'PASS' if ok else 'FAIL (last number != 571)'))
    elif p.startswith('Find every bug'):
        t = s['text']
        b1 = bool(re.search(r'lo\s*=\s*mid\b.{0,200}(infinite|never|stuck|loop|mid\s*\+\s*1)', t, re.S | re.I))
        b2 = bool(re.search(r'hi\s*=\s*mid\s*-\s*1', t))
        b3 = bool(re.search(r'(IndexError|out of (range|bounds)|past the end|== len)', t, re.I))
        rows.append(('bug hunt', s['arm'], f'{int(b1) + int(b2) + int(b3)}/3 bugs named'))
    elif p.startswith('Write a function that finds the longest palindromic'):
        blocks = code_blocks(s['text'])
        res = 'UNTESTABLE no code block'
        for b in blocks:
            if 'def ' in b:
                rc, out, err = run_py(PAL_HARNESS.replace('{code}', b))
                res = out.splitlines()[-1] if out else f'UNTESTABLE rc={rc} {err}'
                break
        rows.append(('palindrome', s['arm'], res))
    elif p.startswith('Implement an LRU cache'):
        blocks = code_blocks(s['text'])
        res = 'UNTESTABLE no code block'
        for b in sorted(blocks, key=len, reverse=True):
            if 'class ' in b:
                rc, out, err = run_py(LRU_HARNESS.replace('{code}', b))
                res = out.splitlines()[-1] if out else f'UNTESTABLE rc={rc} {err}'
                break
        rows.append(('LRU cache', s['arm'], res))
for r in sorted(rows):
    print('%-11s %-8s %s' % r)
