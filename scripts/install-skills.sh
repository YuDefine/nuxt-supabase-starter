#!/bin/bash

# Skills 自動安裝腳本
# 用途：移除舊版本並安裝新版本的 skills

set -e

echo "🚀 開始安裝 skills.sh 上的 skills..."
echo ""

# Antfu Skills
echo "📦 安裝 Antfu Skills..."
npx skills add https://github.com/antfu/skills --skill nuxt --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vue --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vueuse-functions --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vitest --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vue-best-practices --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vitepress --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill pinia --agent claude-code -y
npx skills add https://github.com/antfu/skills --skill vue-testing-best-practices --agent claude-code -y
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
npx skills add https://github.com/obra/superpowers --skill test-driven-development --agent claude-code -y
echo "  ✓ TDD Skill 安裝完成"
echo ""

# Evlog（Observability）
echo "📦 安裝 Evlog Skills..."
npx skills add https://github.com/hugorcd/evlog --skill create-evlog-adapter --agent claude-code -y
npx skills add https://github.com/hugorcd/evlog --skill create-evlog-enricher --agent claude-code -y
npx skills add https://github.com/hugorcd/evlog --skill create-evlog-framework-integration --agent claude-code -y
npx skills add https://github.com/hugorcd/evlog --skill review-logging-patterns --agent claude-code -y
echo "  ✓ Evlog Skills 安裝完成"
echo ""

# 實用工具
echo "📦 安裝實用工具 Skills..."
npx skills add vercel-labs/skills@find-skills --agent claude-code -y
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
