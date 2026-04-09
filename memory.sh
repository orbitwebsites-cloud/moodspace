#!/usr/bin/env bash
# memory.sh — Launch Claude Code with full project context baked in
# Run this at the start of every session instead of plain `claude`

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIMER="$HOME/.claude/primer.md"
MEMORY="$PROJECT_DIR/.claude-memory.md"
LESSONS="$PROJECT_DIR/tasks/lessons.md"

# ── Build context string ──────────────────────────────────────
CONTEXT=""

# 1. Global primer (last session state)
if [ -f "$PRIMER" ]; then
  CONTEXT+="=== LAST SESSION (primer.md) ===\n"
  CONTEXT+="$(cat "$PRIMER")\n\n"
fi

# 2. Recent commit history
CONTEXT+="=== RECENT COMMITS ===\n"
CONTEXT+="$(git -C "$PROJECT_DIR" log --oneline -5 2>/dev/null || echo 'No git history')\n\n"

# 3. Currently modified files
CONTEXT+="=== MODIFIED FILES ===\n"
CONTEXT+="$(git -C "$PROJECT_DIR" status --short 2>/dev/null || echo 'Clean')\n\n"

# 4. Current branch
CONTEXT+="=== BRANCH ===\n"
CONTEXT+="$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo 'unknown')\n\n"

# 5. Lessons learned
if [ -f "$LESSONS" ]; then
  CONTEXT+="=== LESSONS (read and apply these) ===\n"
  CONTEXT+="$(cat "$LESSONS")\n\n"
fi

# 6. Commit memory log (last 10 lines)
if [ -f "$MEMORY" ]; then
  CONTEXT+="=== COMMIT HISTORY LOG ===\n"
  CONTEXT+="$(tail -20 "$MEMORY")\n\n"
fi

# ── Launch Claude ─────────────────────────────────────────────
echo -e "$CONTEXT" | claude \
  --permission-mode acceptEdits \
  --allowedTools "Bash(git:*) Bash(npm:*) Edit Write Read" \
  --system-prompt "$(echo -e "$CONTEXT")" \
  "$@"
