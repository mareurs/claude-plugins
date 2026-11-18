#!/usr/bin/env python3
"""ES-20 calibration pilot for the effort dose-response experiment (throwaway instrument, no unit tests beyond --selftest).

Runs every candidate task REPS times at ONE effort level (default medium), direct to the API (no recorder,
no proxy), tools off, stdin closed, one session per run, and appends one JSON row per run to
$PROBE_DIR/calib/rows.jsonl as soon as the run ends (a re-run skips (task, rep) pairs already in the file).

    PROBE_DIR=<scratch dir outside any repo> CLAUDE_CONFIG_DIR=~/.claude python3 run-calibration.py [--reps 3] [--effort medium] [--limit N] [--seed 20261009] [--tasks FILE]
    python3 run-calibration.py --selftest

Row fields: task, stratum, rep, session, rc, correct, answer_line, output_tokens, thinking_tokens, cost_usd,
tool_uses, first_message_lines, effort_recorded, model, error. Needs `claude` on PATH. Each call is capped at 1 USD."""
import glob, json, os, random, re, subprocess, sys, uuid
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'claude-sonnet-5-5'


def normalise(s):
    s = s.strip().strip('.').strip()
    s = s.strip('`*"\' ')
    return s.replace(',', '').replace(' ', '').lower()


def grade(text, answer, kind):
    """Last line of the form `ANSWER: <value>`; compare to the exact answer. Returns (correct, answer_line)."""
    lines = [l for l in (text or '').splitlines() if re.match(r'^\s*\**\s*ANSWER\s*:', l, re.I)]
    if not lines:
        return False, None
    line = lines[-1]
    value = normalise(re.sub(r'^\s*\**\s*ANSWER\s*:\s*', '', line, flags=re.I))
    try:
        if kind == 'int':
            return int(value) == int(answer), line.strip()
        if kind == 'int2':
            return value == answer, line.strip()
        if kind == 'fraction':
            return Fraction(value) == Fraction(answer), line.strip()
        return value == normalise(answer), line.strip()
    except (ValueError, ZeroDivisionError):
        return False, line.strip()


def selftest():
    cases = [
        ('ANSWER: 408', '408', 'int', True), ('blah\nANSWER: 1,000', '1000', 'int', True), ('ANSWER: 12.', '12', 'int', True),
        ('ANSWER: 13', '12', 'int', False), ('no answer line', '1', 'int', False), ('ANSWER: Canberra', 'canberra', 'word', True),
        ('ANSWER: 55/84', '55/84', 'fraction', True), ('ANSWER: 110/168', '55/84', 'fraction', True), ('ANSWER: 29', '29', 'int2', True),
        ('ANSWER: 9', '09', 'int2', False), ('first\nANSWER: 1\nANSWER: 2', '2', 'int', True), ('**ANSWER: 7**', '7', 'int', True),
        ('ANSWER: twelve', '12', 'int', False),
    ]
    bad = [c for c in cases if grade(c[0], c[1], c[2])[0] != c[3]]
    print('selftest', 'FAIL ' + repr(bad) if bad else f'ok ({len(cases)} cases)')
    return 1 if bad else 0


def transcript_facts(cfg, sid):
    files = glob.glob(f'{cfg}/projects/*/{sid}.jsonl')
    if not files:
        return None
    first = None
    last = {}
    tool_uses = 0
    efforts = set()
    for line in open(files[0]):
        o = json.loads(line)
        if o.get('type') == 'user' and first is None:
            c = (o.get('message') or {}).get('content')
            first = c if isinstance(c, str) else ''.join(b.get('text', '') for b in c if isinstance(b, dict))
        if o.get('type') == 'assistant':
            mid = o['message']['id']
            last[mid] = o
            efforts.add(o.get('effort'))
            tool_uses += sum(1 for b in o['message'].get('content', []) if b.get('type') == 'tool_use')
    out = sum((o['message'].get('usage') or {}).get('output_tokens') or 0 for o in last.values())
    think = sum(((o['message'].get('usage') or {}).get('output_tokens_details') or {}).get('thinking_tokens') or 0 for o in last.values())
    return {'first_lines': len((first or '').strip().splitlines()), 'output_tokens': out, 'thinking_tokens': think,
            'tool_uses': tool_uses, 'efforts': sorted(str(e) for e in efforts)}


