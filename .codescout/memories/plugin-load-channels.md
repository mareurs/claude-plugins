# Plugin load channels

## Plugin Install Path (directory-source gotcha)

> **Measured correction, 2026-08-26 — then narrowed 2026-09-01. Read both halves.**
> `sdd-misc-plugins` is registered as a `directory` source whose `installLocation` is the
> repo itself, and **for hooks** `CLAUDE_PLUGIN_ROOT` resolves to `<repo>/<plugin>` at
> runtime — verified in `.buddy/.session-start-trace.log`, where every entry reads
> `plugin_root=/home/marius/work/claude/claude-plugins/buddy`, including ones written after
> `installPath` had been repointed at a cache dir. That measurement stands, and it is
> **about hooks**.
>
> **It does NOT generalise to skills, and the 2026-08-26 wording that said "content is
> served from the working tree" was wrong for them.** Measured 2026-09-01: after splitting
> `reconnaissance/SKILL.md` from 44,375 B to 13,680 B, an invocation in the editing session
> was served **44,673 B** — byte-identical to
> `~/.claude-kat/plugins/cache/sdd-misc-plugins/codescout-companion/1.19.11/skills/reconnaissance/SKILL.md`,
> which is exactly where that profile's `installPath` points. The injected text contained
> strings the working tree no longer held, so it cannot have come from the working tree.
>
> So, per channel:
>
> | what | resolves via | freshness |
> |---|---|---|
> | hooks | `CLAUDE_PLUGIN_ROOT` → repo working tree | edit is live immediately |
> | skills / commands | `installPath` → versioned cache dir | needs a release + restart |
>
> Same file, two channels: `buddy/scripts/reload.py::find_skill_md` scope 5 reads
> `<repo>/<other-plugin>/skills/<dir>/SKILL.md` per invocation, so buddy's compact-reload
> block serves the **new** copy of a skill while CC's Skill tool serves the **cached** one.
>
> Practical consequence: **a skill or command edit is `committed`, not `live`, until
> `release.sh` seeds a new cache dir and repoints the install records.** The editing
> session is the least representative observer of this — it is the one most likely to
> believe the edit shipped. Probe `plugin_root` in the trace log for hook freshness; probe
> the served bytes against `installPath` for skill freshness.
> (`docs/trackers/skill-loading-session-log.md` F-5.)

Claude Code freezes `installPath` + `version` in `~/.claude/plugins/installed_plugins.json`
at install time. For directory-source plugins (marketplace `source: directory`), the
`installPath` points to the source folder — but commands and hooks are read from `installPath`,
so **new components added after initial install are invisible until the record is updated**.

**After adding a new component type (e.g. `commands/`) or bumping the version, update the
install record to point at the new cache snapshot:**

```bash
# Check the latest cache version
ls ~/.claude/plugins/cache/sdd-misc-plugins/codescout-companion/

# Edit installed_plugins.json: update installPath + version to the new cache entry
~/.claude/plugins/installed_plugins.json
# → "installPath": "~/.claude/plugins/cache/sdd-misc-plugins/codescout-companion/<version>"
# → "version": "<version>"
```

Then restart Claude Code.

