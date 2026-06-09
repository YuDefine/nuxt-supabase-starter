#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# native-picker-ban (pre-push, repo-wide) — 全站禁止原生 / 第三方 date / time / calendar picker
#
# 跟 pre-commit 同名 check 的分工：
#   - pre-commit checks/native-picker-ban.sh : 只掃本次 staged *.vue（快擋，最接近犯錯時點）
#   - pre-push  checks/native-picker-ban.sh  : 掃全 repo *.vue（回溯型，擋住規則上線前的歷史違規
#                                              與繞過 pre-commit（--no-verify）混進來的違規）
#
# 三層 enforcement（impl-time rule / pre-commit / review）全是增量式、不回溯既有檔，
# 歷史違規能一直潛伏到人肉發現才清。本 check 補上全站回溯掃描。
#
# Auto-detect：偵測 nuxt.config.* 存在才跑；非 Nuxt repo 自動 no-op（exit 0）。
#
# 合法例外 escape hatch：在違規行加 `picker-ban-ignore` 標記即跳過該行
#   （rule 有例外條款——純後端腳本 / admin debug 內部頁——但機械 gate 讀不到
#    commit message rationale，inline 標記讓合法例外能繞過全站 gate）。
#   範例：<UInput type="date" />  <!-- picker-ban-ignore: internal debug page -->
#
# 正解：<UCalendar> + <UPopover>（日期）、<USelectMenu> / <UInputMenu>（時間）。
# 規約來源：rules/modules/framework/nuxt/nuxt-ui-native-picker-ban.md
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Auto-detect：無 nuxt.config 直接跳過
nuxt_config=""
for ext in ts mts js mjs; do
  if [[ -f "nuxt.config.$ext" ]]; then
    nuxt_config="nuxt.config.$ext"
    break
  fi
done
[[ -n "$nuxt_config" ]] || exit 0

# 全站收檔（git ls-files 尊重 .gitignore，自動排除 node_modules / .nuxt）
vue_files=()
while IFS= read -r -d '' file; do
  vue_files+=("$file")
done < <(git ls-files -z -- '*.vue')

vue_ts_files=()
while IFS= read -r -d '' file; do
  vue_ts_files+=("$file")
done < <(git ls-files -z -- '*.vue' '*.ts')

# 無任何 .vue（極少：Nuxt repo 尚未建頁）→ 跳過
((${#vue_files[@]} == 0)) && exit 0

EXIT=0

# 1) 原生 <input type="date|datetime-local|time|month|week">
#    `|| true` 整個 pipeline 收 grep no-match (return 1) — pipefail 下避免炸 script
NATIVE=$(grep -En '<input[^>]*type="(date|datetime-local|time|month|week)"' "${vue_files[@]}" 2>/dev/null | grep -v 'picker-ban-ignore' || true)

# 2) <UInput type="date|..."> 偽裝（底層仍是原生 picker）
UINPUT=$(grep -En '<UInput[^>]*type="(date|datetime-local|time|month|week)"' "${vue_files[@]}" 2>/dev/null | grep -v 'picker-ban-ignore' || true)

# 3) 第三方 date picker import（.vue + .ts）
THIRDPARTY=""
if ((${#vue_ts_files[@]} > 0)); then
  THIRDPARTY=$(grep -En "from ['\"](@vuepic/vue-datepicker|v-calendar|flatpickr|vue-flatpickr-component|vue-datepicker)['\"]" "${vue_ts_files[@]}" 2>/dev/null | grep -v 'picker-ban-ignore' || true)
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
   theming（含 dark mode）、a11y / i18n 不可控。pre-push 全站掃描偵測到既有違規。

正解：
  日期 / 日期區間  → <UCalendar> + <UPopover>
  純時間           → <USelectMenu> / <UInputMenu>
  日期 + 時間      → <UCalendar> + 時間選擇器組合

  寫之前先查 nuxt-ui-remote MCP 取得 <UCalendar> 最新 API。

合法例外（純後端腳本 / admin debug 內部頁）：在該行加 `picker-ban-ignore` 標記，例：
  <UInput type="date" />  <!-- picker-ban-ignore: 理由 -->

詳細規約：rules/modules/framework/nuxt/nuxt-ui-native-picker-ban.md
EOF
  exit 1
fi

exit 0
