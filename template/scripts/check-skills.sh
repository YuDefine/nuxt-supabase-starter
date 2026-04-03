#!/bin/bash

# Skills 狀態檢查腳本
# 用途：顯示所有已安裝的 skills 及其資訊

echo "📋 已安裝的 Skills"
echo "===================="
echo ""

SKILLS_DIR=".claude/skills"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "❌ 找不到 $SKILLS_DIR 目錄"
  exit 1
fi

# 計算總數（排除 versions.json）
TOTAL=$(ls -1 "$SKILLS_DIR" | grep -v versions.json | wc -l | xargs)

echo "總計: $TOTAL 個 skills"
echo ""

# 分類顯示
echo "🎯 Antfu Skills:"
for skill in vue vueuse-functions nuxt vitest vue-best-practices vitepress; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  else
    echo "  ✗ $skill (未安裝)"
  fi
done

echo ""
echo "📦 專案 Skills:"
for skill in nuxt-ui nuxt-better-auth nuxt-content nuxt-modules nuxthub reka-ui \
             ts-library document-writer motion pinia-store postgres-best-practices server-api; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "🗄️  Supabase Skills:"
for skill in supabase-arch supabase-migration supabase-rls; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "🔄 OpenSpec Skills:"
ls -1 "$SKILLS_DIR" | grep "^openspec-" | sed 's/^/  ✓ /'

echo ""
echo "📄 版本資訊:"
if [ -f "$SKILLS_DIR/versions.json" ]; then
  cat "$SKILLS_DIR/versions.json"
else
  echo "  (無版本記錄)"
fi

echo ""
echo "===================="
echo "💡 提示："
echo "  - 更新 Antfu skills: ./scripts/update-antfu-skills.sh"
echo "  - 查看更新指南: docs/SKILL_UPDATE_GUIDE.md"
