"""Shape validation for data/bodhisattvas.json and data/environment.json."""
import json
from pathlib import Path

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
