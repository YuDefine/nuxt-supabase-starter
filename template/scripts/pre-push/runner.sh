#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/runner.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/runner.sh
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
#   8 個 check 彼此獨立（typecheck 寫 .nuxt/，其餘皆唯讀掃描，無共享寫入），
#   序列跑等於把每個 check 的耗時相加。<consumer-b> 實測序列 ≈ 98s，其中
#   nuxt-typecheck 57.9s + review-rules-ratchet 39.2s 佔 99%，其餘五項合計
#   < 0.6s。propagate.ts 的 push timeout 是 120s，序列跑的餘裕薄到會被機器
#   負載變異衝破（v1.4.340 / .341 / .342 連續三版在 propagate 內 timeout，
#   每次都要事後手動補跑）。並行後 wall time 由最慢的單一 check 決定。
#
#   設計對齊 scripts/lib/gate-runner.ts：**全部跑完**才報告，不第一個失敗
#   就中止——一次 push 就看到所有問題，不必修一條重跑一次。8 個 check 全數
#   保留、全數仍 blocking，並行只改執行順序，不改任何判定。
#   CLADE_PREPUSH_SERIAL=1 可退回序列（debug 用；輸出即時不緩衝）。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
# PROJECT_ROOT 允許被 CLADE_PROJECT_ROOT 覆寫。meta-monorepo（app root 在子目錄，例如
# nuxt-supabase-starter 的 template/）的 app root ≠ git toplevel，而各 check 的 auto-detect 是
# 「找不到 nuxt.config 就 exit 0」，直接用 toplevel 會讓那幾道 check 全部靜默 no-op。
# 未設 CLADE_PROJECT_ROOT 時行為與過去完全一致（既有 consumer 零影響）。
#
# NEVER 只改這裡：下方是並行 spawn 各 check 的獨立 bash 程序，每支 check 會自己再
# 推導一次 PROJECT_ROOT 並 cd，所以每一支 checks/*.sh 必須各自帶同一個覆寫。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"

cd "$PROJECT_ROOT"

# --- push refs（MUST 在 spawn 平行 check 之前讀）----------------------------
# git 把本次 push 的 refs 一行一筆餵進 pre-push hook 的 stdin，格式：
#   <local_ref> <local_sha> <remote_ref> <remote_sha>
# 那是**一次性 stream**：下方平行 spawn 的 subshell 共用同一個 stdin，誰先讀誰拿到，
# 其餘的拿到 EOF。所以 MUST 在這裡一次讀完落成檔，再用 env 交給需要的 check。
#
# `[ -t 0 ]` 守著手動執行（bash scripts/pre-push/runner.sh）—— 那時 stdin 是 tty，
# 直接 cat 會卡住不動。非 tty 但沒有內容（< /dev/null）則立即回，refs 檔為空。
#
# 既有各支 check 都不讀 stdin，讀完後它們拿到的 stdin 停在 EOF —— 行為零改變。
REFS_FILE="$(mktemp "${TMPDIR:-/tmp}/clade-prepush-refs.XXXXXX")"
CHANGED_FILE="$(mktemp "${TMPDIR:-/tmp}/clade-prepush-changed.XXXXXX")"
trap 'rm -f "$REFS_FILE" "$CHANGED_FILE"' EXIT
if [[ ! -t 0 ]]; then
  cat > "$REFS_FILE" || true
fi
export CLADE_PREPUSH_REFS_FILE="$REFS_FILE"

# 宣告順序 = 輸出順序（並行執行，但輸出仍依此序印出，讓 log 可預期）
CHECKS=(
  tag-position          # push 帶 tag 時驗 tag 不落後 default branch（blocking；無 tag 則零成本 no-op）
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

# --- path relevance（決定哪幾支 check 與本次 push 無關）-----------------------
# 8 支 check 原本只靠 auto-detect nuxt.config.* 決定跑不跑，沒有一支看 diff 範圍：推一筆
# 只動 docs/** 的 commit 照樣跑一次 full project typecheck ＋ 6 支全站 .vue 掃描。<consumer-a>
# 2026-08-29 實測：12 筆純文件 commit 分兩次 push，每次 >14 分鐘，而 diff 裡一個 .ts /
# .vue 都沒有——那些 check 在結構上不可能有發現。
#
# 命中 = 整支照原樣跑（全站掃描不變）；不命中 = 整支 skip。
# NEVER 把本段讀成「只掃 diff 內的那幾個檔」：native-picker-ban / mutation-loading /
# review-rules-ratchet 是**回溯型**，設計目的就是補 pre-commit staged 版的盲區、擋歷史存量。
# 縮小掃描範圍會讓它們退化成 pre-commit 的重複品，回溯能力整個弄丟。
#
# 算不出 changed paths 時一律 **fail-open 全部照跑**（新 branch 首推、手動執行、remote_sha
# 在本地不存在）。NEVER 把「算不出來」當成「沒有 changed paths」而全部 skip。

ZERO_SHA='0000000000000000000000000000000000000000'

# 把本次 push 每一條 branch ref 的 <remote_sha>..<local_sha> diff 印到 stdout。
# 回 1 = 算不出來（呼叫端 fail-open）。
compute_changed_paths() {
  local local_ref local_sha remote_ref remote_sha saw_branch=0
  # refs 檔為空 = 手動執行（stdin 是 tty）或 push 沒餵 refs → 算不出來
  [[ -s "$REFS_FILE" ]] || return 1
  while read -r local_ref local_sha remote_ref remote_sha; do
    [[ -n "${local_ref:-}" ]] || continue
    # 刪除 ref：沒有內容可言
    [[ "$local_sha" == "$ZERO_SHA" ]] && continue
    # tag ref 的位置由 tag-position 管，內容範圍不由它決定
    [[ "${remote_ref:-}" == refs/tags/* ]] && continue
    saw_branch=1
    # remote_sha 全 0 = remote 尚無該 ref（新 branch 首推）→ 沒有 diff base，fail-open
    [[ -z "${remote_sha:-}" || "$remote_sha" == "$ZERO_SHA" ]] && return 1
    git rev-parse --quiet --verify "${remote_sha}^{commit}" >/dev/null 2>&1 || return 1
    git diff --name-only "$remote_sha" "$local_sha" || return 1
  done < "$REFS_FILE"
  # 只推 tag（沒有任何 branch ref）→ 不做 path skip
  [[ "$saw_branch" == 1 ]] || return 1
}

# 每支 check 的 path relevance globs（bash `[[ str == pat ]]` 語意，`*` 會跨 `/`）。
relevance_globs() {
  case "$1" in
    # 與 path 無關：push 帶不帶 tag 才是它的判準，維持永遠跑
    tag-position) echo '*' ;;
    nuxt-typecheck)
      echo '*.ts *.tsx *.mts *.cts *.vue nuxt.config.* */nuxt.config.* package.json */package.json tsconfig*.json */tsconfig*.json' ;;
    # 五支全站 .vue 掃描。detector 本身被改動時也要跑：新 detector 會在既有存量上有新發現。
    native-picker-ban|data-perf-check|mutation-loading|nuxt-ui-mixed-slot|utable-slots)
      echo '*.vue scripts/checks/* vendor/scripts/checks/*' ;;
    # 規則自身異動一律跑；規則的 fileGlob 另外問 scan.ts（見 check_is_relevant）
    review-rules-ratchet) echo 'vendor/review-rules/* review-rules-baseline.json' ;;
    *) echo '*' ;;
  esac
}

