#!/bin/bash

# Skills 自動安裝腳本
# 語法：統一使用 owner/repo@skill 短格式 + --agent claude-code
# 更新日期：2026-04-03

set -e

cd "$(dirname "$0")/.."

echo "🚀 開始安裝 skills.sh 上的 skills..."
echo ""

# Antfu Skills
echo "📦 安裝 Antfu Skills..."
npx skills add antfu/skills@nuxt --agent claude-code -y
npx skills add antfu/skills@vue --agent claude-code -y
npx skills add antfu/skills@vueuse-functions --agent claude-code -y
npx skills add antfu/skills@vitest --agent claude-code -y
npx skills add antfu/skills@vue-best-practices --agent claude-code -y
npx skills add antfu/skills@vitepress --agent claude-code -y
npx skills add antfu/skills@pinia --agent claude-code -y
npx skills add antfu/skills@vue-testing-best-practices --agent claude-code -y
echo "  ✓ Antfu Skills 安裝完成"
echo ""

# Onmax Nuxt Skills
echo "📦 安裝 Onmax Nuxt Skills..."
npx skills add onmax/nuxt-skills@document-writer --agent claude-code -y
npx skills add onmax/nuxt-skills@motion --agent claude-code -y
npx skills add onmax/nuxt-skills@nuxt-better-auth --agent claude-code -y
npx skills add onmax/nuxt-skills@nuxt-content --agent claude-code -y
npx skills add onmax/nuxt-skills@nuxt-modules --agent claude-code -y
npx skills add onmax/nuxt-skills@nuxthub --agent claude-code -y
npx skills add onmax/nuxt-skills@reka-ui --agent claude-code -y
npx skills add onmax/nuxt-skills@ts-library --agent claude-code -y
npx skills add onmax/nuxt-skills@vueuse --agent claude-code -y
echo "  ✓ Onmax Nuxt Skills 安裝完成"
echo ""

# 官方 Skills
echo "📦 安裝官方 Skills..."
npx skills add supabase/agent-skills@supabase-postgres-best-practices --agent claude-code -y
npx skills add nuxt/ui --agent claude-code -y
echo "  ✓ 官方 Skills 安裝完成"
echo ""

# TDD
echo "📦 安裝 TDD Skill..."
npx skills add obra/superpowers@test-driven-development --agent claude-code -y
echo "  ✓ TDD Skill 安裝完成"
echo ""

# Evlog（Observability）
echo "📦 安裝 Evlog Skills..."
npx skills add hugorcd/evlog@create-evlog-adapter --agent claude-code -y
npx skills add hugorcd/evlog@create-evlog-enricher --agent claude-code -y
npx skills add hugorcd/evlog@create-evlog-framework-integration --agent claude-code -y
npx skills add hugorcd/evlog@review-logging-patterns --agent claude-code -y
echo "  ✓ Evlog Skills 安裝完成"
echo ""

# Impeccable Design Skills（pbakaus/impeccable）
echo "📦 安裝 Impeccable Design Skills..."
for skill in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden normalize onboard optimize overdrive polish quieter teach-impeccable typeset; do
  npx skills add pbakaus/impeccable@$skill --agent claude-code -y
done
echo "  ✓ Impeccable Design Skills 安裝完成"
echo ""
echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"
echo ""

# Excalidraw Diagram Workbench
echo "📦 安裝 Excalidraw Diagram Workbench..."
npx skills add YuDefine/excalidraw-diagram-workbench@excalidraw-diagram --agent claude-code -y
echo "  ✓ Excalidraw Diagram Workbench 安裝完成"
echo ""

# 實用工具
echo "📦 安裝實用工具 Skills..."
npx skills add vercel-labs/skills@find-skills --agent claude-code -y
echo "  ✓ 實用工具 Skills 安裝完成"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""
echo "下一步："
echo "1. 執行 pnpm skills:list 查看已安裝的 skills"
echo "2. 重啟 Claude Code CLI"
echo "3. 測試 skills 是否正常運作"
