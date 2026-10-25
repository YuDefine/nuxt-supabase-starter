#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/nuxt-typecheck.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/nuxt-typecheck.sh
# CLADE:VENDOR-SCRIPT
#
# nuxt-typecheck — pre-push 跑一次 full project typecheck
#
# Auto-detect：偵測 nuxt.config.* 存在才跑。
#
# Multi-client / layered repos：偵測到 package.json 有 `typecheck` script 時
# 改跑 `pnpm typecheck`（consumer 自家定義的正確 invocation），不跑 bare
# `nuxt typecheck`。理由：per-client module isolation 等架構下 root nuxt.config
# 可能刻意不 extend app layers，bare root typecheck 會把各 client layer 的
# auto-import 全報成 false「Cannot find name」。consumer 的 typecheck script
# 才知道要 client-scoped（`nuxt typecheck <client> --dotenv ...`）。
# 無 typecheck script 的單一 app repo 仍 fallback bare `nuxt typecheck`。

set -euo pipefail

# PROJECT_ROOT 允許被 CLADE_PROJECT_ROOT 覆寫。meta-monorepo（app root 在子目錄，例如
# starter 型 repo 的 template/）的 app root ≠ git toplevel，而下方 auto-detect 是
# 「找不到 nuxt.config 就 exit 0」，直接用 toplevel 會讓這道 check 靜默 no-op。
# 未設 CLADE_PROJECT_ROOT 時行為與過去完全一致（既有 consumer 零影響）。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$PROJECT_ROOT"

# 補透傳 fallback shim（../ensure-gate-shim.sh）；檔案缺席（舊投影）或補不成 → 回傳非 0，照舊 fail closed。
clade_ensure_gate_shim_here() {
  local f
  f="$(dirname "${BASH_SOURCE[0]}")/../ensure-gate-shim.sh"
  [[ -f "$f" ]] || return 1
  # shellcheck source=../ensure-gate-shim.sh
  source "$f" && clade_ensure_gate_shim
}

# 本檔所有 pnpm 呼叫一律經這裡：關掉 verify-deps-before-run。clade 散播的 .npmrc 設了
# `verify-deps-before-run=install`，裸 `pnpm exec`／`pnpm run` 會在 package.json 有變時先跑完整
# install＋postinstall bootstrap（同 pre-commit vp-staged，W-2026-09-27-precommit-vp-staged-pnpm-exec-install）。
pnpm_nodeps() {
  pnpm --config.verify-deps-before-run=false "$@"
}

# Auto-detect
nuxt_config=""
for ext in ts mts js mjs; do
  if [[ -f "nuxt.config.$ext" ]]; then
    nuxt_config="nuxt.config.$ext"
    break
  fi
done
[[ -n "$nuxt_config" ]] || exit 0

# Prefer the consumer-defined `typecheck` npm script when present (multi-client /
# layered repos need client-scoped typecheck that bare root invocation can't express).
if node -e "process.exit(require('./package.json').scripts?.typecheck ? 0 : 1)" 2>/dev/null; then
  # 裸寫 `.clade/bin/clade-gate run …` 的 script 在沒有 shim 的新 clone（cloud session VM、CI
  # checkout）只會回 `sh: .clade/bin/clade-gate: not found`，看不出是 gitignored 投影缺席。
  # 裸寫就在 typecheck 本身 → 去掉 shim 前綴直跑原命令並印警告，與 guard 形同義（品質檢查照跑，只少
  # 准入與 signal）；cloud VM 沒有 clade 可跑投影，fail closed 只會讓 cloud session 推不出去。
  # 裸寫在轉呼的內層 script → 改不動：`.clade/` 被 gitignore 時補一支透傳 fallback shim 讓它照跑（../ensure-gate-shim.sh）；補不成（沒被 ignore、舊投影缺檔）才 fail closed 並印出可行動的修法——NEVER 因為 shim 缺席就略過 typecheck。
  # guard 形（含 `test -x`）在 shim 缺席時會 fallback 直跑原命令，不走這條。
  # 逐個呼叫點判定（跟著 pnpm／npm／yarn 轉呼最多 3 層）：呼叫緊接在 `test -x <shim>`／`[ -x <shim> ]`
  # 的 `; then`／`&&` 之後才算有 guard。判定同 scripts/audit-gate-coverage.ts 的 unguardedShim，
  # 改一邊要改另一邊（vendor/scripts/pre-push/runner.sh 與 checks/nuxt-typecheck.sh 各有一份）。
  IFS= read -r -d '' shim_js <<'JS' || true
