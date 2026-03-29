#!/bin/bash
# 從 templates 還原自訂 git hooks（vp config 可能覆蓋）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/scripts/templates/vite-hooks"
DST="$ROOT/.vite-hooks"

[ ! -d "$TPL" ] && exit 0

for hook in "$TPL"/*; do
  name="$(basename "$hook")"
  target="$DST/$name"
  if [ ! -f "$target" ] || ! cmp -s "$hook" "$target"; then
    cp "$hook" "$target" && chmod +x "$target"
  fi
done
