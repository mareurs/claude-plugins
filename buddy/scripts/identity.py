"""Identity file helpers for the buddy plugin.

Identity is written once on first /buddy:check. Until then, the statusline
uses a deterministic fallback name computed from the rolled form + user_id.
"""
import json
from pathlib import Path

from scripts.bones import roll_form, fnv1a

IDENTITY_VERSION = 1

_SYLLABLES_A = ("Lin", "Mei", "Tan", "Nor", "Zen", "Ri", "Kai", "Yu")
_SYLLABLES_B = ("-ka", "-ra", "-do", "-mi", "-so", "-va", "-ta", "-nu")

_FALLBACK_PERSONALITIES = {
    "owl-of-clear-seeing":       "watches silently, sees what others miss",
    "doe-of-gentle-attention":   "present, soft-eyed, slow to startle",
    "turtle-of-slow-breath":     "unhurried, carries its calm with it",
    "hare-of-present-moment":    "alert in the now, never looking back",
    "lotus-of-floating-calm":    "rooted in mud, unmoved by the water",
    "flag-sprite-of-wind-clarity": "reads what the wind has already said",
    "cloud-spirit-of-open-hands": "gives shape without holding form",
    "bell-sprite-of-soft-signal": "rings once when attention is needed",
    "stone-cub-of-unshaken":     "still as the mountain, patient as stone",
    "sky-fox-of-vast-witness":   "sees the whole valley from the peak",
}


def fallback_name(form: str, user_id: str) -> str:
    """Deterministic pseudo-name used until formal hatch."""
    h = fnv1a(form + "|" + user_id)
    a = _SYLLABLES_A[h % len(_SYLLABLES_A)]
    b = _SYLLABLES_B[(h >> 8) % len(_SYLLABLES_B)]
    return a + b


def load_identity(path: Path, user_id: str) -> dict:
    """Load identity.json. On missing/corrupt, return a fallback hatched=False."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("version") == IDENTITY_VERSION:
            data["hatched"] = True
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass

    form = roll_form(user_id)
    return {
        "version": IDENTITY_VERSION,
        "form": form,
        "name": fallback_name(form, user_id),
        "personality": _FALLBACK_PERSONALITIES.get(form, "watches in silence"),
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