const s = require('./package.json').scripts || {}
const call = /(^|[\s&;|('"])(?:\.\/)?\.clade\/bin\/clade-gate\s+run\s/g
const guard = /(?:\btest\s+-x\s+\S*clade-gate|\[\[?\s+-x\s+\S*clade-gate\s+\]\]?)\s*(?:&&|;\s*then)\s*(?:exec)?$/
const deleg = /(?:&&|^|\|\||;|\(|['"])\s*(?:pnpm|npm|yarn)\s+(?:run\s+)?([\w:.@/-]+)/g
const bad = (t) => [...t.matchAll(call)].some((m) => !guard.test(t.slice(0, m.index + m[1].length).trimEnd()))
const seen = new Set()
function walk(name, depth) {
  const t = s[name]
  if (typeof t !== 'string' || seen.has(name)) return ''
  seen.add(name)
  if (bad(t)) return name
  if (depth >= 3) return ''
  for (const m of t.matchAll(deleg)) { const hit = walk(m[1], depth + 1); if (hit) return hit }
  return ''
}
const hit = walk(process.argv[1], 0)
// 第三欄＝去掉裸 shim 前綴後的原命令：只在裸寫就在被呼叫的那支 script、去掉後再無裸呼叫時給，
// 否則留空（內層裸寫改不動，照舊 fail closed）。
const bare = /(^|[\s&;|('"])(?:\.\/)?\.clade\/bin\/clade-gate\s+run\s+\S+\s+--\s+/g
const direct = hit === process.argv[1] ? s[hit].replace(bare, '$1').trim() : ''
if (hit) process.stdout.write(hit + '\t' + s[hit] + '\t' + (direct && !bad(direct) ? direct : ''))
JS
  unguarded="$(node -e "$shim_js" typecheck 2>/dev/null || true)"
  direct="${unguarded#*$'\t'}"
  direct="${direct#*$'\t'}"
  if [[ -n "$unguarded" && -n "$direct" && ! -x .clade/bin/clade-gate ]]; then
    {
      echo "[clade pre-push] ⚠ nuxt-typecheck：package.json 的 typecheck script 直呼 .clade/bin/clade-gate，但這個 clone 沒有該檔（gitignored 投影）"
      echo "[clade pre-push]   改直跑原命令（typecheck 照跑，只少准入與 signal）：$direct"
      echo "[clade pre-push]   根治：node <clade>/vendor/scripts/install-clade-gate.ts <consumer> 把裸寫改成 arg-safe guard。"
    } >&2
    echo "🔍 nuxt typecheck (via consumer 'typecheck' script, shim 缺席直跑)..."
    exec pnpm --config.verify-deps-before-run=false exec sh -c "$direct"
  fi
  if [[ -n "$unguarded" && ! -x .clade/bin/clade-gate ]] && clade_ensure_gate_shim_here; then
    # 裸寫在轉呼的內層（改不動）：補一支透傳 shim 讓它照跑，不 fail closed。
    unguarded="${unguarded%$'\t'*}"
    {
      echo "[clade pre-push] ⚠ nuxt-typecheck：package.json 的 ${unguarded%%$'\t'*} script 直呼 .clade/bin/clade-gate，但這個 clone 沒有該檔（gitignored 投影）"
      echo "[clade pre-push]   已補透傳 fallback shim .clade/bin/clade-gate（typecheck 照跑，只少准入與 signal；propagate 會換成真的）。"
      echo "[clade pre-push]   根治：node <clade>/vendor/scripts/install-clade-gate.ts <consumer> 把裸寫改成 arg-safe guard。"
    } >&2
  elif [[ -n "$unguarded" && ! -x .clade/bin/clade-gate ]]; then
    unguarded="${unguarded%$'\t'*}"
    {
      echo "[clade pre-push] ✗ nuxt-typecheck：package.json 的 ${unguarded%%$'\t'*} script 直呼 .clade/bin/clade-gate，但這個 clone 沒有該檔"
      echo "[clade pre-push]   script: ${unguarded#*$'\t'}"
      echo "[clade pre-push]   .clade/bin/clade-gate 是 gitignored 投影（propagate／wt seed 才會寫），cloud session VM 與 CI 新 clone 不存在。"
      echo "[clade pre-push]   修法（在 clade 跑）：node <clade>/vendor/scripts/install-clade-gate.ts <consumer> 會把裸寫改成 arg-safe guard；"
      echo "[clade pre-push]   形狀見 vendor/snippets/clade-gate-package-scripts/README.md。typecheck 不會因此被略過，這裡是擋下並說明。"
    } >&2
    exit 1
  fi
  echo "🔍 nuxt typecheck (via consumer 'typecheck' script)..."
  pnpm_nodeps run typecheck
else
  echo "🔍 nuxt typecheck (full project)..."
  pnpm_nodeps exec nuxt typecheck
fi
