#!/bin/bash

# Skills 安裝／更新腳本
# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink
# 重複執行會覆寫為最新版（等同 update）
# 更新日期：2026-08-25（impeccable v4.1.1 同步）

set -e

cd "$(dirname "$0")/.."

COPY_FLAGS="--agent claude-code --copy -y"

# 第三方 skill 釘版：每個 github source 釘完整 commit SHA，lock 條目因此帶 `ref`、可重現
# （clade rules/core/skill-management.md § 第三方 skill 安裝契約；7 碼短 SHA 會 clone 失敗，必須 40 碼）。
# 換版＝改這裡的 SHA 再重跑本腳本；NEVER 改回 owner/repo@skill（會解除釘版）。
REF_ANTFU_SKILLS=d524ed287eef22757297827ce42e3cad88abd20c  # antfu/skills HEAD 2026-11-14
REF_BETTER_AUTH_SKILLS=20c9e88a5c007461a703f1c213572b073196113e  # better-auth/skills HEAD 2026-11-14
REF_CLOUDFLARE_SKILLS=cbf893b954222276bf1af57e5f23379231e0efb9  # cloudflare/skills HEAD 2026-11-14
REF_CURRENTS_DEV_PLAYWRIGHT_BEST_PRACTICES_SKILL=0b75b5835a87de1fdd202ba965f3bc5a27738fdf  # currents-dev/playwright-best-practices-skill HEAD 2026-11-14
REF_NUXT_UI=3879d262ebf5409465fb6a3e1d27b8fb532d4ed7  # nuxt/ui HEAD 2026-11-14
REF_OBRA_SUPERPOWERS=22f0b463e7a5e579904dd6211a520321035526f7  # obra/superpowers HEAD 2026-11-14
REF_ONMAX_NUXT_SKILLS=581dc72cb78acb439f00ed6a4b03aa2a60eb97fe  # onmax/nuxt-skills HEAD 2026-11-14
# document-writer、motion、ts-library 上游在 9b069d6（#70）移除，釘它的前一個 commit；要換掉這三支另開 PR 判斷替代品。
REF_ONMAX_NUXT_SKILLS_LEGACY=eadcacf61338914ff6f92f89352c88127d69e44a
REF_PPROENCA_DOT_SKILLS=cf93c57cac89d6fc3e4194686000411567f5caf3  # pproenca/dot-skills HEAD 2026-11-14
REF_SUPABASE_AGENT_SKILLS=c9be0e931b7930f7d02126d04774d904c381e7d7  # supabase/agent-skills HEAD 2026-11-14
REF_VUEJS_AI_SKILLS=198f0cd8f7f9c0a3d9b566ccc16de6677519ee78  # vuejs-ai/skills HEAD 2026-11-14
REF_VUEUSE_SKILLS=004812b4aa0815f5745ac30a6a7dc4927aec7b3d  # vueuse/skills HEAD 2026-11-14
# antfu nuxt、vitepress 釘 e98e476：上游 d02c484（09-28）起改寫成 Nuxt 5／VitePress 2 alpha，本 repo 的 Nuxt 4、VitePress 1 用不了。
# 哪天程式碼真的遷到 Nuxt 5，就在那張遷移 PR 把 nuxt 改回跟 REF_ANTFU_SKILLS。
REF_ANTFU_SKILLS_PRE_NUXT5=e98e476e315f068f72d53bd3afb34fdd4d5851c3

echo "🚀 開始安裝 skills（--copy 模式，直接寫入 .claude/skills/）..."
echo ""

# Antfu Skills
echo "📦 Antfu Skills..."
for skill in nuxt vue vitest vitepress pinia; do
  ref=$REF_ANTFU_SKILLS
  case $skill in nuxt|vitepress) ref=$REF_ANTFU_SKILLS_PRE_NUXT5 ;; esac
  npx skills add "https://github.com/antfu/skills/tree/$ref/skills/$skill" $COPY_FLAGS
done
echo "  ✓ Antfu Skills 完成"
echo ""

# VueUse 官方 Skill（vueuse/skills；antfu/skills #39 已移除 vendored 版，2026-10-20 改追真上游）
echo "📦 VueUse Skill..."
npx skills add "https://github.com/vueuse/skills/tree/$REF_VUEUSE_SKILLS/skills/vueuse-functions" $COPY_FLAGS
echo "  ✓ VueUse Skill 完成"
echo ""

