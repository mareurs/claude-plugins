#!/usr/bin/env bash
# tests/test-claude-md-citations.sh — every `CLAUDE.md § <name>` citation in a live file
# must name a heading of the root CLAUDE.md, and CLAUDE.md must keep its code fences clean.
#
# Why: scripts, tests, memories and comments cite sections of CLAUDE.md by name. A heading
# that is renamed or removed leaves those citations pointing at nothing, and nothing else
# notices (measured 2026-11-24: "§ Testing Discipline" had no heading). A code fence left
# open swallows every heading below it, so the fence check guards the same contract.
#
# Scope: live files only. History (docs/trackers, docs/issues, docs/superpowers) cites
# headings as they were when written, so it is out of scope. buddy/CLAUDE.md:60 says
# "the repo-root CLAUDE.md", so every citation here is read against the root file.
#
# A citation is `CLAUDE.md`, up to 12 characters that are not `§`, then `§`, then the name:
# the following run of letters, digits, spaces and hyphens. `§ A, § B and § C` after one
# `CLAUDE.md` is three citations. It resolves when the name equals a heading, or a heading
# begins with the name and the next character is not a letter or digit. Headings inside
# code fences do not count. Shapes this does not read (accepted limits): `§ X in CLAUDE.md`
# (§ first), more than 12 characters before `§`, and a name in parentheses or single quotes.
# The name runs to the first character that is not a letter, digit, space or hyphen, so a
# name followed by plain words ("§ Testing for details") reads as one long name and does not
# resolve: end a citation with punctuation.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDEMD="$ROOT/CLAUDE.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── claude-md-citations ──"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/check.py" <<'PY'
import os, re, sys

def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[*`"_]', '', s.lower())).strip(' -')

def scan(path):
    """(headings outside code fences, fences clean). A fence line that carries text
    inside an open fence, or a fence still open at the end, makes the fences unclean."""
    heads, fence, clean = [], False, True
    for line in open(path, encoding='utf-8'):
        s = line.rstrip('\n')
        if not fence:
            if re.match(r'^ *```', s):
                fence = True
                continue
            m = re.match(r'^#{1,6} +(.*)$', s)
            if m:
                heads.append(norm(m.group(1)))
        elif re.match(r'^ *```\s*$', s):
            fence = False
        elif re.match(r'^ *```', s):
            clean = False
    return heads, clean and not fence

CIT = re.compile(r'CLAUDE\.md[^§\n]{0,12}§')
NAME = re.compile(r'[ "*_`]*([A-Za-z0-9][A-Za-z0-9 -]*)')
SEP = re.compile(r'[*"`_)]*\s*(?:,|and|or)?\s*§')

def citations(line):
    for m in CIT.finditer(line):
        pos = m.end()
        while True:
            n = NAME.match(line, pos)
            if not n:
                break
            yield re.sub(r'\s+(and|or)\s*$', '', n.group(1)).strip(' -')
            s = SEP.match(line, n.end())
            if not s:
                break
            pos = s.end()

def resolves(name, heads):
    n = norm(name)
    return bool(n) and any(h == n or re.match(re.escape(n) + r'(?![a-z0-9])', h) for h in heads)

SKIP = {'__pycache__', 'node_modules', 'target', '.git', '.history'}
def files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for d, ds, fs in os.walk(p):
            ds[:] = [x for x in ds if x not in SKIP]
            for f in fs:
                if f != 'test-claude-md-citations.sh':
                    yield os.path.join(d, f)

mode, doc = sys.argv[1], sys.argv[2]
heads, clean = scan(doc)
if mode == 'fences':
    sys.exit(0 if clean else 1)
for f in files(sys.argv[3:]):
    try:
        lines = open(f, encoding='utf-8', errors='ignore').read().split('\n')
    except OSError:
        continue
    for i, line in enumerate(lines, 1):
        for name in citations(line):
            if not resolves(name, heads):
                print(f"{f}:{i}: § {name}")
PY
fences() { python3 -I "$T/check.py" fences "$1"; }                 # doc -> rc 0 when clean
cites()  { python3 -I "$T/check.py" cites "$1" "${@:2}"; }         # doc paths... -> unresolved citations

# --- the real file ------------------------------------------------------------------------
if fences "$CLAUDEMD"; then ok "CLAUDE.md code fences are clean"; else bad "CLAUDE.md code fences are clean" "a fence is left open or opens inside another"; fi

cd "$ROOT" || exit 1
LIVE=()
for p in scripts tests .github AGENTS.md buddy/CLAUDE.md buddy/scripts buddy/pyproject.toml \
         codescout-companion/hooks .codescout/memories .codescout/system-prompt.md docs/templates; do
  [ -e "$p" ] && LIVE+=("$p")
done
MISSING="$(cites "$CLAUDEMD" "${LIVE[@]}")"
if [ -z "$MISSING" ]; then ok "every CLAUDE.md § citation resolves"; else bad "every CLAUDE.md § citation resolves" "$(printf '%s' "$MISSING" | tr '\n' ';')"; fi

# --- controls: each must fail without its guard ---------------------------------------------
c() { printf '%s\n' "$2" > "$T/$1.txt"; }
c missing 'see CLAUDE.md § No Such Heading.'
[ -n "$(cites "$CLAUDEMD" "$T/missing.txt")" ] && ok "control: a citation to a missing heading fails" || bad "control: missing heading" "accepted"
c valid 'see CLAUDE.md § Testing.'
[ -z "$(cites "$CLAUDEMD" "$T/valid.txt")" ] && ok "control: a valid citation in a single file passes" || bad "control: valid single-file citation" "reported unresolved: $(cites "$CLAUDEMD" "$T/valid.txt")"
c partial 'see CLAUDE.md § Test.'
[ -n "$(cites "$CLAUDEMD" "$T/partial.txt")" ] && ok "control: a partial name (§ Test) fails" || bad "control: partial name" "accepted"
c list 'CLAUDE.md § Testing and § No Such Heading'
[ -n "$(cites "$CLAUDEMD" "$T/list.txt")" ] && ok "control: the second citation of a list is checked" || bad "control: list" "second citation skipped"
c listok 'CLAUDE.md § Testing, § Git Workflow and § Development.'
[ -z "$(cites "$CLAUDEMD" "$T/listok.txt")" ] && ok "control: a list of valid citations passes" || bad "control: valid list" "reported: $(cites "$CLAUDEMD" "$T/listok.txt")"
printf '```bash\n# release\n```\n\n## Real\n' > "$T/fenced.md"
c infence 'CLAUDE.md § release'
[ -n "$(cites "$T/fenced.md" "$T/infence.txt")" ] && ok "control: a heading inside a code fence does not count" || bad "control: fenced heading" "counted"
printf '```bash\nx\n``` text after the fence\n\n```json\n{}\n```\n' > "$T/openfence.md"
fences "$T/openfence.md" && bad "control: an open fence is detected" "reported clean" || ok "control: an open fence is detected"
printf '```bash\nx\n```\n\ntext\n' > "$T/cleanfence.md"
fences "$T/cleanfence.md" && ok "control: a clean fence passes" || bad "control: clean fence" "reported unclean"

echo "── claude-md-citations: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
