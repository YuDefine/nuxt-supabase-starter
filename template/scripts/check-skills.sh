#!/bin/bash

# Skills 狀態檢查腳本
# 用途：顯示所有已安裝的 skills 及其資訊，偵測 symlink 問題

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

# 偵測 broken symlinks
BROKEN=0
for entry in "$SKILLS_DIR"/*/; do
  name=$(basename "$entry")
  if [ -L "$SKILLS_DIR/$name" ]; then
    if [ ! -e "$SKILLS_DIR/$name" ]; then
      echo "  ⚠️  $name (broken symlink → $(readlink "$SKILLS_DIR/$name"))"
      BROKEN=$((BROKEN + 1))
    else
      echo "  🔗 $name (symlink — 建議用 pnpm skills:install 轉為 --copy)"
    fi
  fi
done
if [ $BROKEN -gt 0 ]; then
  echo ""
  echo "⚠️  發現 $BROKEN 個 broken symlink — 執行 pnpm skills:install 修復"
  echo ""
fi

# 分類顯示
echo "🎯 Antfu Skills:"
for skill in vue vueuse-functions nuxt vitest vue-best-practices vitepress pinia vue-testing-best-practices; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  else
    echo "  ✗ $skill (未安裝)"
  fi
done

echo ""
echo "📦 專案 Skills:"
for skill in nuxt-ui nuxt-better-auth nuxt-content nuxt-modules nuxthub reka-ui \
             ts-library document-writer motion pinia-store server-api; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "🗄️  Supabase Skills:"
for skill in supabase-arch supabase-migration supabase-rls supabase-postgres-best-practices; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "🎨 Design Skills:"
for skill in design frontend-design adapt animate arrange audit bolder clarify colorize \
             critique delight distill extract harden normalize onboard optimize overdrive \
             polish quieter teach-impeccable typeset; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "🔄 Spectra Skills:"
ls -1 "$SKILLS_DIR" | grep "^spectra" | sed 's/^/  ✓ /'

echo ""
echo "🛠️  其他 Skills:"
for skill in test-driven-development find-skills review-archive review-rules review-screenshot subagent-dev; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "  ✓ $skill"
  fi
done

echo ""
echo "===================="
echo "💡 提示："
echo "  - 安裝/更新：pnpm skills:install"
echo "  - 查看清單：pnpm skills:list（本腳本）"