# Vue 官方 Skills（vuejs-ai/skills；antfu/skills #39 已移除 vendored 版，2026-10-20 改追真上游）
echo "📦 Vue Skills（vuejs-ai）..."
for skill in vue-best-practices vue-testing-best-practices; do
  npx skills add "https://github.com/vuejs-ai/skills/tree/$REF_VUEJS_AI_SKILLS/skills/$skill" $COPY_FLAGS
done
echo "  ✓ Vue Skills 完成"
echo ""

# Onmax Nuxt Skills
# onmax/nuxt-skills@vueuse 已於上游下架（2026-08-02 實測 npx skills add 列不到），
# 故從清單移除。VueUse 的 composable 參考改由 vueuse/skills@vueuse-functions 提供。
# onmax/nuxt-skills@nuxt-better-auth 同樣已下架（2026-08-24 實測 GitHub contents API 回 404），
# 時間點與模組搬進官方 nuxt-modules org（改名 @nuxtjs/better-auth）一致。
# 本 repo 的 .claude/skills/nuxt-better-auth 已就地更新成新套件名，不再由上游覆寫。
echo "📦 Onmax Nuxt Skills..."
for skill in document-writer motion nuxt-content nuxt-modules nuxthub reka-ui ts-library; do
  ref=$REF_ONMAX_NUXT_SKILLS
  case $skill in document-writer|motion|ts-library) ref=$REF_ONMAX_NUXT_SKILLS_LEGACY ;; esac
  npx skills add "https://github.com/onmax/nuxt-skills/tree/$ref/skills/$skill" $COPY_FLAGS
done
echo "  ✓ Onmax Nuxt Skills 完成"
echo ""

# 官方 Skills
echo "📦 官方 Skills..."
npx skills add "https://github.com/supabase/agent-skills/tree/$REF_SUPABASE_AGENT_SKILLS/skills/supabase-postgres-best-practices" $COPY_FLAGS
npx skills add "https://github.com/supabase/agent-skills/tree/$REF_SUPABASE_AGENT_SKILLS/skills/supabase" $COPY_FLAGS
npx skills add "https://github.com/nuxt/ui/tree/$REF_NUXT_UI/skills/nuxt-ui" $COPY_FLAGS
echo "  ✓ 官方 Skills 完成"
echo ""

# Better Auth 官方 Skills
echo "📦 Better Auth 官方 Skills..."
npx skills add "https://github.com/better-auth/skills/tree/$REF_BETTER_AUTH_SKILLS/better-auth/best-practices" $COPY_FLAGS
npx skills add "https://github.com/better-auth/skills/tree/$REF_BETTER_AUTH_SKILLS/security" $COPY_FLAGS
echo "  ✓ Better Auth 官方 Skills 完成"
echo ""

# Cloudflare Skills
echo "📦 Cloudflare Skills..."
npx skills add "https://github.com/cloudflare/skills/tree/$REF_CLOUDFLARE_SKILLS/skills/wrangler" $COPY_FLAGS
npx skills add "https://github.com/cloudflare/skills/tree/$REF_CLOUDFLARE_SKILLS/skills/workers-best-practices" $COPY_FLAGS
echo "  ✓ Cloudflare Skills 完成"
echo ""

# TDD
echo "📦 TDD Skill..."
npx skills add "https://github.com/obra/superpowers/tree/$REF_OBRA_SUPERPOWERS/skills/test-driven-development" $COPY_FLAGS
echo "  ✓ TDD Skill 完成"
echo ""

# Playwright
echo "📦 Playwright 最佳實踐 Skill..."
npx skills add "https://github.com/currents-dev/playwright-best-practices-skill/tree/$REF_CURRENTS_DEV_PLAYWRIGHT_BEST_PRACTICES_SKILL/playwright-best-practices" $COPY_FLAGS
echo "  ✓ Playwright 最佳實踐 Skill 完成"
echo ""

# Zod
echo "📦 Zod Skill..."
npx skills add "https://github.com/pproenca/dot-skills/tree/$REF_PPROENCA_DOT_SKILLS/skills/.curated/zod" $COPY_FLAGS
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
npx skills add "https://github.com/pbakaus/impeccable/tree/skill-v4.3.1" $COPY_FLAGS
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
