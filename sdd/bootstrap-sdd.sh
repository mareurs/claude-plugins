#!/bin/bash
# bootstrap-sdd.sh - Simple SDD setup for new projects
#
# Usage: ./bootstrap-sdd.sh /path/to/project [stack]
#
# Stacks: base (default), kotlin, python
# Stack-specific constitutions add Articles VII-VIII for architecture & testing

set -e

PROJECT_PATH="${1:?Usage: ./bootstrap-sdd.sh /path/to/project [stack]}"
STACK="${2:-base}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Bootstrapping SDD for: $PROJECT_PATH"
echo "   Stack: $STACK"

# Create directory structure
mkdir -p "$PROJECT_PATH/memory/specs"
mkdir -p "$PROJECT_PATH/memory/plans"
mkdir -p "$PROJECT_PATH/.claude/commands"
mkdir -p "$PROJECT_PATH/.claude/skills"

# Copy constitution
if [ -f "$SCRIPT_DIR/memory/constitution.md" ]; then
    cp "$SCRIPT_DIR/memory/constitution.md" "$PROJECT_PATH/memory/"
    echo "✓ Copied constitution.md"
else
    echo "⚠ Constitution not found, using template"
    cp "$SCRIPT_DIR/ecosystem/templates/base/constitution.md.template" "$PROJECT_PATH/memory/constitution.md"
fi

# Copy commands
cp "$SCRIPT_DIR/.claude/commands/"*.md "$PROJECT_PATH/.claude/commands/"
echo "✓ Copied command definitions"

# Copy skills from templates
if [ -d "$SCRIPT_DIR/ecosystem/templates/base/skills" ]; then
    cp -r "$SCRIPT_DIR/ecosystem/templates/base/skills/"* "$PROJECT_PATH/.claude/skills/"
    echo "✓ Copied skill definitions (including /sdd-flow)"
fi

# Create CLAUDE.md if it doesn't exist
if [ ! -f "$PROJECT_PATH/CLAUDE.md" ]; then
    PROJECT_NAME=$(basename "$PROJECT_PATH")
    cat > "$PROJECT_PATH/CLAUDE.md" << EOF
# $PROJECT_NAME

## SDD Workflow

This project follows Specification-Driven Development.

### Full Lifecycle (Recommended)

\`\`\`bash
/sdd-flow <feature>  # Full lifecycle: idea → spec → plan → TDD → review → PR
\`\`\`

### Individual Commands

\`\`\`bash
/specify <feature>   # Create specification
/plan <feature>      # Create implementation plan
/drift <feature>     # Check spec-vs-code alignment
/review              # Validate before committing
\`\`\`

## Constitution

All development follows [memory/constitution.md](memory/constitution.md).

## Quick Links

- [Constitution](memory/constitution.md) - Governance principles
- [Specs](memory/specs/) - Feature specifications
- [Plans](memory/plans/) - Implementation plans
EOF
    echo "✓ Created CLAUDE.md"
else
    echo "ℹ CLAUDE.md already exists, skipping"
fi

# Stack-specific constitution (Phase 1)
# Appends stack-specific articles to the base constitution
if [ "$STACK" != "base" ]; then
    STACK_CONST="$SCRIPT_DIR/ecosystem/templates/$STACK/constitution-$STACK.md"
    if [ -f "$STACK_CONST" ]; then
        echo "" >> "$PROJECT_PATH/memory/constitution.md"
        cat "$STACK_CONST" >> "$PROJECT_PATH/memory/constitution.md"
        echo "✓ Added $STACK-specific articles (VII-VIII) to constitution"
        CONST_DESC="Articles I-VI (Universal) + VII-VIII ($STACK)"
    else
        echo "⚠ Stack template '$STACK' not found, using base only"
        CONST_DESC="Articles I-VI (Universal)"
    fi
else
    CONST_DESC="Articles I-VI (Universal)"
fi

echo ""
echo "✅ SDD bootstrapped successfully!"
echo ""
echo "   Constitution: $CONST_DESC"
echo ""
echo "Next steps:"
echo "  1. cd $PROJECT_PATH"
echo "  2. Review memory/constitution.md (especially stack-specific articles)"
echo "  3. Run '/sdd-flow <feature>' for full lifecycle orchestration"
echo "     Or use individual commands: /specify, /plan, /review"
echo ""
