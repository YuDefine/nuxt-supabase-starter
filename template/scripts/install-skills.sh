#!/bin/bash

# Skills 安裝／更新腳本
# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink
# 重複執行會覆寫為最新版（等同 update）
# 更新日期：2026-08-25（impeccable v4.1.1 同步）

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
# onmax/nuxt-skills@vueuse 已於上游下架（2026-08-02 實測 npx skills add 列不到），
# 故從清單移除。VueUse 的 composable 參考仍由 antfu/skills@vueuse-functions 提供。
# onmax/nuxt-skills@nuxt-better-auth 同樣已下架（2026-08-24 實測 GitHub contents API 回 404），
# 時間點與模組搬進官方 nuxt-modules org（改名 @nuxtjs/better-auth）一致。
# 本 repo 的 .claude/skills/nuxt-better-auth 已就地更新成新套件名，不再由上游覆寫。
echo "📦 Onmax Nuxt Skills..."
for skill in document-writer motion nuxt-content nuxt-modules nuxthub reka-ui ts-library; do
  npx skills add onmax/nuxt-skills@$skill $COPY_FLAGS
done
echo "  ✓ Onmax Nuxt Skills 完成"
echo ""

# 官方 Skills
echo "📦 官方 Skills..."
npx skills add supabase/agent-skills@supabase-postgres-best-practices $COPY_FLAGS
npx skills add supabase/agent-skills@supabase $COPY_FLAGS
npx skills add nuxt/ui $COPY_FLAGS
echo "  ✓ 官方 Skills 完成"
echo ""

# Better Auth 官方 Skills
echo "📦 Better Auth 官方 Skills..."
npx skills add better-auth/skills@better-auth-best-practices $COPY_FLAGS
npx skills add better-auth/skills@better-auth-security-best-practices $COPY_FLAGS
echo "  ✓ Better Auth 官方 Skills 完成"
echo ""

# Cloudflare Skills
echo "📦 Cloudflare Skills..."
npx skills add cloudflare/skills@wrangler $COPY_FLAGS
npx skills add cloudflare/skills@workers-best-practices $COPY_FLAGS
echo "  ✓ Cloudflare Skills 完成"
echo ""

# TDD
echo "📦 TDD Skill..."
npx skills add obra/superpowers@test-driven-development $COPY_FLAGS
echo "  ✓ TDD Skill 完成"
echo ""

# Playwright
echo "📦 Playwright 最佳實踐 Skill..."
npx skills add currents-dev/playwright-best-practices-skill $COPY_FLAGS
echo "  ✓ Playwright 最佳實踐 Skill 完成"
echo ""

# Zod
echo "📦 Zod Skill..."
npx skills add pproenca/dot-skills@zod $COPY_FLAGS
echo "  ✓ Zod Skill 完成"
echo ""

# Evlog（Observability）
echo "📦 Evlog Skills..."
npx skills add https://www.evlog.dev $COPY_FLAGS
echo "  ✓ Evlog Skills 完成"
echo ""

# Impeccable Design Skill（pbakaus/impeccable v4.1.1 — 單一 skill 含 23 sub-command）
# v4 延續單一 skill 形態，sub-command 由 SKILL.md 統一定義
# 本地 starter skills（不從 upstream 覆寫）：design / design-retro / review-archive / subagent-dev
echo "📦 Impeccable Design Skill..."
npx skills add pbakaus/impeccable $COPY_FLAGS
echo "  ✓ Impeccable Design Skill 完成"
echo ""

# 清理 v1.x / v2.x deprecated sub-skill 目錄（v4 已合併為單一 skill）
DEPRECATED_DIR="$(pwd)/.claude/skills"
for legacy in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden layout normalize onboard optimize overdrive polish quieter shape teach-impeccable typeset; do
  if [ -d "$DEPRECATED_DIR/$legacy" ] && grep -qi impeccable "$DEPRECATED_DIR/$legacy/SKILL.md" 2>/dev/null; then
    echo "🧹 移除 deprecated sub-skill：$legacy"
    rm -rf "$DEPRECATED_DIR/$legacy"
  fi
done
echo ""

echo "📝 注意：本地 starter design skills 已直接內建於 .claude/skills/"
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
