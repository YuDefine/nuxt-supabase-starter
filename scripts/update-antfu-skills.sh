#!/bin/bash

# Antfu Skills 更新腳本
# 用途：批次更新所有來自 antfu/skills 的 skills

set -e

SKILLS=(
  "vue"
  "vueuse-functions"
  "nuxt"
  "vitest"
  "vue-best-practices"
  "vitepress"
)

REPO="https://github.com/antfu/skills"

echo "🔄 開始更新 Antfu Skills..."
echo ""

for skill in "${SKILLS[@]}"; do
  echo "📦 更新 $skill..."

  # 移除舊版本（如果存在）
  if [ -d ".claude/skills/$skill" ]; then
    rm -rf ".claude/skills/$skill"
    echo "  ✓ 已移除舊版本"
  fi

  # 安裝最新版本
  npx skills add "$REPO" --skill "$skill" -y > /dev/null 2>&1
  echo "  ✓ 已安裝最新版本"
  echo ""
done

echo "✅ 所有 Antfu Skills 更新完成！"
echo ""
echo "請執行以下步驟："
echo "1. 重啟 Claude Code CLI"
echo "2. 測試 skills 是否正常運作"
