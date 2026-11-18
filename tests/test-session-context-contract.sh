#!/usr/bin/env bash
# Compare packaged contracts; a missing automatic sibling is SKIPPED, not compatible.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PLUGIN="$ROOT/codescout-companion"
CONSUMER="${CODESCOUT_CONTRACT_ROOT:-$ROOT/../codescout}"
if [ -n "${CODESCOUT_CONTRACT_ROOT+x}" ]; then
    case "$CONSUMER" in /*) ;; *) echo "CODESCOUT_CONTRACT_ROOT must be absolute" >&2; exit 2 ;; esac
    [ -f "$CONSUMER/scripts/session-context-v1.schema.json" ] &&
    [ -f "$CONSUMER/tests/fixtures/session-context-v1.json" ] &&
    [ -f "$CONSUMER/scripts/session_context.py" ] || {
        echo "explicit CODESCOUT_CONTRACT_ROOT is missing the contract consumer" >&2; exit 2;
    }
fi
node --test "$PLUGIN/hooks/session-context-contract.test.mjs"
python3 - "$PLUGIN" "$CONSUMER" <<'PY'
import json
import pathlib
import sys
import tempfile

plugin, consumer = map(pathlib.Path, sys.argv[1:])
schema_path = plugin / "contracts/session-context-v1.schema.json"
pack_path = plugin / "contracts/fixtures/session-context-v1.json"
schema, pack = json.loads(schema_path.read_text()), json.loads(pack_path.read_text())
assert schema["properties"]["schema_version"]["const"] == 1
assert pack["contract_version"] == 1
assert {c["name"] for c in pack["cases"]} == {
    "claude-code-root", "claude-code-child:1", "codex-root", "codex-child:1"}
assert len(pack["cases"]) == 4
copies = ((schema_path, consumer / "scripts/session-context-v1.schema.json"),
          (pack_path, consumer / "tests/fixtures/session-context-v1.json"))
if not all(p.is_file() for _, p in copies):
    print("SKIPPED consumer compatibility: automatic sibling has no packaged contract")
    raise SystemExit(0)
for local, peer in copies:
    assert local.read_bytes() == peer.read_bytes(), f"contract copies differ: {peer}"
sys.path.insert(0, str(consumer / "scripts"))
import session_context
with tempfile.TemporaryDirectory(prefix="contract-") as scratch:
    root = pathlib.Path(scratch).resolve()
    cases = json.loads(pack_path.read_text().replace("${WORKSPACE}", str(root)))["cases"]
    for case in cases:
        expected = case["expected"]
        result = session_context.validate_context(expected["context"], root)
        assert result.to_dict() == expected, case["name"]
print(f"PASS consumer compatibility: version 1, {len(cases)} complete expected objects")
PY
