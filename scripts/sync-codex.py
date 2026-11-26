#!/usr/bin/env python3
"""scripts/sync-codex.py <plugin> <version> [--check]

The Codex half of a release, beside sync-copilot.sh and the Claude Code steps.

Codex has no per-plugin install record that a script may repoint: `codex plugin add
<plugin>@<marketplace>` re-copies a plugin from the LOCAL marketplace (this checkout) into
`$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, and `codex plugin marketplace
upgrade` does nothing for a local marketplace. Every `add` that changes content cancels the
plugin's hook approvals (`trustStatus: modified`, hooks fail with "plugin contents changed;
hook approval required"). This script does both halves:

  1. Run `codex plugin add` if the plugin should be installed and is missing or stale.
     For local marketplaces, a temporary Codex profile supplies the reference bytes,
     including generated command skills. Compare the live cache before renewing approvals.
     With `--check`, report missing or stale plugins and leave the live profile read-only.
  2. Through `codex app-server` (stdio JSON-RPC, the same write path as `/hooks`): list the
     plugin's hooks. A hook that is `modified` AND whose declaration half of `currentHash`
     equals its recorded `trusted_hash` changed in content only; its `trusted_content_hash`
     is renewed. Anything else is reported, never approved: a hook the user never approved
     (`untrusted`), or one whose declaration (command, matcher, timeout) changed.
  3. List again; every renewed hook must read `trusted`.

Soft-skips (exit 0) when there is no `codex` binary, no `$CODEX_HOME/config.toml`, or the plugin
is absent from the Codex config and not listed in harness-targets.json, or explicitly disabled. Re-adding a disabled plugin
would enable it. `--check` changes nothing and exits 1 on a stale cache or a `modified`
hook of an enabled plugin, so check-profile-parity.sh can gate on it.

Env: HARNESS_TARGETS (default scripts/harness-targets.json), CODEX_HOME (default ~/.codex), MARKETPLACE (default sdd-misc-plugins), CODEX_BIN (default
`codex`). Exit 1 on a failure; "needs review" items are a warning, not a failure.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MARKETPLACE = os.environ.get("MARKETPLACE", "sdd-misc-plugins")
CODEX = os.environ.get("CODEX_BIN", "codex")
HOME = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
TIMEOUT = 120


class AppServer:
    """One `codex app-server` over stdio. Reads and writes the user config, like `/hooks`."""

    def __init__(self) -> None:
        self.p = subprocess.Popen([CODEX, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, env={**os.environ, "CODEX_HOME": str(HOME)})
        self.n = 0
        self.call("initialize", {"clientInfo": {"name": "claude-plugins-release", "version": "1"}})
        self._send({"jsonrpc": "2.0", "method": "initialized"})

    def _send(self, msg: dict) -> None:
        assert self.p.stdin
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

    def call(self, method: str, params: dict) -> dict:
        self.n += 1
        self._send({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params})
        assert self.p.stdout
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError(f"codex app-server closed during {method}")
            msg = json.loads(line)
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg["result"]

    def close(self) -> None:
        try:
            self.p.terminate()
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


def plugin_hooks(srv: AppServer, plugin: str) -> list[dict]:
    prefix = f"{plugin}@{MARKETPLACE}:"
    data = srv.call("hooks/list", {"cwds": [str(REPO)]})["data"]
    return [h for e in data for h in e["hooks"] if h["key"].startswith(prefix)]


def recorded(key: str) -> dict:
    with open(HOME / "config.toml", "rb") as f:
        return tomllib.load(f).get("hooks", {}).get("state", {}).get(key, {})


def classify(hooks: list[dict]) -> tuple[list[tuple[dict, str]], list[str], int]:
    """(hooks to renew with their new content hash, needs-review lines, count already trusted)."""
    renew, review, trusted = [], [], 0
    for h in hooks:
        decl, _, content = h["currentHash"].partition("/")
        status = h["trustStatus"]
        if status == "trusted":
            trusted += 1
        elif status == "modified" and recorded(h["key"]).get("trusted_hash") == decl:
            renew.append((h, content))
        else:
            why = "never approved" if status == "untrusted" else "its declaration changed"
            review.append(f"{h['key']} ({why})")
    return renew, review, trusted


def run_codex(profile: Path, *args: str) -> None:
    result = subprocess.run(
        [CODEX, *args],
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        env={**os.environ, "CODEX_HOME": str(profile)},
    )
    if result.returncode != 0:
        raise RuntimeError(f"codex {' '.join(args)} failed (rc={result.returncode}): {result.stderr.strip()[:300]}")


def plugin_cache(profile: Path, plugin: str, version: str) -> Path:
    return profile / "plugins" / "cache" / MARKETPLACE / plugin / version


def cache_payload(cache: Path) -> dict[str, bytes | str]:
    """Fingerprint the files and symlink targets in a Codex cache."""
    payload = {}
    for path in cache.rglob("*"):
        name = path.relative_to(cache).as_posix()
        if path.is_symlink():
            payload[name] = os.readlink(path)
        elif path.is_file():
            with path.open("rb") as stream:
                payload[name] = hashlib.file_digest(stream, "sha256").digest()
    return payload


def local_payload(config: dict, selector: str, plugin: str, version: str) -> dict[str, bytes | str] | None:
    """Let Codex prepare the reference install, including generated command skills."""
    marketplace = config.get("marketplaces", {}).get(MARKETPLACE, {})
    if marketplace.get("source_type") != "local":
        return None
    source = marketplace.get("source")
    if not source:
        raise RuntimeError(f"local marketplace {MARKETPLACE} has no source path")
    with tempfile.TemporaryDirectory(prefix="codex-parity-") as scratch:
        profile = Path(scratch)
        run_codex(profile, "plugin", "marketplace", "add", source)
        run_codex(profile, "plugin", "add", selector)
        reference = plugin_cache(profile, plugin, version)
        if not reference.is_dir():
            raise RuntimeError(f"local marketplace did not produce {plugin} {version}")
        return cache_payload(reference)


def cache_difference(cache: Path, expected: dict[str, bytes | str] | None) -> str | None:
    if not cache.is_dir():
        return f"cache directory is missing ({cache})"
    if expected is None:
        return None
    actual = cache_payload(cache)
    for name in sorted(expected.keys() | actual.keys()):
        if expected.get(name) != actual.get(name):
            return f"cache differs from the local marketplace at {name}"
    return None



def main(argv: list[str]) -> int:
    check = "--check" in argv
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print("usage: sync-codex.py <plugin> <version> [--check]", file=sys.stderr)
        return 2
    plugin, version = args
    sel = f"{plugin}@{MARKETPLACE}"

    if shutil.which(CODEX) is None or not (HOME / "config.toml").is_file():
        print(f"= no Codex install on this machine ({HOME}/config.toml or `{CODEX}` missing): skipping")
        return 0
    with open(HOME / "config.toml", "rb") as f:
        config = tomllib.load(f)
    settings = config.get("plugins", {}).get(sel)
    if settings is None:
        wanted = plugin in json.loads(Path(os.environ.get("HARNESS_TARGETS") or REPO / "scripts" / "harness-targets.json").read_text()).get("codex", [])
        if not wanted:
            print(f"= {plugin} is not installed in Codex: skipping")
            return 0
        if check:
            print(f"MISSING: {plugin} is listed for Codex in scripts/harness-targets.json but not installed; run scripts/sync-codex.py {plugin} {version}")
            return 1
        print(f"  {plugin} is listed for Codex and not installed: installing")
    elif settings.get("enabled") is False:
        print(f"= {plugin} is disabled in Codex: skipping")
        return 0

    cache = plugin_cache(HOME, plugin, version)
    try:
        expected = local_payload(config, sel, plugin, version) if not check or cache.is_dir() else None
        difference = cache_difference(cache, expected)
        if check and difference:
            print(f"STALE: {plugin} in Codex at {version}: {difference}; run scripts/sync-codex.py {plugin} {version}")
            return 1
        if settings is None or difference:
            action = "refreshed" if cache.is_dir() else "seeded"
            run_codex(HOME, "plugin", "add", sel)
            difference = cache_difference(cache, expected)
            if difference:
                raise RuntimeError(f"codex plugin add did not refresh {sel} {version}: {difference}")
            print(f"  ✓ codex plugin add {sel}: cache {version} {action}")
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        print(f"✗ codex cache: {exc}")
        return 1

    srv = AppServer()
    try:
        renew, review, trusted = classify(plugin_hooks(srv, plugin))
        if check:
            for h, _ in renew:
                print(f"MODIFIED: {h['key']} (content changed; run scripts/sync-codex.py {plugin} {version})")
            for r in review:
                print(f"REVIEW: {r}")
            print(f"  codex {plugin} {version}: {trusted} hook(s) trusted, {len(renew)} to renew, {len(review)} to review")
            return 1 if renew else 0
        if renew:
            edits = [{"keyPath": f'hooks.state."{h["key"]}".trusted_content_hash', "mergeStrategy": "replace", "value": content} for h, content in renew]
            srv.call("config/batchWrite", {"edits": edits, "reloadUserConfig": True})
            again = {h["key"]: h["trustStatus"] for h in plugin_hooks(srv, plugin)}
            bad = [h["key"] for h, _ in renew if again.get(h["key"]) != "trusted"]
            if bad:
                print(f"✗ codex: {len(bad)} renewed hook(s) are still not trusted: {', '.join(bad[:3])}")
                return 1
        print(f"  ✓ codex {plugin} {version}: {trusted + len(renew)} hook(s) trusted ({len(renew)} renewed)")
        if review:
            print(f"  ⚠ codex: {len(review)} hook(s) of {plugin} need your review; Codex runs none of them until you approve in /hooks:")
            for r in review:
                print(f"      {r}")
        return 0
    except Exception as exc:  # noqa: BLE001 - one line for the release log
        print(f"✗ codex app-server: {exc}")
        return 1
    finally:
        srv.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
