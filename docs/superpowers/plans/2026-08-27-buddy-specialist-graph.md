---
id: bd8d8fda04a98f77
kind: plan
status: draft
title: Buddy specialist graph — implementation plan
tags:
- buddy
- specialists
- composition
- plan
topic: buddy-specialist-graph
---

# Buddy Specialist Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make buddy specialists composable as primary + advisors, and make the hardcoded summon bundle declarable, by adding two binding kinds to the hook-side assembler that already exists.

**Architecture:** `buddy/scripts/summon_bootstrap.py` is a `UserPromptSubmit` hook whose `build_payload()` already assembles the summon payload and whose `collect_bindings()` already resolves frontmatter-declared bindings (`inject_trackers`, `inject_memory_topics`). This plan adds `fragments:` (replacing two hardcoded file reads) and `advisors:` (projected to three sections), plus a dangling-edge lint. No new resolver, notation, or walker is introduced.

**Tech Stack:** Python 3.13+, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-buddy-specialist-graph-design.md`

## Global Constraints

- **Python only, no bash** in `summon_bootstrap.py` — it must run on Windows (see `discover()`'s docstring).
- **Config paths** resolve via `buddy_paths`, never bare `$HOME/.claude` (repo CLAUDE.md § Config Dir Resolution).
- **Soft-skip missing files.** Bindings cost zero in projects that lack them; a missing fragment or advisor must never raise.
- **Default behaviour is unchanged.** A specialist declaring neither key produces today's payload byte for byte.
- **Projection sections** are exactly `## Operating Principles`, `## Heuristics`, `## Self-Traps` — matched by **prefix**, because `## Heuristics (universal)` and `## Self-Traps (Failure Modes to Avoid)` are live variants in the corpus.
- **Never projected:** `## Voice`, `## Method — Three Phases`, and any `## {{Domain}} Format` section. The primary owns those.
- Run `cd buddy && .venv/bin/pytest tests -q` after every task. `./tests/run-all.sh` before the final commit.

---

### Task 1: Pin today's payload before changing it

**Files:**
- Test: `buddy/tests/test_summon_bootstrap.py`

**Interfaces:**
- Consumes: `sb.build_payload(directory, scope, skill_dir, lens, project_root)` and the existing `plugin` fixture.
- Produces: `test_payload_is_pinned_byte_for_byte` — the regression guard Tasks 2 and 3 must keep green.

**Why this task is first and separate:** the golden must be captured from HEAD. A golden generated *after* the refactor asserts that the new code equals itself — green in every world, including one where fragments silently drop `gates.md`. This is `claude-plugins:R-5`: a check computed from the thing it judges cannot fail.

- [ ] **Step 1: Write the pinning test**

Append to `buddy/tests/test_summon_bootstrap.py`:

```python
# ------------------------------------------------- payload golden (pre-graph)

PAYLOAD_NOTE = (
    "The summon payload below was injected by buddy's prompt hook — "
    "the load steps in /buddy:summon are already done. Announce the "
    "specialist (italic arrival line) and adopt its voice for the "
    "rest of the session."
)


def test_payload_is_pinned_byte_for_byte(plugin):
    """Pins the payload build_payload produces TODAY, before fragments land.

    Captured from HEAD deliberately. A golden generated from the post-refactor
    code would assert that the new code equals itself and would stay green in a
    world where the fragment list silently drops gates.md.
    """
    plug, project = plugin
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    expected = "\n\n".join([
        "<!-- buddy:summon-payload specialist=foo-bar scope=builtin -->",
        PAYLOAD_NOTE,
        "# The Foo Bar\n\n## Voice\n\nCalm.",
        "## Memory Protocol\n\nprotocol text",
        "## Gates\n\ngates text",
    ])
    assert payload == expected
```

- [ ] **Step 2: Run it against unmodified code**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py::test_payload_is_pinned_byte_for_byte -q`
Expected: **PASS.** This test must pass before any production code changes. If it fails, the expected string is wrong — fix the test, not `summon_bootstrap.py`.

- [ ] **Step 3: Commit**

```bash
git add buddy/tests/test_summon_bootstrap.py
git commit -m "test(buddy): pin the summon payload byte-for-byte before the graph lands

