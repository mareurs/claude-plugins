"""Unit tests for codescout-companion/scripts/detect.py.

Shell-level characterization is in tests/test-detect-tools.sh. These tests
cover edge cases that are awkward to express in shell: malformed JSON,
args-list (vs command) matching, ~ expansion, multi-line system prompts,
unicode, ordering across config files.

Run with:
    pytest claude-plugins/tests/test_detect.py
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DETECT_PY = REPO_ROOT / "codescout-companion" / "scripts" / "detect.py"

# Importing the module directly avoids subprocess overhead for unit tests.
sys.path.insert(0, str(DETECT_PY.parent))
import detect  # noqa: E402


# ── helpers ──


def _write(p: Path, content: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def _detect(cwd: Path, *, home: Path | None = None, claude_config_dir: Path | None = None) -> dict[str, str]:
    return detect.detect(
        str(cwd),
        str(home) if home else "/nonexistent-home",
        str(claude_config_dir) if claude_config_dir else None,
    )


# ── tests ──


def test_empty_cwd_returns_no_detection(tmp_path: Path) -> None:
    out = _detect(tmp_path)
    assert out["HAS_CODESCOUT"] == "false"
    assert out["CS_SERVER_NAME"] == ""
    assert out["CS_PREFIX"] == ""
    assert out["BLOCK_READS"] == "true"


def test_args_array_matches_regex(tmp_path: Path) -> None:
    """A server whose command is generic but args contain 'codescout' should match."""
    mcp = tmp_path / ".mcp.json"
    _write(mcp, json.dumps({
        "mcpServers": {
            "my-server": {
                "command": "/usr/bin/python3",
                "args": ["-m", "codescout.cli"],
            }
        }
    }))
    out = _detect(tmp_path)
    assert out["HAS_CODESCOUT"] == "true"
    assert out["CS_SERVER_NAME"] == "my-server"


def test_malformed_mcp_json_falls_through(tmp_path: Path) -> None:
    """Invalid JSON in .mcp.json should not crash detection — it should silently skip."""
    _write(tmp_path / ".mcp.json", '{"mcpServers": {invalid json')
    out = _detect(tmp_path)
    assert out["HAS_CODESCOUT"] == "false"


def test_routing_override_wins_over_mcp_json(tmp_path: Path) -> None:
    """server_name in routing config takes precedence over .mcp.json detection."""
    _write(tmp_path / ".claude" / "codescout-companion.json", json.dumps({"server_name": "explicit-name"}))
    _write(tmp_path / ".mcp.json", json.dumps({
        "mcpServers": {"different-name": {"command": "/bin/codescout"}}
    }))
    out = _detect(tmp_path)
    assert out["CS_SERVER_NAME"] == "explicit-name"


def test_routing_legacy_names_in_priority_order(tmp_path: Path) -> None:
    """codescout-companion.json > codescout-routing.json."""
    claude = tmp_path / ".claude"
    _write(claude / "codescout-companion.json", json.dumps({"server_name": "winner"}))
    _write(claude / "codescout-routing.json", json.dumps({"server_name": "loser1"}))
    out = _detect(tmp_path)
    assert out["CS_SERVER_NAME"] == "winner"


def test_workspace_root_tilde_expanded(tmp_path: Path) -> None:
    fake_home = tmp_path / "fake-home"
    _write(tmp_path / ".claude" / "codescout-companion.json", json.dumps({
        "server_name": "x",
        "workspace_root": "~/some-project",
    }))
    out = _detect(tmp_path, home=fake_home)
    assert out["WORKSPACE_ROOT"] == str(fake_home / "some-project")


def test_project_dir_is_codescout(tmp_path: Path) -> None:
    (tmp_path / ".codescout").mkdir()
    out = _detect(tmp_path)
    assert out["CS_PROJECT_DIR"].endswith("/.codescout")




def test_memories_collected_with_trailing_space(tmp_path: Path) -> None:
    """The bash impl produced 'name1 name2 ' with trailing space — preserve."""
    mem_dir = tmp_path / ".codescout" / "memories"
    _write(mem_dir / "alpha.md", "")
    _write(mem_dir / "beta.md", "")
    out = _detect(tmp_path)
    assert out["HAS_CS_MEMORIES"] == "true"
    assert out["CS_MEMORY_NAMES"].endswith(" ")
    names = out["CS_MEMORY_NAMES"].split()
    assert set(names) == {"alpha", "beta"}


def test_namespaced_memories_are_collected_as_paths(tmp_path: Path) -> None:
    """A memory in a subdirectory is a topic named by its PATH, and must be advertised.

    codescout's MemoryStore::list walks at arbitrary depth and keys each topic by its
    path relative to the memories dir, so `memory(action="read",
    topic="infra/friction-measurement")` is how a caller reaches one. A one-level scan
    here did not merely under-count them: CS_MEMORY_NAMES feeds the SessionStart banner
    AND the subagent Phase 0 block, which substitutes this list for the
    memory(action="list") call — so a namespaced memory was unreachable by any route
    from a subagent. Ordering is asserted too, because detect.mjs is a hand-maintained
    twin and the interleave (recurse where the directory sorts, not after all files) is
    the part that would drift silently.
    """
    mem_dir = tmp_path / ".codescout" / "memories"
    _write(mem_dir / "alpha.md", "")
    _write(mem_dir / "infra" / "friction.md", "")
    _write(mem_dir / "infra" / "headroom.md", "")
    _write(mem_dir / "research" / "agents.md", "")
    _write(mem_dir / "zeta.md", "")

    out = _detect(tmp_path)

    assert out["HAS_CS_MEMORIES"] == "true"
    assert out["CS_MEMORY_NAMES"].split() == [
        "alpha",
        "infra/friction",
        "infra/headroom",
        "research/agents",
        "zeta",
    ]
    assert out["CS_MEMORY_NAMES"].endswith(" ")


def test_a_namespace_holding_no_markdown_advertises_nothing(tmp_path: Path) -> None:
    """Recursing must not invent a topic for the directory itself.

    The pre-fix guard skipped directories wholesale, which was wrong but never produced
    a bogus name. Widening the walk creates that possibility, so it is pinned: an empty
    namespace, and one holding only non-markdown, both contribute zero.
    """
    mem_dir = tmp_path / ".codescout" / "memories"
    _write(mem_dir / "alpha.md", "")
    _write(mem_dir / "infra" / "notes.txt", "")
    _write(mem_dir / "infra" / "friction.anchors.toml", "")
    (mem_dir / "empty-ns").mkdir(parents=True, exist_ok=True)

    out = _detect(tmp_path)

    assert out["CS_MEMORY_NAMES"].split() == ["alpha"]


def test_a_symlinked_namespace_is_skipped_not_followed(tmp_path: Path) -> None:
    """Symlinks are skipped, matching walkdir's no-follow default.

    Not a style choice: detect runs in the SessionStart hook, and a symlink cycle under
    memories/ would hang the session before it starts. Skipping makes the cycle
    unreachable rather than merely unlikely, which is why it is a test and not a comment.
    """
    mem_dir = tmp_path / ".codescout" / "memories"
    _write(mem_dir / "alpha.md", "")
    real = tmp_path / "elsewhere"
    _write(real / "ghost.md", "")
    try:
        (mem_dir / "linked").symlink_to(real, target_is_directory=True)
    except (OSError, NotImplementedError):  # pragma: no cover - platform without symlinks
        pytest.skip("symlinks unavailable on this platform")

    out = _detect(tmp_path)

    assert out["CS_MEMORY_NAMES"].split() == ["alpha"]


def test_the_two_detect_twins_agree_on_memory_names(tmp_path: Path) -> None:
    """detect.mjs and detect.py are hand-maintained twins and NOTHING compared them.

    detect.mjs carries a comment asserting "parity with detect.py". That assertion was
    never executed, so the two could drift and only a live session would notice — which
    is how the namespaced-memory gap survived: the fix has to land in both, and the
    ordering rule (recurse where the directory sorts, not after all files) is expressible
    two ways that agree on flat fixtures and disagree the moment a namespace appears.

    Scoped deliberately to CS_MEMORY_NAMES rather than the whole payload: the two emit
    different formats on purpose (JSON vs shell KEY=VALUE for detect-tools.sh), so a
    whole-output diff compares serialisation, not behaviour, and reads as a failure when
    nothing is wrong.
    """
    mem_dir = tmp_path / ".codescout" / "memories"
    _write(mem_dir / "alpha.md", "")
    _write(mem_dir / "infra" / "friction.md", "")
    _write(mem_dir / "infra" / "nested" / "deep.md", "")
    _write(mem_dir / "research" / "agents.md", "")
    _write(mem_dir / "zeta.md", "")

    detect_mjs = REPO_ROOT / "codescout-companion" / "hooks" / "detect.mjs"
    fake_home = tmp_path / "_home"
    fake_home.mkdir(exist_ok=True)
    try:
        proc = subprocess.run(
            ["node", str(detect_mjs)],
            env={"PATH": os.environ.get("PATH", ""), "CWD": str(tmp_path), "HOME": str(fake_home)},
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):  # pragma: no cover
        pytest.skip("node unavailable")

    assert proc.returncode == 0, f"detect.mjs failed: {proc.stderr}"
    js = json.loads(proc.stdout)["CS_MEMORY_NAMES"]
    py = _detect(tmp_path, home=fake_home)["CS_MEMORY_NAMES"]

    # Named explicitly rather than only compared, so a failure says WHICH shape is right.
    expected = "alpha infra/friction infra/nested/deep research/agents zeta "
    assert py == expected
    assert js == py


def test_system_prompt_multiline_unicode(tmp_path: Path) -> None:
    """Multi-line content with quotes and unicode survives the round trip."""
    prompt = "Line 1\n\"quoted\"\nUnicode: éàü 中文\n"
    _write(tmp_path / ".codescout" / "system-prompt.md", prompt)
    out = _detect(tmp_path)
    assert out["HAS_CS_SYSTEM_PROMPT"] == "true"
    assert out["CS_SYSTEM_PROMPT"] == prompt


def test_routing_block_reads_false_string_form(tmp_path: Path) -> None:
    """block_reads accepts both literal false and string 'false'."""
    _write(tmp_path / ".claude" / "codescout-companion.json", json.dumps({
        "server_name": "x",
        "block_reads": "false",
    }))
    out = _detect(tmp_path)
    assert out["BLOCK_READS"] == "false"


def test_claude_config_dir_overrides_home_lookup(tmp_path: Path) -> None:
    """When CLAUDE_CONFIG_DIR is set, $HOME/.claude.json must NOT be probed."""
    real_home = tmp_path / "home"
    _write(real_home / ".claude.json", json.dumps({
        "mcpServers": {"home-server": {"command": "/bin/codescout"}}
    }))
    explicit_dir = tmp_path / "explicit-empty"
    explicit_dir.mkdir()

    out = _detect(tmp_path, home=real_home, claude_config_dir=explicit_dir)
    assert out["HAS_CODESCOUT"] == "false"


def test_home_fallback_when_claude_config_dir_unset(tmp_path: Path) -> None:
    """Without CLAUDE_CONFIG_DIR, $HOME/.claude.json IS probed."""
    real_home = tmp_path / "home"
    _write(real_home / ".claude.json", json.dumps({
        "mcpServers": {"home-server": {"command": "/bin/codescout"}}
    }))
    out = _detect(tmp_path, home=real_home, claude_config_dir=None)
    assert out["HAS_CODESCOUT"] == "true"
    assert out["CS_SERVER_NAME"] == "home-server"


def test_binary_tilde_expanded(tmp_path: Path) -> None:
    fake_home = tmp_path / "fake-home"
    _write(tmp_path / ".mcp.json", json.dumps({
        "mcpServers": {"x": {"command": "~/bin/codescout"}}
    }))
    out = _detect(tmp_path, home=fake_home)
    assert out["CS_BINARY"] == str(fake_home / "bin" / "codescout")


def test_shell_emit_is_eval_safe(tmp_path: Path) -> None:
    """Verify shell output is eval-able and round-trips multi-line content."""
    prompt = "line1\n'single quoted'\n\"double quoted\"\n"
    _write(tmp_path / ".codescout" / "system-prompt.md", prompt)

    proc = subprocess.run(
        [sys.executable, str(DETECT_PY)],
        env={"CWD": str(tmp_path), "HOME": "/none", "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        check=True,
    )

    # Build a tiny script: eval the output, then echo back CS_SYSTEM_PROMPT.
    eval_test = f"eval '{proc.stdout.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\nprintf %s \"$CS_SYSTEM_PROMPT\""
    bash_proc = subprocess.run(
        ["bash", "-c", eval_test],
        capture_output=True,
        text=True,
        check=True,
    )
    assert bash_proc.stdout == prompt


@pytest.mark.parametrize("value", ["", "x", "with spaces", "with'quote", "newline\nhere"])
def test_shlex_quote_round_trip(value: str) -> None:
    """Sanity: shlex.quote produces something bash will unquote to the original."""
    quoted = shlex.quote(value)
    proc = subprocess.run(
        ["bash", "-c", f"X={quoted}; printf %s \"$X\""],
        capture_output=True,
        text=True,
        check=True,
    )
    assert proc.stdout == value
