"""Deterministic bodhisattva hatching using FNV-1a + Mulberry32.

Pure functions only — no I/O, no LLM calls, no file access.
"""

FNV_OFFSET_BASIS = 0x811c9dc5
FNV_PRIME = 0x01000193
UINT32_MASK = 0xffffffff


def fnv1a(text: str) -> int:
    """FNV-1a 32-bit hash of a string."""
    h = FNV_OFFSET_BASIS
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * FNV_PRIME) & UINT32_MASK
    return h


def mulberry32(seed: int):
    """Mulberry32 PRNG. Returns a callable that yields floats in [0, 1)."""
    state = [seed & UINT32_MASK]

    def next_value() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & UINT32_MASK
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & UINT32_MASK
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & UINT32_MASK)) & UINT32_MASK
        return ((t ^ (t >> 14)) & UINT32_MASK) / 4294967296

    return next_value


FORMS = (
    "owl-of-clear-seeing",
    "doe-of-gentle-attention",
    "turtle-of-slow-breath",
    "hare-of-present-moment",
    "lotus-of-floating-calm",
    "flag-sprite-of-wind-clarity",
    "cloud-spirit-of-open-hands",
    "bell-sprite-of-soft-signal",
    "stone-cub-of-unshaken",
    "sky-fox-of-vast-witness",
)

SALT = "buddy-bodhisattva-v1"


def roll_form(user_id: str) -> str:
    """Deterministically pick a bodhisattva form from a user identifier."""
    key = user_id + SALT
    seed = fnv1a(key)
    prng = mulberry32(seed)
    index = int(prng() * len(FORMS))
    return FORMS[index]