Captured from HEAD on purpose. A golden generated after the fragment refactor
would assert that the new code equals itself and stay green in a world where
the fragment list silently drops gates.md (claude-plugins:R-5)."
```

---

### Task 2: `fragments:` binding kind

**Files:**
- Modify: `buddy/scripts/summon_bootstrap.py`
- Test: `buddy/tests/test_summon_bootstrap.py`

**Interfaces:**
- Consumes: `PLUGIN_ROOT`, `buddy_paths.global_root()`, `_read(path)`.
- Produces: `resolve_fragment(name: str, project_root: Path) -> Path | None`, and `DEFAULT_FRAGMENTS: tuple[str, ...]`. Task 3 relies on neither, but appends advisors **before** the fragment block.

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_summon_bootstrap.py`:

```python
# ------------------------------------------------------------- fragments

def test_default_fragments_reproduce_todays_payload(plugin):
    """No `fragments:` key → identical to the Task 1 golden."""
    plug, project = plugin
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    assert "## Memory Protocol\n\nprotocol text" in payload
    assert "## Gates\n\ngates text" in payload
    assert payload.index("## Memory Protocol") < payload.index("## Gates")


def test_explicit_fragment_list_narrows_the_payload(plugin):
    """Declaring `fragments: [gates]` drops memory-protocol."""
    plug, project = plugin
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nfragments: [gates]\n---\n\n"
        + SKILL_BODY
    )
    payload = sb.build_payload("foo-bar", "builtin", skill, None, project)
    assert "gates text" in payload
    assert "protocol text" not in payload


def test_project_fragment_shadows_builtin(plugin):
    """project > global > builtin, asserted on the PROJECT text specifically."""
    plug, project = plugin
    frag = project / ".buddy" / "fragments"
    frag.mkdir(parents=True)
    frag.joinpath("gates.md").write_text("project gates text")
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    assert "project gates text" in payload
    assert "gates text" in payload            # substring of the above; harmless
    assert "## Gates\n\ngates text" not in payload   # the BUILTIN body is gone


def test_missing_fragment_is_soft_skipped(plugin):
    plug, project = plugin
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nfragments: [nope, gates]\n---\n\n"
        + SKILL_BODY
    )
    payload = sb.build_payload("foo-bar", "builtin", skill, None, project)
    assert payload is not None
    assert "gates text" in payload
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q -k fragment`
Expected: FAIL — `test_explicit_fragment_list_narrows_the_payload` and `test_project_fragment_shadows_builtin` fail because the reads are still hardcoded. `AttributeError: module 'scripts.summon_bootstrap' has no attribute 'resolve_fragment'` will not appear yet; these are behavioural failures.

- [ ] **Step 3: Add the resolver**

In `buddy/scripts/summon_bootstrap.py`, after the `BINDING_LINE_CAP` constant:

```python
# Exactly what build_payload read before fragments existed, in that order.
# NOTE: data/cs_rules.md is deliberately absent — its only consumer is
# cs_judge.py, which embeds it in the codescout judge's system prompt. Adding
# it here would change the payload rather than preserve it.
DEFAULT_FRAGMENTS = ("memory-protocol", "gates")

FRAGMENT_TITLES = {
    "memory-protocol": "Memory Protocol",
    "gates": "Gates",
}
```

And after `discover()`:

```python
def resolve_fragment(name: str, project_root: Path) -> Path | None:
    """Resolve a fragment name across the three scopes, project first.

    Mirrors discover()'s precedence (project > global > builtin) but returns on
    first hit rather than letting later scopes overwrite, which is the same rule
    read from the other end. Returns None when no scope has it — callers
    soft-skip, because a project that lacks a fragment should cost nothing.
    """
    try:
        global_dir = buddy_paths.global_root() / "fragments"
    except Exception:
        global_dir = None
    candidates = [
        Path(project_root) / ".buddy" / "fragments" / f"{name}.md",
        (global_dir / f"{name}.md") if global_dir else None,
        PLUGIN_ROOT / "data" / f"{name}.md",
    ]
    for path in candidates:
        if path is None:
            continue
        try:
            if path.is_file():
                return path
        except OSError:
            continue
    return None
```

