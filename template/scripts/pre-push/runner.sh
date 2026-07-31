#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# clade — pre-push runner
#
# 由 consumer 的 .husky/pre-push 統一呼叫：
#   bash scripts/pre-push/runner.sh
#
# Auto-detect 啟用哪些 check：
#   - nuxt-typecheck     偵測 nuxt.config.* 才跑
#   - native-picker-ban  偵測 nuxt.config.* 才跑（全站掃 .vue，回溯型；
#                        補 pre-commit staged 版的盲區——歷史既有違規）
#   - data-perf-check   偵測 nuxt.config.* 才跑（全站掃 .vue setup context raw $fetch）
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
# 為什麼並行跑（2026-07-26）：
#   7 個 check 彼此獨立（typecheck 寫 .nuxt/，其餘皆唯讀掃描，無共享寫入），
#   序列跑等於把每個 check 的耗時相加。<consumer-b> 實測序列 ≈ 98s，其中
#   nuxt-typecheck 57.9s + review-rules-ratchet 39.2s 佔 99%，其餘五項合計
#   < 0.6s。propagate.ts 的 push timeout 是 120s，序列跑的餘裕薄到會被機器
#   負載變異衝破（v1.4.340 / .341 / .342 連續三版在 propagate 內 timeout，
#   每次都要事後手動補跑）。並行後 wall time 由最慢的單一 check 決定。
#
#   設計對齊 scripts/lib/gate-runner.ts：**全部跑完**才報告，不第一個失敗
#   就中止——一次 push 就看到所有問題，不必修一條重跑一次。7 個 check 全數
#   保留、全數仍 blocking，並行只改執行順序，不改任何判定。
#   CLADE_PREPUSH_SERIAL=1 可退回序列（debug 用；輸出即時不緩衝）。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
PROJECT_ROOT="$(git rev-parse --show-toplevel)"

cd "$PROJECT_ROOT"

# 宣告順序 = 輸出順序（並行執行，但輸出仍依此序印出，讓 log 可預期）
CHECKS=(
  nuxt-typecheck        # full project typecheck（auto-detect nuxt.config）
  native-picker-ban     # 全站掃 .vue（auto-detect nuxt.config；非 Nuxt repo 自動 no-op）
  data-perf-check       # 全站掃 .vue setup context raw $fetch（auto-detect nuxt.config）
  mutation-loading      # 全站掃 .vue 的 mutation status==='pending' 當 loading（warn-only 回溯型）
  review-rules-ratchet  # patterns.json 全站掃 + baseline 比對（只擋新增違規；存量走分批清償）
  nuxt-ui-mixed-slot    # 全站掃 UDashboardPanel named template + stray 子元素混用（blocking；fleet 基線 0 hit）
  utable-slots          # 全站掃 UTable 內漏掉 -cell 後綴的 cell slot（blocking；fleet 基線 0 hit）
)

for name in "${CHECKS[@]}"; do
  script="$CHECKS_DIR/$name.sh"
  if [[ ! -x "$script" ]]; then
    echo "[clade pre-push] check 不存在或無執行權限：$script" >&2
    exit 1
  fi
done

# --- 序列模式（debug）-----------------------------------------------------
if [[ -n "${CLADE_PREPUSH_SERIAL:-}" ]]; then
  for name in "${CHECKS[@]}"; do
    bash "$CHECKS_DIR/$name.sh"
  done
  exit 0
fi

# --- 並行模式（預設）-----------------------------------------------------
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clade-prepush.XXXXXX")"
trap 'rm -rf "$RUN_DIR"' EXIT

pids=()
for i in "${!CHECKS[@]}"; do
  name="${CHECKS[$i]}"
  # set +e 在 subshell 內：否則繼承的 -e 會讓 check 失敗時直接中止 subshell，
  # 來不及把 exit code 寫進 .rc，父程序讀不到真正的失敗碼。
  (
    set +e
    bash "$CHECKS_DIR/$name.sh" >"$RUN_DIR/$i.out" 2>&1
    echo $? >"$RUN_DIR/$i.rc"
  ) &
  pids+=("$!")
done

for pid in "${pids[@]}"; do
  wait "$pid" || true
done

failed_names=()
for i in "${!CHECKS[@]}"; do
  name="${CHECKS[$i]}"
  [[ -f "$RUN_DIR/$i.out" ]] && cat "$RUN_DIR/$i.out"
  rc="$(cat "$RUN_DIR/$i.rc" 2>/dev/null || echo 1)"
  if [[ "$rc" != "0" ]]; then
    failed_names+=("$name (exit $rc)")
  fi
done

if [[ ${#failed_names[@]} -gt 0 ]]; then
  echo "" >&2
  echo "[clade pre-push] ✗ ${#failed_names[@]} 個 check 失敗：" >&2
  for f in "${failed_names[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
