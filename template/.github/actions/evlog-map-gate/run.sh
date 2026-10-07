#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/actions/evlog-map-gate/run.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/actions/evlog-map-gate/run.sh
# CLADE:VENDOR-SCRIPT
#
# evlog-map-gate — action 本體。CI 與本機跑的是同一支：
#
#   - CI：action.yml 的 composite step 把 inputs 設成 INPUT_* 後 `bash "$GITHUB_ACTION_PATH/run.sh"`
#   - 本機：local.ts 讀 consumer workflow 裡這個 action 的 `with:`，設同樣的 INPUT_* 後呼叫本檔
#
# NEVER 在 action.yml 或 local.ts 另寫一份判定：兩份會各自漂移，而「本機綠、CI 紅」正是
# 本機入口要消滅的東西。
#
# 輸入（env）：INPUT_BASE_REF / INPUT_CWD / INPUT_BASELINE / INPUT_MODE / INPUT_MIN_SCORE
# 本機專用（CI 不設）：EVLOG_GATE_EXTRA_CHANGED — 一個檔，內容併進變更檔清單。放的是未 commit
#   與 untracked 的檔：CI checkout 出來的樹沒有這兩類，只有 commit 之前在本機跑時才有意義。

set -euo pipefail

INPUT_BASE_REF="${INPUT_BASE_REF:-origin/main}"
INPUT_CWD="${INPUT_CWD:-.}"
INPUT_BASELINE="${INPUT_BASELINE:-evlog.map.json}"
# mode 刻意沒有預設：空字串照樣交給 gate.ts，由它以 exit 2 拒絕（見 action.yml 的 mode 說明）
INPUT_MODE="${INPUT_MODE:-}"
INPUT_MIN_SCORE="${INPUT_MIN_SCORE:-100}"

ACTION_DIR="${GITHUB_ACTION_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
GATE_ENGINE="$ACTION_DIR/gate.ts"

# CI 上印 workflow annotation；本機退化成純文字前綴（同 gate.ts 的 annotate）
annotate() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    echo "::$1::$2"
  else
    echo "[$1] $2"
  fi
}

# 走到這裡代表 workflow 明寫了這個 action（本機則是 local.ts 在 workflow 裡找到它）＝已導入。
# 引擎或 CLI 缺失是「沒有能力執行」，不是「沒有 applicable target」：fail-closed，
# NEVER 印 skip 再 exit 0（checker-contract § Fail-closed Iron Law）。刪掉 gate.ts、少裝
# @evlog/cli、propagate 不完整都屬於這種情況，一律 exit 2。
if [ ! -f "$GATE_ENGINE" ]; then
  annotate error "infrastructure-error: gate.ts not found next to run.sh — the vendored action is incomplete (re-run clade propagate); the gate did NOT run"
  exit 2
fi

# @evlog/cli 宣告在哪個 package.json 取決於 app 根在哪：app 根 ≠ repo 根時
# （starter 的 template/、monorepo 的 apps/web）依賴跟著 app 走，而 repo 根
# 可能根本沒有 package.json。只看 repo 根會把已導入的 app 誤判成沒宣告。
#
# 路徑 MUST 先 resolve 成絕對路徑再 require：`require('template/package.json')` 會被當成
# 套件名去 node_modules 找，MODULE_NOT_FOUND 被 2>/dev/null 吞掉 → 判成「沒宣告」，
# 而「沒宣告」是 exit 2：app 根在子目錄的 repo 會被誤擋。
FIRST_CWD="$(printf '%s' "$INPUT_CWD" | head -1 | tr -d '[:space:]')"
[ -z "$FIRST_CWD" ] && FIRST_CWD=.
HAS_CLI=0
for candidate in "$FIRST_CWD/package.json" "./package.json"; do
  [ -f "$candidate" ] || continue
  if node -e "const j=require(require('node:path').resolve(process.argv[1]));const d={...j.dependencies,...j.devDependencies};process.exit(d['@evlog/cli']?0:1)" "$candidate" 2>/dev/null; then
    HAS_CLI=1
    break
  fi
done

if [ "$HAS_CLI" -eq 0 ]; then
  annotate error "infrastructure-error: @evlog/cli not declared in $FIRST_CWD/package.json or ./package.json — the gate cannot run (pnpm add -D @evlog/cli, or remove this step from the workflow if evlog map is not adopted here). See vendor/snippets/evlog-map/README.md"
  exit 2
fi

# 取本次變更檔清單。base-ref 抓不到（shallow clone / 首次 push）時退化成
# 空清單 —— gate.ts 會警告並跳過「觸及的 entry point 必須滿分」那條判定，
# 但全域分與 suppressed 兩條仍照跑。
CHANGED_FILES="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/evlog-map-changed.XXXXXX")"
trap 'rm -f "$CHANGED_FILES"' EXIT
if git rev-parse --verify "$INPUT_BASE_REF" >/dev/null 2>&1; then
  git diff --name-only --diff-filter=ACMR "$INPUT_BASE_REF"...HEAD > "$CHANGED_FILES"
else
  annotate warning "base ref '$INPUT_BASE_REF' not resolvable — checkout with fetch-depth: 0 to enable the per-entry-point check"
  : > "$CHANGED_FILES"
fi
if [ -n "${EVLOG_GATE_EXTRA_CHANGED:-}" ] && [ -f "$EVLOG_GATE_EXTRA_CHANGED" ]; then
  cat "$EVLOG_GATE_EXTRA_CHANGED" >> "$CHANGED_FILES"
fi

# cwd 可以是多行（Nuxt layer monorepo：一行一個 layer），逐行展開成
# 可重複的 --cwd。每個 scan root 各自帶 <root>/evlog.map.json baseline。
CWD_ARGS=()
while IFS= read -r line; do
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [ -n "$line" ] && CWD_ARGS+=(--cwd "$line")
done <<< "$INPUT_CWD"
[ ${#CWD_ARGS[@]} -eq 0 ] && CWD_ARGS=(--cwd .)

node "$GATE_ENGINE" \
  --baseline "$INPUT_BASELINE" \
  --changed-files "$CHANGED_FILES" \
  "${CWD_ARGS[@]}" \
  --mode "$INPUT_MODE" \
  --min-score "$INPUT_MIN_SCORE"