- [ ] **Step 4: Replace the hardcoded reads in `build_payload`**

Replace these four lines:

```python
    protocol = _read(PLUGIN_ROOT / "data" / "memory-protocol.md")
    if protocol:
        parts.append("## Memory Protocol\n\n" + protocol.strip())
    gates = _read(PLUGIN_ROOT / "data" / "gates.md")
    if gates:
        parts.append("## Gates\n\n" + gates.strip())
```

with:

```python
    declared = meta.get("fragments")
    names = declared if isinstance(declared, list) else list(DEFAULT_FRAGMENTS)
    for name in names:
        path = resolve_fragment(str(name), project_root)
        if path is None:
            continue
        text = _read(path)
        if not text:
            continue
        title = FRAGMENT_TITLES.get(str(name), str(name))
        parts.append(f"## {title}\n\n{text.strip()}")
```

- [ ] **Step 5: Run the fragment tests and the golden**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q`
Expected: PASS, **including `test_payload_is_pinned_byte_for_byte` from Task 1.** If the golden broke, the default list or its order is wrong — that is exactly what Task 1 exists to catch.

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/summon_bootstrap.py buddy/tests/test_summon_bootstrap.py
git commit -m "feat(buddy): fragments: binding kind replaces the hardcoded summon bundle

build_payload's two hardcoded reads become a scope-resolved fragment list.
Default [memory-protocol, gates] reproduces today's payload byte for byte --
the Task 1 golden is the proof, and it was captured from HEAD."
```

---

### Task 3: `advisors:` with the projection rule

**Files:**
- Modify: `buddy/scripts/summon_bootstrap.py`
- Test: `buddy/tests/test_summon_bootstrap.py`

**Interfaces:**
- Consumes: `discover(project_root)`, `strip_frontmatter(raw)`, `_read(path)`.
- Produces: `ADVISOR_SECTIONS: tuple[str, ...]`, `project_advisor(body: str, name: str) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_summon_bootstrap.py`:

```python
# -------------------------------------------------------------- advisors

ADVISOR_SKILL = (
    "---\nname: Sec Ibex\ndescription: security\n---\n\n"
    "# The Security Ibex\n\n"
    "## Voice\n\nTerse and wary.\n\n"
    "## Operating Principles\n\n1. Trust nothing inbound.\n\n"
    "## Method — Three Phases\n\n### Phase 1 — Map\n\nMap the surface.\n\n"
    "## Finding Format\n\nSEVERITY / ASSET / PATH\n\n"
    "## Heuristics (universal)\n\n1. Every input is hostile.\n\n"
    "## Self-Traps (Failure Modes to Avoid)\n\n1. Auditing only the diff.\n"
)


@pytest.fixture
def plugin_with_advisor(plugin):
    plug, project = plugin
    (plug / "skills" / "sec-ibex").mkdir(parents=True)
    (plug / "skills" / "sec-ibex" / "SKILL.md").write_text(ADVISOR_SKILL)
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nadvisors: [sec-ibex]\n---\n\n"
        "# The Foo Bar\n\n## Voice\n\nCalm.\n\n"
        "## Test Format\n\nGIVEN / WHEN / THEN\n"
    )
    return plug, project


def _advised(sb_mod, plug, project):
    return sb_mod.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )


def test_advisor_contributes_its_projected_sections(plugin_with_advisor, monkeypatch):
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "sec-ibex": ("builtin", plug / "skills" / "sec-ibex"),
    })
    payload = _advised(sb, plug, project)
    assert "Trust nothing inbound." in payload
    assert "Every input is hostile." in payload
    assert "Auditing only the diff." in payload
    assert "advisor: sec-ibex" in payload


def test_advisor_voice_and_output_contract_are_NOT_projected(
    plugin_with_advisor, monkeypatch
):
    """LOAD-BEARING, and it looks redundant with the test above. It is not.

    A contains-check for the advisor's heuristics passes just as well if the
    WHOLE advisor file was appended. These exclusions are the only assertions
    that distinguish projection from concatenation. Deleting them re-opens a
    check that cannot fail (claude-plugins:W-4).
    """
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "sec-ibex": ("builtin", plug / "skills" / "sec-ibex"),
    })
    payload = _advised(sb, plug, project)
    assert "Terse and wary." not in payload          # advisor Voice
    assert "SEVERITY / ASSET / PATH" not in payload  # advisor output contract
    assert "Map the surface." not in payload         # advisor Method
    assert payload.count("## Test Format") == 1      # primary's, exactly once
    assert "Calm." in payload                        # primary Voice survives


def test_unresolvable_advisor_is_soft_skipped(plugin_with_advisor, monkeypatch):
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
    })
    payload = _advised(sb, plug, project)
    assert payload is not None
    assert "Calm." in payload


def test_project_advisor_matches_heading_variants():
    body = (
        "## Heuristics (universal)\n\nH text\n\n"
        "## Self-Traps (Failure Modes to Avoid)\n\nS text\n\n"
        "## Voice\n\nV text\n"
    )
    out = sb.project_advisor(body, "x")
    assert "H text" in out and "S text" in out
    assert "V text" not in out
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q -k advisor`
Expected: FAIL with `AttributeError: module 'scripts.summon_bootstrap' has no attribute 'project_advisor'`.

