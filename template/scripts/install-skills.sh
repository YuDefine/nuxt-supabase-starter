#!/bin/bash

# Skills 安裝／更新腳本
# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink
# 重複執行會覆寫為最新版（等同 update）
# 更新日期：2026-04-16

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
npx skills add https://www.evlog.dev $COPY_FLAGS
echo "  ✓ Evlog Skills 完成"
echo ""

# Impeccable Design Skills（pbakaus/impeccable）
# 注意：部分 design skills 是本專案手動維護的本地 skills，
# 例如 arrange / extract / frontend-design / harden / normalize / onboard /
# teach-impeccable / design / design-retro / review-archive / subagent-dev。
# 這些已隨 template/.claude/skills 直接提供，不應再從上游覆寫。
echo "📦 Impeccable Design Skills..."
for skill in adapt animate audit bolder clarify colorize critique delight distill optimize overdrive polish quieter typeset; do
  npx skills add pbakaus/impeccable@$skill $COPY_FLAGS
done
echo "  ✓ Impeccable Design Skills 完成"
echo ""
echo "📝 注意：本地 design skills 已直接內建於 .claude/skills/"
echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""

# Post-process: 壓縮超標的 vendor skill description
echo "🔧 Post-process: 壓縮超標 skill descriptions..."
bash "$(dirname "$0")/compress-skill-descriptions.sh"
echo ""

echo "💡 提示："
echo "  - 查看已安裝：pnpm skills:list"
echo "  - 重新安裝/更新：pnpm skills:install（本腳本）"
echo "  - 重啟 Claude Code CLI 以載入變更"
