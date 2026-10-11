#!/usr/bin/env bash
# Native approval requests must reach the host; every fixture has private state.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT/codescout-companion/hooks/pre-tool-guard.mjs" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

hook = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='cs-native-approval-', dir=os.environ.get('TMPDIR', '/tmp')) as tmp:
    root = Path(tmp)
    project = root / 'project'
    project.mkdir()
    (project / '.mcp.json').write_text(json.dumps({'mcpServers': {'codescout': {'command': 'codescout'}}}))
    home = root / 'home'
    home.mkdir()
    cases = [
        ('native-escalation', 'Bash', {'command': 'true', 'sandbox_permissions': 'require_escalated', 'justification': 'Approval-flow test'}, False),
        ('native-escalation-no-justification', 'Bash', {'command': 'true', 'sandbox_permissions': 'require_escalated'}, False),
        ('command-only-legacy', 'Bash', {'command': 'true'}, True),
        ('explicit-default', 'Bash', {'command': 'true', 'sandbox_permissions': 'use_default'}, True),
        ('justification-only', 'Bash', {'command': 'true', 'justification': 'require_escalated'}, True),
        ('command-text-is-not-metadata', 'Bash', {'command': 'echo require_escalated'}, True),
        ('unknown-permission-mode', 'Bash', {'command': 'true', 'sandbox_permissions': 'allow'}, True),
        ('permission-prefix-is-not-exact-mode', 'Bash', {'command': 'true', 'sandbox_permissions': 'require_escalated_extra'}, True),
        ('nested-permission-mode', 'Bash', {'command': 'true', 'sandbox_permissions': {'mode': 'require_escalated'}}, True),
        ('read-does-not-inherit-exemption', 'Read', {'file_path': str(project / 'app.rs'), 'sandbox_permissions': 'require_escalated'}, True),
        ('edit-does-not-inherit-exemption', 'Edit', {'file_path': str(project / 'app.rs'), 'sandbox_permissions': 'require_escalated'}, True),
    ]
    failures = []
    for label, tool, ti, denied in cases:
        scratch = root / label
        scratch.mkdir()
        env = dict(os.environ, HOME=str(home), CLAUDE_CONFIG_DIR=str(home / '.claude'), TMPDIR=str(scratch), XDG_STATE_HOME=str(scratch / 'state'))
        payload = {'hook_event_name': 'PreToolUse', 'tool_name': tool, 'cwd': str(project), 'session_id': 'approval-fixture', 'tool_input': ti}
        child = subprocess.run(['node', str(hook)], input=json.dumps(payload), text=True, capture_output=True, timeout=15, env=env, check=True)
        output = json.loads(child.stdout) if child.stdout.strip() else {}
        specific = output.get('hookSpecificOutput', {})
        decision = specific.get('permissionDecision')
        if denied:
            ok = decision == 'deny' and 'run_command' in specific.get('permissionDecisionReason', '') if tool == 'Bash' else decision == 'deny'
        else:
            # No auto-approval, input rewrite, or breaker/dedup strike: host keeps control.
            ok = (decision is None and 'updatedInput' not in specific
                  and 'host approval flow' in specific.get('additionalContext', '')
                  and not list(scratch.glob('cs-*')))
        if ok:
            print('PASS [' + label + ']')
        else:
            failures.append(label)
            print('FAIL [' + label + ']: ' + json.dumps(output))
    assert not failures, 'Failed fixtures: ' + ', '.join(failures)
print('Native approval routing fixtures passed; no requested commands executed.')
PY
