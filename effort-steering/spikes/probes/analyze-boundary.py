#!/usr/bin/env python3
"""Analyze ES-17 probe 4 (effort change at a turn boundary). Usage: PROBE_DIR=<dir> analyze-boundary.py
For each arm: per request (turns marked), the effort the transcript records, the effort ON THE WIRE
(from the recorder log, matched by session id and order), cache creation and read, output and thinking
tokens, and at the turn boundary the gap between the read the previous request implies
(read_prev + creation_prev) and the read actually seen. Every record of a message is merged (the thinking
block sits in an earlier record than the tool_use or text of the same message id; usage is the same)."""
import glob, json, os, sys

cfg = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude'))
sp = os.environ['PROBE_DIR'] + '/probe4-runs'
wire = [json.loads(l) for l in open(f'{sp}/wire.jsonl') if l.strip()]
runs = [l.split() for l in open(f'{sp}/runs.txt') if l[:1].isdigit() and 'rc1=' in l]


def real_prompt(o):
    if o.get('type') != 'user':
        return False
    c = (o.get('message') or {}).get('content')
    if isinstance(c, str):
        return True
    return isinstance(c, list) and any(b.get('type') == 'text' for b in c) and not any(b.get('type') == 'tool_result' for b in c)


for n, arm, sid, rc1, rc2 in runs:
    files = glob.glob(f'{cfg}/projects/*/{sid}.jsonl')
    print(f'== arm {n} {arm[0]}>{arm[1]} {sid[:8]} {rc1} {rc2}')
    if not files:
        print('  NO TRANSCRIPT (a resume may have forked the session id)')
        continue
    turn = 0
    order, last, turn_of = [], {}, {}
    for line in open(files[0]):
        o = json.loads(line)
        if real_prompt(o):
            turn += 1
        if o.get('type') == 'assistant':
            mid = o['message']['id']
            if mid not in last:
                order.append(mid)
                turn_of[mid] = turn
            last[mid] = o
    w = [r for r in wire if r.get('session_id') == sid]
    prev = None
    for i, mid in enumerate(order):
        o = last[mid]
        u = o['message'].get('usage', {})
        c = u.get('cache_creation_input_tokens') or 0
        r = u.get('cache_read_input_tokens') or 0
        th = (u.get('output_tokens_details') or {}).get('thinking_tokens') or 0
        wr = w[i] if i < len(w) else {}
        wire_eff = (wr.get('output_config') or {}).get('effort') if isinstance(wr.get('output_config'), dict) else wr.get('output_config')
        gap = ''
        if prev is not None:
            exp = prev[0] + prev[1]
            gap = f' expectRead={exp} gap={exp - r}' + (' BOUNDARY' if turn_of[mid] != prev[2] else '')
        print(f"  req {i} turn {turn_of[mid]} transcriptEffort={o.get('effort')} wireEffort={wire_eff} create={c} read={r} out={u.get('output_tokens')} think={th} nPins={len(wr.get('pins') or [])}{gap}")
        prev = (r, c, turn_of[mid])
    for k in ('out1.txt', 'out2.txt'):
        try:
            print(f'  {k}:', open(f'{sp}/{n}-{arm}/{k}').read().strip()[:70].replace('\n', ' '))
        except Exception as ex:
            print(f'  {k} missing', ex)
