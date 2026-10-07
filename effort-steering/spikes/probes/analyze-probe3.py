import json, glob, sys
import os
base = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude')) + '/projects'
sp = os.environ['PROBE_DIR'] + '/' + sys.argv[1]
runs = [l.split() for l in open(f'{sp}/runs.txt') if l[:1].isdigit() and 'rc=' in l]
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
        mid = (o.get('message') or {}).get('id')
        if mid not in last:
            order.append(mid)
        last[mid] = o
    prev = None; tot_think = 0; viol = []
    for i, mid in enumerate(order):
        o = last[mid]; m = o['message']; u = m.get('usage', {})
        c = u.get('cache_creation_input_tokens') or 0; r = u.get('cache_read_input_tokens') or 0
        th = (u.get('output_tokens_details') or {}).get('thinking_tokens') or 0
        tot_think += th
        tools = [(b.get('name'), (b.get('input') or {}).get('file_path', '')[-12:]) for b in m.get('content', []) if b.get('type') == 'tool_use']
        nthink = sum(1 for b in m.get('content', []) if b.get('type') == 'thinking')
        inv = ''
        if prev is not None:
            exp = prev[0] + prev[1]
            inv = f' expectRead={exp} {"OK" if r == exp else "DIFF " + str(r - exp)}'
            if r != exp:
                viol.append(i)
        print(f"  step {i} effort={o.get('effort')} create={c} read={r} out={u.get('output_tokens')} think={th} thinkblocks={nthink} stop={m.get('stop_reason')} tools={tools}{inv}")
        prev = (r, c)
    try:
        print('  out.txt:', open(f'{sp}/{n}-{arm}/out.txt').read().strip()[:60], '| total think', tot_think, '| invariant violations at steps', viol)
    except Exception as ex:
        print('  out.txt missing', ex)