- [ ] **Step 3: Add the projection helper**

In `buddy/scripts/summon_bootstrap.py`, after `resolve_fragment`:

```python
# Prefix-matched, not equality: `## Heuristics (universal)` and
# `## Self-Traps (Failure Modes to Avoid)` are live variants in the corpus.
ADVISOR_SECTIONS = (
    "## Operating Principles",
    "## Heuristics",
    "## Self-Traps",
)


def project_advisor(body: str, name: str) -> str:
    """Keep only the advisor-role sections of a specialist body.

    Voice, Method and the `{{Domain}} Format` section are never projected — the
    primary owns the voice and the output contract, which is what makes
    composition collision-free by construction rather than by merge rules.
    Each kept heading is tagged with its origin so the primary's own sections
    are never shadowed and every line is attributable.
    """
    out: list[str] = []
    current: list[str] | None = None
    for line in body.splitlines():
        if line.startswith("## "):
            if current:
                out.append("\n".join(current).rstrip())
            current = (
                [f"{line} — advisor: {name}"]
                if line.startswith(ADVISOR_SECTIONS)
                else None
            )
        elif current is not None:
            current.append(line)
    if current:
        out.append("\n".join(current).rstrip())
    return "\n\n".join(out)
```

- [ ] **Step 4: Wire advisors into `build_payload`**

In `build_payload`, immediately **after** the `memories` block and **before** the fragment loop added in Task 2, insert:

```python
    declared_advisors = meta.get("advisors")
    if isinstance(declared_advisors, list) and declared_advisors:
        index = discover(project_root)
        for adv in declared_advisors:
            entry = index.get(str(adv))
            if entry is None:
                continue
            adv_raw = _read(entry[1] / "SKILL.md")
            if adv_raw is None:
                continue
            projected = project_advisor(strip_frontmatter(adv_raw), str(adv))
            if projected:
                parts.append(projected)
```

- [ ] **Step 5: Run the full file**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q`
Expected: PASS, including Task 1's golden (the fixture specialist declares no advisors, so its payload is unchanged).

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/summon_bootstrap.py buddy/tests/test_summon_bootstrap.py
git commit -m "feat(buddy): advisors: with the projection rule

An advisor contributes Operating Principles, Heuristics and Self-Traps only;
Voice, Method and the output contract stay with the primary, so composition is
collision-free by construction. Headings are tagged by origin.

