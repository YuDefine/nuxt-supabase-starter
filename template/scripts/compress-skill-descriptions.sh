#!/bin/bash

# Post-process: 壓縮超標的 vendor skill description 到 ≤30 words
# 這些 skill 由 install-skills.sh 安裝（--copy 模式），每次 install 會覆寫本地改動
# 本腳本在 install 後執行，把已知超標的 description 替換為精簡版
# 更新日期：2026-04-12

set -e

cd "$(dirname "$0")/.."

SKILLS_DIR=".claude/skills"

compress() {
  local skill="$1"
  local new_desc="$2"
  local file="$SKILLS_DIR/$skill/SKILL.md"

  if [ ! -f "$file" ]; then
    echo "  ⚠ $skill: 檔案不存在，跳過"
    return
  fi

  # 替換 YAML frontmatter 中的 description 行（單行）
  # 使用 | 作為 sed 分隔符避免與 description 中的 / 衝突
  sed -i '' "s|^description:.*|description: ${new_desc}|" "$file"
  echo "  ✓ $skill"
}

echo "📝 壓縮超標 skill descriptions..."
echo ""

compress "design" \
  "UI/UX design orchestrator — coordinates multiple design skills into plans. Use for /design new, /design improve, /design iterate. NOT for coding UI or single-skill tasks."

compress "vue-best-practices" \
  "MUST be used for Vue.js tasks. Covers Composition API, <script setup>, TypeScript, Vue 3, SSR, Volar, Vue Router, Pinia. ALWAYS use Composition API."

compress "vueuse" \
  "Use when working with VueUse composables. Check VueUse before writing custom composables — most reactive patterns already implemented."

compress "nuxt-ui" \
  "Use when building styled UI with @nuxt/ui v4 components — forms, data tables, modals, theming. Use vue for raw patterns, reka-ui for headless."

compress "nuxt" \
  "Use when working on Nuxt 4+ projects — server routes, routing, middleware, composables, h3 v1 helpers, nitropack v2. Updated for Nuxt 4.3+."

echo ""
echo "✅ Description 壓縮完成"
