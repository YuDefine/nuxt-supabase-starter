#!/bin/bash

# Skills 自動安裝腳本
# 用途：移除舊版本並安裝新版本的 skills

set -e

echo "🚀 開始安裝 skills.sh 上的 skills..."
echo ""

# Antfu Skills
echo "📦 安裝 Antfu Skills..."
npx skills add antfu/skills@vue -y
npx skills add antfu/skills@vueuse-functions -y
npx skills add https://github.com/antfu/skills --skill nuxt --agent claude-code -y
npx skills add antfu/skills@pinia -y
npx skills add antfu/skills@vitepress -y
npx skills add antfu/skills@vitest -y
npx skills add antfu/skills@vue-best-practices -y
echo "  ✓ Antfu Skills 安裝完成"
echo ""

# 官方 Skills
echo "📦 安裝官方 Skills..."
npx skills add supabase/agent-skills@supabase-postgres-best-practices -y
npx skills add nuxt/ui --agent claude-code -y
echo "  ✓ 官方 Skills 安裝完成"
echo ""

# 實用工具
echo "📦 安裝實用工具 Skills..."
npx skills add vercel-labs/skills@find-skills -y
echo "  ✓ 實用工具 Skills 安裝完成"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""
echo "📋 選擇 Spec-Driven Development 工具："
echo "   執行 pnpm sdd:select 來選擇 OpenSpec 或 Spectra"
echo ""
echo "下一步："
echo "1. 執行 pnpm sdd:select 選擇 SDD 工具"
echo "2. 執行 pnpm skills:list 查看已安裝的 skills"
echo "3. 重啟 Claude Code CLI"
echo "4. 測試 skills 是否正常運作"