The exclusion assertions are the load-bearing ones -- a contains-check for the
advisor's heuristics passes equally if the whole file was appended."
```

---

### Task 4: Dangling-edge lint

**Files:**
- Modify: `buddy/scripts/summon_bootstrap.py`
- Create: `buddy/tests/test_specialist_edges.py`
- Test: `buddy/tests/test_summon_bootstrap.py`

**Interfaces:**
- Consumes: `discover`, `resolve_fragment`, `parse_frontmatter`, `DEFAULT_FRAGMENTS`.
- Produces: nothing later tasks depend on.

**Why:** edges are names, so an advisor can name something not installed — and it fails **silently**, as content that simply does not arrive. This is the defect class that made `T-N` citations inert.

- [ ] **Step 1: Write the failing runtime-warning test**

Append to `buddy/tests/test_summon_bootstrap.py`:

```python
def test_unresolvable_advisor_emits_a_warning_line(plugin_with_advisor, monkeypatch):
    """Soft-skip must be VISIBLE. A silently missing advisor is indistinguishable
    from an advisor with nothing to say."""
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
    })
    payload = _advised(sb, plug, project)
    assert "advisor 'sec-ibex' declared but not installed" in payload
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q -k warning`
Expected: FAIL — the assertion finds no such string.

- [ ] **Step 3: Emit the warning**

In `build_payload`'s advisor loop, replace `continue` in the `entry is None` branch:

```python
            if entry is None:
                parts.append(
                    f"> advisor '{adv}' declared but not installed — "
                    f"its heuristics are absent from this payload."
                )
                continue
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd buddy && .venv/bin/pytest tests/test_summon_bootstrap.py -q`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Write the CI lint over the real corpus**

Create `buddy/tests/test_specialist_edges.py`:

```python
"""Every declared edge in every shipped specialist must resolve.

An advisor or fragment naming something that is not installed fails silently --
as content that simply does not arrive. This is the defect class that made T-N
citations inert: a name nothing validates.
"""
from pathlib import Path

from scripts import summon_bootstrap as sb
from scripts.reload import parse_frontmatter

BUILTIN = Path(sb.PLUGIN_ROOT) / "skills"