def main():
    args = sys.argv[1:]
    if '--selftest' in args:
        sys.exit(selftest())
    get = lambda k, d: args[args.index(k) + 1] if k in args else d
    reps, effort, limit, seed = int(get('--reps', 3)), get('--effort', 'medium'), int(get('--limit', 0)), int(get('--seed', 20261009))
    probe = os.environ['PROBE_DIR']
    cfg = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude'))
    out_dir = f'{probe}/calib'
    os.makedirs(out_dir, exist_ok=True)
    rows_path = f'{out_dir}/rows.jsonl'
    done = set()
    if os.path.exists(rows_path):
        for l in open(rows_path):
            r = json.loads(l)
            done.add((r['task'], r['rep'], r['effort']))
    tasks = json.load(open(get('--tasks', f'{HERE}/tasks.candidates.json')))['tasks']
    runs = [(t, rep) for rep in range(reps) for t in tasks]
    random.Random(seed).shuffle(runs)
    if limit:
        runs = runs[:limit]
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'USER': os.environ.get('USER', ''), 'LANG': os.environ.get('LANG', 'C.UTF-8'),
           'TERM': 'dumb', 'SHELL': '/bin/bash', 'CLAUDE_CONFIG_DIR': cfg}
    for i, (t, rep) in enumerate(runs):
        if (t['id'], rep, effort) in done:
            continue
        sid = str(uuid.uuid4())
        cwd = f'{out_dir}/{i:03d}-{t["id"]}-{rep}'
        os.makedirs(cwd, exist_ok=True)
        cmd = ['claude', '-p', '--model', MODEL, '--session-id', sid, '--setting-sources', 'local', '--settings', '{}', '--strict-mcp-config',
               '--thinking-display', 'summarized', '--effort', effort, '--tools', '', '--max-budget-usd', '1', '--output-format', 'json', '--', t['prompt']]
        row = {'task': t['id'], 'stratum': t['stratum'], 'rep': rep, 'effort': effort, 'session': sid, 'model': MODEL, 'error': None}
        try:
            p = subprocess.run(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
            row['rc'] = p.returncode
            try:
                res = json.loads(p.stdout)
            except Exception as ex:  # noqa: BLE001
                res = {}
                row['error'] = f'stdout not json: {ex!r}: {p.stdout[:120]!r} stderr: {p.stderr[:120]!r}'
            text = res.get('result') if isinstance(res.get('result'), str) else ''
            row['cost_usd'] = res.get('total_cost_usd')
            row['is_error'] = res.get('is_error')
            row['correct'], row['answer_line'] = grade(text, t['answer'], t['kind'])
        except subprocess.TimeoutExpired:
            row.update(rc=None, error='timeout', correct=False, answer_line=None, cost_usd=None)
        facts = transcript_facts(cfg, sid)
        if facts is None:
            row['error'] = (row['error'] or '') + ' no transcript'
        else:
            row.update(output_tokens=facts['output_tokens'], thinking_tokens=facts['thinking_tokens'], tool_uses=facts['tool_uses'],
                       first_message_lines=facts['first_lines'], effort_recorded=facts['efforts'])
        with open(rows_path, 'a') as fh:
            fh.write(json.dumps(row) + '\n')
        print(f'{i + 1}/{len(runs)} {t["id"]} rep{rep} rc={row.get("rc")} correct={row.get("correct")} out={row.get("output_tokens")} think={row.get("thinking_tokens")} cost={row.get("cost_usd")} err={row.get("error")}', flush=True)


if __name__ == '__main__':
    main()
