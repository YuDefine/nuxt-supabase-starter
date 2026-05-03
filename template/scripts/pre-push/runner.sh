#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# clade — pre-push runner
#
# 由 consumer 的 .husky/pre-push 統一呼叫：
#   bash scripts/pre-push/runner.sh
#
# Auto-detect 啟用哪些 check：
#   - nuxt-typecheck  偵測 nuxt.config.* 才跑
#
# 為什麼 typecheck 放 pre-push 不放 pre-commit：
#   vue-tsc / nuxi typecheck 不支援單檔 typecheck（nuxt/cli #407），
#   每次 commit 跑 full project typecheck 太慢。pre-push 階段一次性擋住，
#   兼顧 DX 與正確性。
#
# 為什麼不跑 test-tsconfig：
#   v0.3.10 曾加入該 check，數據顯示 5 家 consumer 中有 test/tsconfig.json
#   的 3 家裡 2/3 baseline 紅（test code 充滿 mock/fixture/cast，type drift
#   是常態不是 bug）。pre-push 是擋壞 production 的階段，test type drift 不
#   屬於 production safety；且 nuxt typecheck 已涵蓋 app/server type safety。
#   test typecheck 改放 CI（informational），不在 hook 階段擋。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
PROJECT_ROOT="$(git rev-parse --show-toplevel)"

cd "$PROJECT_ROOT"

run_check() {
  local name="$1"
  local script="$CHECKS_DIR/$name.sh"
  if [[ ! -x "$script" ]]; then
    echo "[clade pre-push] check 不存在或無執行權限：$script" >&2
    return 1
  fi
  bash "$script"
}

run_check nuxt-typecheck
