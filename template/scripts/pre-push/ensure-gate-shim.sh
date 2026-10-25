#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/ensure-gate-shim.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/ensure-gate-shim.sh
# CLADE:VENDOR-SCRIPT
#
# ensure-gate-shim — 新 clone（cloud session VM、CI checkout）沒有 gitignored 的
# `.clade/bin/clade-gate` 時，補一支只透傳的 fallback shim。
#
# 為什麼：consumer 的 package.json 可以把裸寫 `.clade/bin/clade-gate run …` 放在轉呼的內層
# script（`typecheck` → `pnpm typecheck:x`）。pre-push 的 nuxt-typecheck／test-typecheck 改不動內層
# 的字串，只能 fail closed，cloud VM 沒有 clade 可跑 install-clade-gate.ts，session 就推不出去。
# 在 `.clade/` 被 gitignore 的前提下補一支透傳 shim：任何深度的裸寫都能跑，品質檢查照跑
# （只少准入 slot 與 signal），不動追蹤檔。
#
# 退回條件（回傳非 0，呼叫端照舊 fail closed）：
#   - `.clade/bin/clade-gate` 的路徑沒被 git ignore（寫了會弄髒工作樹，不補）
#   - 目錄建不起來／檔寫不進去
# 已存在 `.clade/bin/clade-gate`（真的或先前補的）→ 不動，回傳 0。
# propagate／wt seed 會用真的 shim 整檔覆蓋它。
#
# 用法：source 之後呼叫 `clade_ensure_gate_shim`；工作目錄要在 PROJECT_ROOT。

clade_ensure_gate_shim() {
  local shim='.clade/bin/clade-gate'
  [[ -x "$shim" ]] && return 0
  git check-ignore -q -- "$shim" 2>/dev/null || return 1
  mkdir -p .clade/bin 2>/dev/null || return 1
  cat > "$shim" <<'SHIM' || return 1
#!/bin/sh
# CLADE:CLOUD-FALLBACK-SHIM — 透傳 fallback，不是真的 clade-gate（沒有准入 slot、沒有 signal）。
# 由 scripts/pre-push/ensure-gate-shim.sh 在 gitignored 投影缺席時補上；
# `node <clade>/scripts/propagate.ts` 或 wt seed 會用真的 shim 覆蓋。
if [ "$1" != run ]; then
  echo "clade-gate (fallback shim): 只支援 'run <gate> -- <cmd...>'，收到 '$*'" >&2
  exit 2
fi
shift
[ "$#" -gt 0 ] && shift
[ "${1:-}" = -- ] && shift
if [ "$#" -eq 0 ]; then
  echo "clade-gate (fallback shim): run 後面沒有命令" >&2
  exit 2
fi
exec "$@"
SHIM
  chmod +x "$shim" || return 1
}
