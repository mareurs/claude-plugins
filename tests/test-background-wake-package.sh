#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib-copy-plugin.sh"
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
copy_plugin_tree "$ROOT/codescout-companion" "$SCRATCH/cache with spaces-γ"
env -u NODE_PATH node --input-type=module - "$SCRATCH/cache with spaces-γ" <<'JS'
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const require=createRequire(pathToFileURL(join(root,'background-wake/adapters/codex-client.mjs')));
assert.equal(require('ws/package.json').version,'8.22.0');
assert.ok(require.resolve('ws').startsWith(root));
const {connectCodex}=await import(pathToFileURL(join(root,'background-wake/adapters/codex-client.mjs')));
assert.equal(typeof connectCodex,'function');
console.log('PASS: copied cache independently resolves exact production ws dependency');
JS
