"""Shape validation for data/bodhisattvas.json and data/environment.json."""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent

REQUIRED_MOODS = {
    "flow", "stuck", "test-streak", "late-night", "full-context",
    "long-session", "victorious", "exploratory", "idle", "racing",
    "drifting", "broken",
}

EXPECTED_FORMS = {
    "owl-of-clear-seeing", "doe-of-gentle-attention", "turtle-of-slow-breath",
    "hare-of-present-moment", "lotus-of-floating-calm",
    "flag-sprite-of-wind-clarity", "cloud-spirit-of-open-hands",
    "bell-sprite-of-soft-signal", "stone-cub-of-unshaken",
    "sky-fox-of-vast-witness",
}


def test_bodhisattvas_json_shape():
    data = json.loads((ROOT / "data/bodhisattvas.json").read_text())
    assert set(data.keys()) == EXPECTED_FORMS, "unexpected forms"
    for form_name, form in data.items():
        assert "base" in form and isinstance(form["base"], str)
        assert "label" in form and isinstance(form["label"], str)
        assert "{eyes}" in form["base"]
        assert "{env}" in form["base"]
        assert set(form["eyes"].keys()) == REQUIRED_MOODS, (
            f"{form_name} missing moods: {REQUIRED_MOODS - set(form['eyes'].keys())}"
        )


def test_environment_json_shape():
    data = json.loads((ROOT / "data/environment.json").read_text())
    assert set(data.keys()) == REQUIRED_MOODS, (
        f"environment missing moods: {REQUIRED_MOODS - set(data.keys())}"
    )
    for mood, strip in data.items():
        assert isinstance(strip, str)





@pytest.mark.parametrize("command_file", ["summon.md", "dismiss.md", "introspect.md"])
def test_every_skill_directory_has_a_routing_entry_in(command_file):
    """Each skills/<dir>/SKILL.md must be reachable from every routing-table command."""
    skills_root = ROOT / "skills"
    cmd_md = (ROOT / "commands" / command_file).read_text()

    skill_dirs = [
        d.name for d in skills_root.iterdir()
        if d.is_dir() and (d / "SKILL.md").is_file()
    ]
    assert skill_dirs, "no skill directories found"

    missing = [d for d in skill_dirs if f"`{d}`" not in cmd_md]
    assert not missing, (
        f"skill directories with no routing entry in {command_file}: {missing}. "
        f"Add a row to commands/{command_file} routing table."
    )
