#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# mutation-loading (pre-push, 全 repo) — 回溯型掃描全 repo *.vue 的 Pinia Colada mutation
# status === 'pending' 當 loading（永久 spinner 靜默 bug）。
#
# warn-only：命中只印警告、不阻擋 push。理由：fleet 有大量歷史既有命中（如 perno 30+），
# 全擋會癱瘓 push。新增違規由 pre-commit blocking 版擋在源頭；本 check 只做「全站事實提醒」，
# 讓既有違規逐步清償。等某 consumer 清到 0 後，可在自家 runner 把本 check 改成 blocking。
#
# 跟 pre-commit 同名 check 的分工見 pre-commit/checks/mutation-loading.sh 檔頭。
# 偵測邏輯共用 vendor/scripts/checks/mutation-loading-detect.mjs（支援跨行 destructuring）。
#
# Auto-detect：無 nuxt.config.* → no-op（非 Nuxt repo 不掃）。
#
# 規約來源：rules/modules/framework/nuxt/page-loading-golden-path.md Tier 2.5
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# 非 Nuxt repo → 跳過
ls nuxt.config.* >/dev/null 2>&1 || exit 0

DETECTOR="scripts/checks/mutation-loading-detect.mjs"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/mutation-loading-detect.mjs"
[[ -f "$DETECTOR" ]] || exit 0

# 全站掃描（--all 走 app root + monorepo packages/*/app）；--warn-only 命中不 exit 1
node "$DETECTOR" --all --warn-only --root "$PROJECT_ROOT"
exit 0