# 回 0 = 這支 check 與本次 push 相關（要跑）；回 1 = 無關（可 skip）。
check_is_relevant() {
  local name="$1" g p rc
  # NEVER 寫成 `for g in $globs`：未加引號的展開會先做 pathname expansion，`*.vue`
  # 當場被 cwd 底下的檔名取代，pattern 就不再是 pattern 了。`read -ra` 只做斷詞。
  local -a globs=()
  IFS=' ' read -ra globs <<< "$(relevance_globs "$name")"
  while read -r p; do
    [[ -n "$p" ]] || continue
    for g in "${globs[@]}"; do
      # shellcheck disable=SC2053  # 右側刻意不加引號：這裡要的就是 glob 比對
      [[ "$p" == $g ]] && return 0
    done
  done < "$CHANGED_FILE"

  if [[ "$name" == 'review-rules-ratchet' && -f vendor/review-rules/scan.ts ]]; then
    # 規則的 fileGlob 住在 patterns.json，會改。NEVER 在這裡複製一份 matcher——
    # 直接問 scan.ts 自己那一支 matchFileGlob。exit 3 = 這批路徑一條規則都碰不到；
    # 其餘任何 exit code（含錯誤）都當「算不出來」→ 照跑。
    if node vendor/review-rules/scan.ts --relevant-from "$CHANGED_FILE" --layer all >/dev/null 2>&1; then
      return 0
    fi
    rc=$?
    [[ "$rc" == '3' ]] && return 1
    return 0
  fi

  return 1
}

PATH_FILTER_ACTIVE=1
if ! compute_changed_paths > "$CHANGED_FILE"; then
  PATH_FILTER_ACTIVE=0
  : > "$CHANGED_FILE"
fi

# skip 必須看得見：靜默 skip 會讓下一個人以為 gate 跑過了。
SKIP_MSG=()
for i in "${!CHECKS[@]}"; do
  SKIP_MSG[$i]=''
done
if [[ "$PATH_FILTER_ACTIVE" == '1' ]]; then
  changed_n="$(grep -c . "$CHANGED_FILE" || true)"
  echo "[clade pre-push] path filter: 本次 push 有 ${changed_n} 個 changed path"
  for i in "${!CHECKS[@]}"; do
    name="${CHECKS[$i]}"
    if ! check_is_relevant "$name"; then
      SKIP_MSG[$i]="⏭  [clade pre-push] $name skipped — 本次 push 的 ${changed_n} 個 changed path 不含 $(relevance_globs "$name")"
    fi
  done
else
  echo "[clade pre-push] path filter: 算不出 changed paths（新 branch 首推 / 手動執行 / 只推 tag）→ 全部照跑"
fi

# --- 序列模式（debug）-----------------------------------------------------
if [[ -n "${CLADE_PREPUSH_SERIAL:-}" ]]; then
  for i in "${!CHECKS[@]}"; do
    name="${CHECKS[$i]}"
    if [[ -n "${SKIP_MSG[$i]}" ]]; then
      echo "${SKIP_MSG[$i]}"
      continue
    fi
    bash "$CHECKS_DIR/$name.sh"
  done
  exit 0
fi

# --- 並行模式（預設）-----------------------------------------------------
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clade-prepush.XXXXXX")"
# NEVER 只寫 rm -rf "$RUN_DIR"：那會覆蓋上方 REFS_FILE 的 trap（EXIT trap 只有一個），
# 讓每次 push 在 TMPDIR 留一個 refs 檔。兩個都要清。
trap 'rm -rf "$RUN_DIR"; rm -f "$REFS_FILE" "$CHANGED_FILE"' EXIT

pids=()
for i in "${!CHECKS[@]}"; do
  name="${CHECKS[$i]}"
  if [[ -n "${SKIP_MSG[$i]}" ]]; then
    printf '%s\n' "${SKIP_MSG[$i]}" >"$RUN_DIR/$i.out"
    echo 0 >"$RUN_DIR/$i.rc"
    continue
  fi
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
