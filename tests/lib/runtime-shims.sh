#!/usr/bin/env bash
# tests/lib/runtime-shims.sh — pin the Node and Python versions a test run-all.sh sees.
#
# WHY THIS EXISTS (issue #18, item 1). run-all.sh decides whether the background-wake
# suites can run by asking `node --version` and `python3 --version`. A test of that decision
# must not depend on the runtimes of the machine that runs it: a developer on Node 22 and a CI
# image on Node 24 would otherwise see different results from the same test.
#
# make_runtime_shims <dir> <node-version> <python-version>
#   Writes <dir>/node and <dir>/python3. Each answers `--version` with the pinned version and
#   forwards every other call to the real binary found when this function ran, so a suite that
#   `node` really executes still works. Put <dir> first on PATH for the run under test.
#   Versions are bare numbers: `22.1.0`, `3.13.0`.
make_runtime_shims() {
  local dir="$1" node_v="$2" py_v="$3" real_node real_py
  real_node="$(command -v node)" || { echo "make_runtime_shims: no node on PATH" >&2; return 1; }
  real_py="$(command -v python3)" || { echo "make_runtime_shims: no python3 on PATH" >&2; return 1; }
  mkdir -p "$dir"
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo "v%s"; exit 0; }\nexec "%s" "$@"\n' "$node_v" "$real_node" > "$dir/node"
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo "Python %s"; exit 0; }\nexec "%s" "$@"\n' "$py_v" "$real_py" > "$dir/python3"
  chmod +x "$dir/node" "$dir/python3"
}
