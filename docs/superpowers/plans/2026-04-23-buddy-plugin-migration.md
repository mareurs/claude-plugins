# Buddy Plugin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `buddy` symlink in `claude-plugins` with a real directory, register it as a first-class plugin, bump version to 0.1.2, update all external references, and delete the old source repo.

**Architecture:** Flat copy (no history preservation) — remove symlink, copy source files excluding dev artifacts, update version and README, update both installed_plugins.json records and statusLine config, then delete the original. `marketplace.json` already contains a buddy entry — no change needed there.

**Tech Stack:** bash, jq, python3 (for JSON edits)

---

### Task 1: Replace symlink with real directory

**Files:**
- Delete: `buddy` (symlink)
- Create: `buddy/` (real directory, copy of `/home/marius/agents/buddy-plugin`)

- [ ] **Step 1: Verify current state**

```bash
ls -la buddy
# Expected: buddy -> /home/marius/agents/buddy-plugin
```

- [ ] **Step 2: Copy source files, removing symlink**

```bash
cp -r /home/marius/agents/buddy-plugin buddy-tmp
rm buddy
mv buddy-tmp buddy
```

- [ ] **Step 3: Remove dev artifacts from copy**

```bash
find buddy -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
find buddy -name "*.pyc" -delete 2>/dev/null || true
```

- [ ] **Step 4: Verify directory looks correct**

```bash
ls buddy/
# Expected: .claude-plugin/ commands/ data/ docs/ hooks/ scripts/ skills/ pyproject.toml README.md CLAUDE.md
```

---

### Task 2: Add .buddy/ to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .buddy/ entry**

Open `.gitignore` and append:
```
.buddy/
```

- [ ] **Step 2: Verify**

```bash
grep ".buddy" .gitignore
# Expected: .buddy/
```

---

### Task 3: Bump buddy version and update README

**Files:**
- Modify: `buddy/.claude-plugin/plugin.json` (version field)
- Modify: `README.md` (version table)

- [ ] **Step 1: Bump version in plugin.json**

In `buddy/.claude-plugin/plugin.json`, change:
```json
"version": "0.1.1"
```
to:
```json
"version": "0.1.2"
```

- [ ] **Step 2: Add buddy to README.md version table**

In `README.md`, in the `## Available Plugins` version table, add a row after `claude-statusline`:
```markdown
| **[buddy](./buddy/)** | 0.1.2 | Himalayan-aesthetic bodhisattva companion: 9 specialist masters on demand, AI judge, focus tracking, statusline integration |
```

- [ ] **Step 3: Run check-versions.sh**

```bash
./scripts/check-versions.sh
# Expected output includes:
# OK: buddy 0.1.2
# All versions consistent.
```

---

### Task 4: Update installed_plugins.json (both instances)

**Files:**
- Modify: `~/.claude/plugins/installed_plugins.json`
- Modify: `~/.claude-sdd/plugins/installed_plugins.json`

- [ ] **Step 1: Update ~/.claude/plugins/installed_plugins.json**

Find the `buddy@sdd-misc-plugins` entry and update `installPath` and `version`:

```python
import json

path = '/home/marius/.claude/plugins/installed_plugins.json'
d = json.load(open(path))
entry = d['plugins']['buddy@sdd-misc-plugins'][0]
entry['version'] = '0.1.2'
entry['installPath'] = '/home/marius/.claude/plugins/cache/sdd-misc-plugins/buddy/0.1.2'
json.dump(d, open(path, 'w'), indent=2)
print("done")
```

Run: `python3 -c "<above code>"`

- [ ] **Step 2: Update ~/.claude-sdd/plugins/installed_plugins.json**

```python
import json

path = '/home/marius/.claude-sdd/plugins/installed_plugins.json'
d = json.load(open(path))
entry = d['plugins']['buddy@sdd-misc-plugins'][0]
entry['version'] = '0.1.2'
entry['installPath'] = '/home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.2'
json.dump(d, open(path, 'w'), indent=2)
print("done")
```

Run: `python3 -c "<above code>"`

- [ ] **Step 3: Verify both files**

```bash
python3 -c "import json; d=json.load(open('/home/marius/.claude/plugins/installed_plugins.json')); print(d['plugins']['buddy@sdd-misc-plugins'][0]['version'], d['plugins']['buddy@sdd-misc-plugins'][0]['installPath'])"
# Expected: 0.1.2 /home/marius/.claude/plugins/cache/sdd-misc-plugins/buddy/0.1.2

python3 -c "import json; d=json.load(open('/home/marius/.claude-sdd/plugins/installed_plugins.json')); print(d['plugins']['buddy@sdd-misc-plugins'][0]['version'], d['plugins']['buddy@sdd-misc-plugins'][0]['installPath'])"
# Expected: 0.1.2 /home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.2
```

---

### Task 5: Update statusLine in ~/.claude-sdd/settings.json

**Files:**
- Modify: `~/.claude-sdd/settings.json`

- [ ] **Step 1: Update statusLine command path**

```python
import json

path = '/home/marius/.claude-sdd/settings.json'
d = json.load(open(path))
d['statusLine']['command'] = 'bash /home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.2/scripts/statusline-composed.sh'
json.dump(d, open(path, 'w'), indent=2)
print("done")
```

Run: `python3 -c "<above code>"`

- [ ] **Step 2: Verify**

```bash
python3 -c "import json; d=json.load(open('/home/marius/.claude-sdd/settings.json')); print(d['statusLine']['command'])"
# Expected: bash /home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.2/scripts/statusline-composed.sh
```

---

### Task 6: Commit

**Files:** all staged changes in `claude-plugins`

- [ ] **Step 1: Run tests**

```bash
./tests/run-all.sh
# Expected: all tests pass (exit 0)
```

- [ ] **Step 2: Stage and commit**

```bash
git add buddy/ .gitignore README.md
git commit -m "chore: migrate buddy plugin into repo, bump to 0.1.2"
```

- [ ] **Step 3: Push**

```bash
git push
```

---

### Task 7: Delete old source repo and restart

- [ ] **Step 1: Delete old source directory**

```bash
rm -rf /home/marius/agents/buddy-plugin
```

- [ ] **Step 2: Verify symlink is gone and new dir is real**

```bash
file buddy
# Expected: buddy: directory  (NOT "symbolic link")
ls /home/marius/agents/buddy-plugin 2>&1
# Expected: No such file or directory
```

- [ ] **Step 3: Restart both Claude Code instances**

Restart the main Claude Code instance and the `~/.claude-sdd` instance. On next start, Claude Code will reseed the cache at the new `0.1.2` installPath from `claude-plugins/buddy/`.
