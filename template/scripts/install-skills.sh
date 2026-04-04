#!/bin/bash

# Skills 安裝／更新腳本
# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink
# 重複執行會覆寫為最新版（等同 update）
# 更新日期：2026-04-04

set -e

cd "$(dirname "$0")/.."

COPY_FLAGS="--agent claude-code --copy -y"

echo "🚀 開始安裝 skills（--copy 模式，直接寫入 .claude/skills/）..."
echo ""

# Antfu Skills
echo "📦 Antfu Skills..."
for skill in nuxt vue vueuse-functions vitest vue-best-practices vitepress pinia vue-testing-best-practices; do
  npx skills add antfu/skills@$skill $COPY_FLAGS
done
echo "  ✓ Antfu Skills 完成"
echo ""

# Onmax Nuxt Skills
echo "📦 Onmax Nuxt Skills..."
for skill in document-writer motion nuxt-better-auth nuxt-content nuxt-modules nuxthub reka-ui ts-library vueuse; do
  npx skills add onmax/nuxt-skills@$skill $COPY_FLAGS
done
echo "  ✓ Onmax Nuxt Skills 完成"
echo ""

# 官方 Skills
echo "📦 官方 Skills..."
npx skills add supabase/agent-skills@supabase-postgres-best-practices $COPY_FLAGS
npx skills add nuxt/ui $COPY_FLAGS
echo "  ✓ 官方 Skills 完成"
echo ""

# TDD
echo "📦 TDD Skill..."
npx skills add obra/superpowers@test-driven-development $COPY_FLAGS
echo "  ✓ TDD Skill 完成"
echo ""

# Evlog（Observability）
echo "📦 Evlog Skills..."
for skill in create-evlog-adapter create-evlog-enricher create-evlog-framework-integration review-logging-patterns; do
  npx skills add hugorcd/evlog@$skill $COPY_FLAGS
done
echo "  ✓ Evlog Skills 完成"
echo ""

# Impeccable Design Skills（pbakaus/impeccable）
echo "📦 Impeccable Design Skills..."
for skill in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden normalize onboard optimize overdrive polish quieter teach-impeccable typeset; do
  npx skills add pbakaus/impeccable@$skill $COPY_FLAGS
done
echo "  ✓ Impeccable Design Skills 完成"
echo ""
echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"
echo ""

# 實用工具
echo "📦 實用工具 Skills..."
npx skills add vercel-labs/skills@find-skills $COPY_FLAGS
echo "  ✓ 實用工具 Skills 完成"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""
echo "💡 提示："
echo "  - 查看已安裝：pnpm skills:list"
echo "  - 重新安裝/更新：pnpm skills:install（本腳本）"
echo "  - 重啟 Claude Code CLI 以載入變更"