def _declared(key: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for skill in sorted(BUILTIN.iterdir()):
        md = skill / "SKILL.md"
        if not md.is_file():
            continue
        meta = parse_frontmatter(md.read_text(encoding="utf-8"))
        values = meta.get(key)
        if isinstance(values, list):
            out.extend((skill.name, str(v)) for v in values)
    return out


def test_every_declared_advisor_resolves():
    index = sb.discover(Path.cwd())
    missing = [(s, a) for s, a in _declared("advisors") if a not in index]
    assert not missing, f"advisors declared but not installed: {missing}"


def test_every_declared_fragment_resolves(tmp_path):
    missing = [
        (s, f)
        for s, f in _declared("fragments")
        if sb.resolve_fragment(f, tmp_path) is None
    ]
    assert not missing, f"fragments declared but not resolvable: {missing}"


def test_default_fragments_all_exist(tmp_path):
    """Guards the default list itself -- the one nobody declares and everybody gets."""
    missing = [f for f in sb.DEFAULT_FRAGMENTS if sb.resolve_fragment(f, tmp_path) is None]
    assert not missing, f"DEFAULT_FRAGMENTS unresolvable: {missing}"
```

- [ ] **Step 6: Run the lint**

Run: `cd buddy && .venv/bin/pytest tests/test_specialist_edges.py -q`
Expected: PASS — no shipped specialist declares an edge yet, so all three tests pass vacuously except `test_default_fragments_all_exist`, which genuinely resolves `memory-protocol` and `gates`.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/summon_bootstrap.py buddy/tests/test_summon_bootstrap.py buddy/tests/test_specialist_edges.py
git commit -m "feat(buddy): dangling-edge lint, runtime warning plus a CI test

An edge is a name, so it can name something not installed -- and it fails
silently, as content that simply does not arrive. Two guards: a visible warning
line in the payload, and a pytest walking every shipped specialist's declared
edges. test_default_fragments_all_exist guards the list nobody declares and
everybody gets."
```

---

### Task 5: Teach the fallback path, deliberately dumber

**Files:**
- Modify: `buddy/commands/summon.md` (§ "Step 2b — Load SKILL.md and lens addendum")

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**Why dumber:** the projection rule lives only in the assembler. The fallback runs only when the hook did not fire, and a fallback that tries to reproduce projection is where drift between two implementations of one contract would come from.

- [ ] **Step 1: Add the advisor paragraph**

In `buddy/commands/summon.md`, at the end of the `### Step 2b — Load SKILL.md and lens addendum` section, append:

```markdown
**Advisors (fallback only).** If the resolved `SKILL.md`'s frontmatter declares
`advisors: [name, ...]`, also `Read` each named specialist's `SKILL.md` from the
index built in Step 1. Use **only** their `## Operating Principles`,
`## Heuristics` and `## Self-Traps` sections; ignore their `## Voice`,
`## Method` and any `## ... Format` section — the primary owns the voice and the
output contract. Skip any advisor the index does not contain and say so in one
line.

This path is deliberately simpler than the hook's. When the hook fires it
assembles the projection itself (`summon_bootstrap.py::project_advisor`) and
Step 0 short-circuits this whole step.
```

- [ ] **Step 2: Verify the doc suite still passes**

Run: `./tests/run-all.sh`
Expected: all suites pass.

- [ ] **Step 3: Commit**

```bash
git add buddy/commands/summon.md
git commit -m "docs(buddy): teach the summon fallback about advisors, deliberately dumber

The projection rule lives only in the hook-side assembler. The fallback loads
advisor files and lets the model compose, as it already does with lenses -- a
fallback reproducing projection is where drift between two implementations of
one contract would come from."
```

---

### Task 6: Release

**Files:**
- Modify: `buddy/.claude-plugin/plugin.json` (via script), `README.md` (via script)

- [ ] **Step 1: Full suite**

Run: `./tests/run-all.sh && cd buddy && .venv/bin/pytest tests -q`
Expected: all green.

- [ ] **Step 2: Release**

Run: `./scripts/release.sh buddy minor`

Minor rather than patch: this adds two frontmatter keys to the specialist contract.

- [ ] **Step 3: The two steps the script cannot do**

Refresh the version-bump tracker, then verify every row:

```
artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)
artifact(action="get",    id="cc8cb9e23ab5cc67", full=true)
```

Then **cold-restart all three Claude Code instances** (`/reload-plugins`, or quit and relaunch). A `resume` is not enough. This release adds no new hook file, so registration is less critical than the 1.17.0 companion release — but `summon_bootstrap.py` is re-read at launch.

---

## Self-Review

**Spec coverage.** `advisors:` → Task 3. `fragments:` → Task 2. Projection rule → Task 3 Step 3. Scope precedence → Task 2 Step 1 (`test_project_fragment_shadows_builtin`). Dangling-edge lint, both halves → Task 4. Fallback prose + the deliberate asymmetry → Task 5. Byte-for-byte golden captured from HEAD → Task 1, first and separate. Four gating tests → Tasks 1–4. **Not in this plan, by spec:** `guides:` and `affinity:` (cut), routing (deferred), the three-arm behavioural eval (specified, not gating — it needs a separate plan and a harness).

**Placeholder scan.** No TBD/TODO. Every code step carries the code. Every test step names the exact command and expected result.

**Type consistency.** `resolve_fragment(name: str, project_root: Path) -> Path | None` is defined in Task 2 and consumed in Task 4 with that signature. `project_advisor(body: str, name: str) -> str` is defined in Task 3 and consumed only there. `DEFAULT_FRAGMENTS` is a tuple in Task 2 and iterated in Task 4. `discover()` returns `dict[str, tuple[str, Path]]`, so Task 3's `entry[1]` is the path — matching its definition.

**One gap found and closed during review:** Task 4's `test_default_fragments_all_exist` was not in the spec. It guards the fragment list nobody declares and everybody gets — the one path where a typo would silently empty every specialist's payload.

**Valid:** conditional — the design spec is superseded or withdrawn

