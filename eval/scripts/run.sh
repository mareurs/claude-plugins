#!/usr/bin/env bash
# eval/scripts/run.sh — run the full eval on one specialist
#
# Reads every fixture under eval/fixtures/<specialist>/ and feeds each through
# the candidate generator and the judge panel. Outputs scored results to
# eval/baselines/<date>/<specialist>/.
#
# Usage:
#   ./run.sh <specialist> [--output PATH]
#
# Env required:
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
#
# Prereqs:
#   promptfoo CLI on PATH (npm i -g promptfoo)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EVAL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(cd "$EVAL_DIR/.." && pwd)

specialist="${1:-}"
shift || true

# Optional --output PATH override (for variance-floor.sh)
override_output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) override_output="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$specialist" ]]; then
  echo "Usage: $0 <specialist> [--output PATH]" >&2
  echo "Available specialists:" >&2
  if [[ -d "$EVAL_DIR/fixtures" ]]; then
    for d in "$EVAL_DIR/fixtures"/*/; do
      [[ -d "$d" ]] && echo "  $(basename "$d")" >&2
    done
  fi
  exit 2
fi

fixtures_dir="$EVAL_DIR/fixtures/$specialist"
if [[ ! -d "$fixtures_dir" ]]; then
  echo "No fixtures for specialist: $specialist" >&2
  echo "Expected: $fixtures_dir" >&2
  exit 2
fi

# Env preflight
for var in ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing env var: $var" >&2
    echo "Set all three API keys before running eval." >&2
    exit 3
  fi
done

if ! command -v promptfoo >/dev/null 2>&1; then
  echo "promptfoo not on PATH. Install: npm i -g promptfoo" >&2
  exit 3
fi

# Verify required artifacts exist
for f in "$EVAL_DIR/promptfoo.yaml" \
         "$EVAL_DIR/judge/prompt.md" \
         "$EVAL_DIR/judge/panel.yaml" \
         "$EVAL_DIR/judge/rubrics/$specialist.md" \
         "$REPO_DIR/buddy/skills/$specialist/SKILL.md"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required file: $f" >&2
    exit 2
  fi
done

date_tag=$(date -u +%Y-%m-%d)
out_dir="$EVAL_DIR/baselines/$date_tag/$specialist"
mkdir -p "$out_dir"
output_path="${override_output:-$out_dir/scores.json}"

echo ">>> Running eval for specialist: $specialist"
echo ">>> Output: $output_path"

cd "$EVAL_DIR"

# Promptfoo invocation. Variables substituted into the candidate prompt template
# (eval/promptfoo.yaml § prompts) and into the judge prompt template
# (eval/judge/prompt.md) via the assertion config.
#
# NOTE: --vars syntax may need adjustment for the installed Promptfoo version.
# Verify on first run. The substitution semantics that matter:
#   - {{ specialist }}                  → "$specialist"
#   - {{ specialist_skill_md }}         → contents of SKILL.md
#   - {{ specialist_method_reference }} → contents of rubrics/<specialist>.md
#   - {{ user_message }}                → from each fixture
#   - {{ candidate_response }}          → captured generator output
promptfoo eval \
  --config "$EVAL_DIR/promptfoo.yaml" \
  --tests "$fixtures_dir" \
  --vars "specialist=$specialist" \
  --output "$output_path" \
  "$@"

echo ">>> Done. Scores: $output_path"
