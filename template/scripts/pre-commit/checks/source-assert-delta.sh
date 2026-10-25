#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/source-assert-delta.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/source-assert-delta.sh
# CLADE:VENDOR-SCRIPT
#
# source-assert-delta (pre-commit, staged) — 擋新增「讀原始碼比字串」的測試斷言（P 類）
#
# 判定式唯一住在 scripts/checks/source-assert-gate.ts（偵測邏輯在同目錄 source-assert-detect.ts；
# CI 的 vendor/actions/source-assert-delta 呼叫同一份，NEVER 在這裡另寫判準）。本檔只負責找到
# detector 並用 --staged 呼叫：
#   - P 類斷言數比 HEAD 增加 → 擋（新增 P 檔必擋；legacy 凍結檔增加也擋）
#   - 改到但沒增加 → warn；減少 → 放行；沒碰 → 靜默
#   - 混合型（同檔有 E 又有 P）只 warn；D 類（sql／yml／json…）不在範圍
#   - 逃生口：檔首 10 行 `clade-source-assert: <no-behavior-channel|declarative> — <reason>`
# 沒有 staged 測試檔時 detector 直接 exit 0。
#
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 consumer-carriers.sh）。
# 缺 node / detector 未散播 → soft-skip exit 0。
#
# 規約來源：rules/core/testing-anti-patterns.md § unit test 何時寫（U 判準）
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0
command -v node >/dev/null 2>&1 || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

DETECTOR="scripts/checks/source-assert-gate.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/source-assert-gate.ts"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

exec node "$DETECTOR" --staged --root "$PROJECT_ROOT"
