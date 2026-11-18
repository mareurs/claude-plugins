#!/usr/bin/env bash
# tests/test-skill-frontmatter-yaml.sh — every SKILL.md has frontmatter that parses as YAML
#
# WHY THIS EXISTS. The first session-bridge skill shipped with a plain
# (unquoted) description that contains ": ". YAML reads that as a nested mapping key and the
# frontmatter fails to parse (ScannerError), so the skill loses its name and description. No test
# noticed: the other skill tests grep the body or run its tool calls and never parse the
# frontmatter. This test parses the frontmatter of EVERY */skills/*/SKILL.md with PyYAML and
# requires a mapping with non-empty string `name` and `description`.
#
# Needs python3 and PyYAML only. A missing PyYAML FAILS (it never skips): a skipped check reads
# as "frontmatter is valid".
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

echo "── skill frontmatter YAML ──"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 present" "python3 not found"
  echo "Results: $PASS passed, $FAIL failed"; exit 1
fi
if ! python3 -I -c 'import yaml' 2>/dev/null; then
  fail "PyYAML importable" "python3 cannot import yaml; install PyYAML (this test never skips)"
  echo "Results: $PASS passed, $FAIL failed"; exit 1
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/check.py" <<'PY'
import sys
import yaml

def verdict(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return "no frontmatter: the file does not start with ---"
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return "frontmatter is not closed by a second ---"
    try:
        data = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as e:
        return "invalid YAML: " + str(e).replace("\n", " | ")
    if not isinstance(data, dict):
        return "frontmatter is not a mapping"
    for key in ("name", "description"):
        v = data.get(key)
        if not isinstance(v, str) or not v.strip():
            return "`%s` is missing, empty or not a string" % key
    return "OK"

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    print(verdict(f.read()))
PY

# Controls: the checker must reject the shipped bug and accept the quoted form.
printf '%s\n' '---' 'name: x' 'description: Use after a change: a moved branch' '---' 'body' > "$TMP/bad.md"
printf '%s\n' '---' 'name: x' 'description: "Use after a change: a moved branch"' '---' 'body' > "$TMP/good.md"
printf '%s\n' '---' 'name: x' '---' 'body' > "$TMP/nodesc.md"
case "$(python3 -I "$TMP/check.py" "$TMP/bad.md")" in
  "invalid YAML"*) pass "control: an unquoted description with ': ' is rejected" ;;
  *) fail "control: an unquoted description with ': ' is rejected" "the checker accepted it" ;;
esac
[ "$(python3 -I "$TMP/check.py" "$TMP/good.md")" = "OK" ] \
  && pass "control: the quoted form is accepted" \
  || fail "control: the quoted form is accepted" "the checker rejected it"
case "$(python3 -I "$TMP/check.py" "$TMP/nodesc.md")" in
  *description*) pass "control: a missing description is rejected" ;;
  *) fail "control: a missing description is rejected" "the checker accepted it" ;;
esac

# Population: every tracked or untracked-but-not-ignored SKILL.md under */skills/*/.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -t SKILLS < <(git -C "$ROOT" ls-files --cached --others --exclude-standard -- '*/skills/*/SKILL.md' | sort -u)
else
  mapfile -t SKILLS < <(cd "$ROOT" && find . -path '*/skills/*/SKILL.md' -not -path '*/node_modules/*' | sed 's|^\./||' | sort)
fi
if [ "${#SKILLS[@]}" -ge 2 ]; then
  pass "found ${#SKILLS[@]} SKILL.md files"
else
  fail "found SKILL.md files" "only ${#SKILLS[@]} found; discovery is broken"
fi

for f in "${SKILLS[@]}"; do
  v="$(python3 -I "$TMP/check.py" "$ROOT/$f" 2>&1)"
  if [ "$v" = "OK" ]; then
    pass "$f"
  else
    fail "$f" "$v"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
