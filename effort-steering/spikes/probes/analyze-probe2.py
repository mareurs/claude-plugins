import json, glob, collections, sys
import os
base = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude')) + '/projects'
sp = os.environ['PROBE_DIR'] + '/probe2-runs'
runs = [l.split() for l in open(f'{sp}/runs.txt') if l[:1].isdigit()]
for n, arm, sid, rc in runs:
    fs = glob.glob(f'{base}/*/{sid}.jsonl')
    print(f'== run {n} arm {arm} {sid[:8]} {rc}')
    if not fs:
        print('  NO TRANSCRIPT'); continue
    order = []; last = {}
    for line in open(fs[0]):
        o = json.loads(line)
        if o.get('type') != 'assistant':
            continue
        m = o.get('message') or {}
        mid = m.get('id')
        if mid not in last:
            order.append(mid)
        last[mid] = o
    for i, mid in enumerate(order):
        o = last[mid]; m = o['message']; u = m.get('usage', {})
        tools = [b.get('name') for b in m.get('content', []) if b.get('type') == 'tool_use']
        err = o.get('isApiErrorMessage')
        print(f"  step {i} effort={o.get('effort')} in={u.get('input_tokens')} create={u.get('cache_creation_input_tokens')} read={u.get('cache_read_input_tokens')} out={u.get('output_tokens')} think={(u.get('output_tokens_details') or {}).get('thinking_tokens')} stop={m.get('stop_reason')} tools={tools} apierr={err}")
    d = f'{sp}/{n}-{arm}'
    try:
        print('  out.txt:', open(f'{d}/out.txt').read().strip()[:80])
    except Exception as ex:
        print('  out.txt missing', ex)
