#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# native-picker-ban — 禁止 staged .vue 使用原生 / 第三方 date / time / calendar picker
#
# Auto-detect：只掃本次 commit staged 的 *.vue / *.ts；無 staged 對應檔直接跳過。
# 非 Nuxt / 無 .vue 的 consumer 與不碰 picker 的 commit 自動 no-op（exit 0）。
#
# 正解：<UCalendar> + <UPopover>（日期）、<USelectMenu> / <UInputMenu>（時間）。
# 規約來源：
#   - impl-time rule : rules/modules/framework/nuxt/nuxt-ui-native-picker-ban.md
#   - review-layer   : plugins/hub-core/agents/references/clade-review-rules.md
#                      § 原生 HTML date / time / calendar 輸入
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# 蒐集本次 staged 的 .vue（原生 / UInput 偽裝）與 .vue/.ts（第三方 import）
staged_vue=()
while IFS= read -r -d '' file; do
  staged_vue+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue')

staged_vue_ts=()
while IFS= read -r -d '' file; do
  staged_vue_ts+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue' '*.ts')

# 無 staged .vue → 跳過（非 Nuxt UI commit 一律 no-op）
((${#staged_vue[@]} == 0)) && exit 0

EXIT=0

# 1) 原生 <input type="date|datetime-local|time|month|week">
NATIVE=$(grep -rEn '<input[^>]*type="(date|datetime-local|time|month|week)"' "${staged_vue[@]}" 2>/dev/null || true)

# 2) <UInput type="date|..."> 偽裝（底層仍是原生 picker）
UINPUT=$(grep -rEn '<UInput[^>]*type="(date|datetime-local|time|month|week)"' "${staged_vue[@]}" 2>/dev/null || true)

# 3) 第三方 date picker import（.vue + .ts）
THIRDPARTY=""
if ((${#staged_vue_ts[@]} > 0)); then
  THIRDPARTY=$(grep -rEn "from ['\"](@vuepic/vue-datepicker|v-calendar|flatpickr|vue-flatpickr-component|vue-datepicker)['\"]" "${staged_vue_ts[@]}" 2>/dev/null || true)
fi

if [[ -n "$NATIVE" ]]; then
  echo "❌ 原生 date/time input（改用 <UCalendar> + <UPopover>）：" >&2
  echo "$NATIVE" >&2
  echo "" >&2
  EXIT=1
fi

if [[ -n "$UINPUT" ]]; then
  echo "❌ <UInput type=\"date|time|...\"> 偽裝原生 picker（改用 <UCalendar> + <UPopover>）：" >&2
  echo "$UINPUT" >&2
  echo "" >&2
  EXIT=1
fi

if [[ -n "$THIRDPARTY" ]]; then
  echo "❌ 第三方 date picker（改用 @nuxt/ui 對應元件）：" >&2
  echo "$THIRDPARTY" >&2
  echo "" >&2
  EXIT=1
fi

if [[ $EXIT -ne 0 ]]; then
  cat <<'EOF' >&2
⚠️  原生 / 第三方 date / time picker 在不同瀏覽器外觀不一致、無法套 design system
   theming（含 dark mode）、a11y / i18n 不可控。

正解：
  日期 / 日期區間  → <UCalendar> + <UPopover>
  純時間           → <USelectMenu> / <UInputMenu>
  日期 + 時間      → <UCalendar> + 時間選擇器組合

  寫之前先查 nuxt-ui-remote MCP 取得 <UCalendar> 最新 API。

例外（純後端腳本 / admin debug 內部頁）：在 commit message 註明理由。
詳細規約：rules/modules/framework/nuxt/nuxt-ui-native-picker-ban.md
EOF
  exit 1
fi

exit 0
