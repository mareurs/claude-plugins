from pathlib import Path


COMMAND = Path(__file__).resolve().parents[1] / "commands" / "summon.md"


def test_hook_payload_fast_path_names_the_codex_file_reader():
    fast_path = COMMAND.read_text().split("## Step 1", 1)[0]

    assert "mcp__codescout__read_file" in fast_path
    assert "start_line=1" in fast_path
    assert "force=true" in fast_path
    assert "until EOF" in fast_path
    assert "do not use a shell" in fast_path
    assert "In Claude Code, use `Read`" in fast_path
    assert "native `Read`" not in fast_path
