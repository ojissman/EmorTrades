#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# install-git-hooks.sh — arms the enforcement pre-push hook. Idempotent and
# NEVER fails (called from package.json "prepare" on every `bun install`,
# including a brand-new sandbox restored from the GitHub repo — that is the
# auto-arming path that makes the enforcement survive a total wipe).
# ─────────────────────────────────────────────────────────────────────────────
set +e
cd "$(dirname "$0")/.." || exit 0

# Not a git repo (e.g. extracted tarball) — nothing to arm.
git rev-parse --git-dir >/dev/null 2>&1 || { echo "[hooks] not a git repo — enforcement hook not armed"; exit 0; }

HOOKS_DIR="$(git rev-parse --git-path hooks 2>/dev/null)"
[ -n "$HOOKS_DIR" ] || HOOKS_DIR=".git/hooks"
mkdir -p "$HOOKS_DIR" 2>/dev/null

if [ -f scripts/git-hooks/pre-push ]; then
  cp scripts/git-hooks/pre-push "$HOOKS_DIR/pre-push" 2>/dev/null
  chmod +x "$HOOKS_DIR/pre-push" 2>/dev/null
  echo "[hooks] enforcement pre-push hook armed ($HOOKS_DIR/pre-push) — no pull, no push."
else
  echo "[hooks] scripts/git-hooks/pre-push missing — enforcement NOT armed. Investigate."
fi
exit 0
