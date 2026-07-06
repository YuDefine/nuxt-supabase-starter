#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# review-rules-ratchet (pre-push, 全 repo) — review-rules ratchet baseline 回溯掃描
#
# 跟 pre-commit 同名 check（checks/review-rules-ban.sh）的分工：
#   - pre-commit review-rules-ban.sh    : 只擋本次 staged .vue/app.config.*（pre-commit
#                                          layer，最接近犯錯時點，精準度高才進此 layer）
#   - pre-push   review-rules-ratchet.sh: 全 repo 掃全部 layer（pre-commit + ratchet），
#                                          比對 review-rules-baseline.json——只有「超過
#                                          baseline」的新增違規才擋 push，既有存量違規
#                                          不擋（ratchet；見 W7 分批清償計畫）
#
# 掃描 / glob matching / baseline 比對全部收斂在 scan.mjs（pre-commit / pre-push / CI /
# audit 四入口共用，見 scan.mjs 檔頭）。
#
# review-rules-baseline.json 不存在時，baseline 視為全空（等同零容忍——任何既有違規都算
# 「新增」）；第一次導入 ratchet 的 consumer 應先跑
#   node vendor/review-rules/scan.mjs --all --layer all --write-baseline
# 收斂當前存量再啟用本 check。全 fleet 歸零後可移除 baseline 檔，把本 check 改成純
# blocking（拿掉 --ratchet，直接吃 severity 擋）。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

PATTERNS_FILE="$PROJECT_ROOT/vendor/review-rules/patterns.json"
SCAN_ENGINE="$PROJECT_ROOT/vendor/review-rules/scan.mjs"

# patterns.json / scan.mjs 不存在 → 跳過（consumer 尚未 propagate）
[[ -f "$PATTERNS_FILE" ]] || exit 0
[[ -f "$SCAN_ENGINE" ]] || exit 0

exec node "$SCAN_ENGINE" --all --layer all --ratchet
