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
#   8 個 check 彼此獨立（typecheck 寫 .nuxt/，其餘皆唯讀掃描，無共享寫入），
#   序列跑等於把每個 check 的耗時相加。<consumer-b> 2026-07-26 實測序列 ≈ 98s，其中
#   nuxt-typecheck 57.9s + review-rules-ratchet 39.2s 佔 99%，其餘五項合計
#   < 0.6s。當時 propagate.ts 的 push timeout 是 120s，序列跑的餘裕薄到會被機器
#   負載變異衝破（v1.4.340 / .341 / .342 連續三版在 propagate 內 timeout，
#   每次都要事後手動補跑）。並行後 wall time 由最慢的單一 check 決定。
#
#   ⚠ 上面那組數字是 2026-07-26 的量測，**已經過期**：<consumer-b> 2026-09-07 重量得
#   暖路徑單跑 nuxt-typecheck 2m29s、冷路徑 push 全程 9m22s wall / 4m26s user，
#   差 2.5–9 倍（TD-995）。註解裡寫死的效能基準沒有任何東西會讓它過期報錯 ——
#   讀到這裡要據此做決定之前 MUST 自己重量一次，NEVER 直接引用這些數字。
#   push timeout 現在也不是單一常數：全域 NETWORK_PUSH_TIMEOUT_MS 300s，
#   逐 consumer 由 registry/consumers.json 的 push_timeout_ms 覆寫（<consumer-b> 900s）。
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

# --- nuxt-typecheck 專屬：clade managed `.ts` 不算 typecheck-relevant ---------------
# propagate 推的「升級 clade」sync commit 幾乎每筆都改到 `.ts`，但那些是 `scripts/**`、
# `vendor/{scripts,review-rules,...}/**` 這類 clade 投影檔：consumer 的 `.nuxt/tsconfig.json`
# include 不含它們（2026-09-24 實測 W-2026-09-16-delivery-throughput H3），近 25 筆 sync commit
# 有 72–84% 的 typecheck-relevant 檔只落在這類，卻每筆都排一次 heavy slot 跑完整 typecheck。
#
# managed 的判定依據是**投影時注入的 LOCKED banner**（`scripts/lib/vendor-banner.ts`
# `VENDOR_BANNER_SIGNATURE`），不是源檔手寫的 `// CLADE:VENDOR-SCRIPT`：後者約 1/3 vendor
# script 沒有、也沒有任何程式讀它；而 sync-vendor 對每一支可註解的非 snippet 投影檔都注 banner，
# 所以帶手寫 marker 的檔同時也帶 banner，只認 banner 不漏任何一支。也不用投影 state：
# vendor 投影沒有逐檔 ownership state，`.clade/flow/last-propagate.json` 只記最後一輪。
#
# 例外（NEVER 跳過）：被 nuxt.config.* / vitest.config.* import 的檔（及其相對 import 閉包）——
# 它們在 typecheck 圖內（現為 vendor/doctor-shared/**、vendor/oxc-shared/**）。這份清單
# **每次執行期從 config 的 import 推導**，NEVER 寫死：config 改 import，清單自己跟著變。
#
# 任何一步判不出來（讀不到 config、無法解析的 import、banner 讀不到）一律當 relevant →
# 照跑 typecheck（= 本段存在之前的行為）。NEVER 讓判定失敗變成 skip。
# CLADE_PREPUSH_NO_MANAGED_SKIP=1 關掉本段（debug / 回退用）。
MANAGED_BANNER='🔒 LOCKED — managed by clade · Source: '
MANAGED_IGNORED_N=0
CONFIG_CLOSURE=''        # 換行分隔、以 git toplevel 為基準的路徑；前後各一個換行方便 case 比對
CONFIG_CLOSURE_STATE=''  # '' = 未算；ok；fail
GIT_TOPLEVEL=''          # is_ignorable_managed_ts 首次需要時才算
PUSH_TIP=''              # 本次 push 唯一的 branch tip；'-' = 多個或算不出（不跳過）

# 路徑正規化（處理 . / ..，不碰檔案系統；不依賴 GNU realpath -m，macOS bash 3.2 也能跑）。
# 超出 repo root 回 1。
normalize_rel_path() {
  local in="$1" part out=''
  local -a parts=() stack=()
  IFS='/' read -ra parts <<< "$in"
  for part in "${parts[@]}"; do
    case "$part" in
      '' | .) ;;
      ..)
        [[ ${#stack[@]} -gt 0 ]] || return 1
        unset "stack[$((${#stack[@]} - 1))]"
        stack=("${stack[@]+"${stack[@]}"}")
        ;;
      *) stack+=("$part") ;;
    esac
  done
  for part in "${stack[@]+"${stack[@]}"}"; do
    out="${out:+$out/}$part"
  done
  printf '%s\n' "$out"
}

# 相對 specifier → 實際存在的檔（相對 PROJECT_ROOT）。回 1 = 解析不到；回 2 = 在 repo 外。
resolve_import() {
  local from_dir="$1" spec="$2" base cand
  if [[ -n "$from_dir" ]]; then
    base="$(normalize_rel_path "$from_dir/$spec")" || return 2
  else
    base="$(normalize_rel_path "$spec")" || return 2
  fi
  [[ -n "$base" ]] || return 1
  for cand in "$base" "$base.ts" "$base.mts" "$base.cts" "$base.tsx" "$base.js" "$base.mjs" \
    "$base.cjs" "$base/index.ts" "$base/index.mts" "$base/index.js" "$base/index.mjs"; do
    if [[ -f "$cand" ]]; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  # TS ESM 慣例：`import './x.js'` 指向 x.ts
  case "$base" in
    *.js) cand="${base%.js}.ts" ;;
    *.mjs) cand="${base%.mjs}.mts" ;;
    *.cjs) cand="${base%.cjs}.cts" ;;
    *) return 1 ;;
  esac
  [[ -f "$cand" ]] || return 1
  printf '%s\n' "$cand"
}

# 從 nuxt.config.* / vitest.config.* 出發，沿相對 import 走完閉包，結果寫進 CONFIG_CLOSURE。
# 回 1 = 判不出來（呼叫端 MUST 當 relevant 照跑）。
compute_config_closure() {
  local prefix f content spec dir resolved rc n=0
  local -a queue=() specs=()
  prefix="$(git rev-parse --show-prefix 2>/dev/null)" || return 1
  CONFIG_CLOSURE=$'\n'
  for f in nuxt.config.* vitest.config.*; do
    [[ -e "$f" ]] || continue
    queue+=("$f")
    CONFIG_CLOSURE+="${prefix}${f}"$'\n'
  done
  while [[ ${#queue[@]} -gt 0 ]]; do
    f="${queue[0]}"
    queue=("${queue[@]:1}")
    n=$((n + 1))
    # 閉包爆量（config import 進整個 app）就不再是「少數例外」，判不出來 → 照跑
    [[ "$n" -le 500 ]] || return 1
    content="$(cat -- "$f")" || return 1
    dir="$(dirname -- "$f")"
    [[ "$dir" == '.' ]] && dir=''
    # 兩種來源，各自的誤判面不同：
    #   ① 靜態 import／re-export 陳述句：只認**行首**是 `import` / `export` / `}` 的行。
    #       config 常在字串／template literal 裡**產生**程式碼（<consumer-a> 的
    #       `` `import { baseURL } from '#internal/nuxt/paths'` ``、<consumer-d> 說明字串裡的
    #       `import logo from '@/assets/...'`），那些行首是引號，不是 import。註解行
    #       （preset 的 usage 範例 `//   import ... from './vendor/...'`）同樣不在行首規則內。
    #   ② 任意位置的 `import('...')` / `require('...')`：只追**相對** specifier。
    specs=()
    while IFS= read -r spec; do
      [[ -n "$spec" ]] && specs+=("$spec")
    done < <(
      printf '%s\n' "$content" \
        | grep -E "^[[:space:]]*(import|export|\})[^'\"]*['\"][^'\"]+['\"]" \
        | grep -E "^[[:space:]]*import[[:space:]]*['\"]|from[[:space:]]*['\"]" \
        | sed -E "s/^.*(from[[:space:]]*|import[[:space:]]*)['\"]([^'\"]+)['\"].*$/\2/" || true
      printf '%s\n' "$content" \
        | grep -vE '^[[:space:]]*(//|/\*|\*)' \
        | grep -oE "(import|require)[[:space:]]*\([[:space:]]*['\"]\.{1,2}/[^'\"]+['\"]" \
        | sed -E "s/^[^'\"]*['\"]([^'\"]+)['\"].*$/\1/" || true
    )
    for spec in "${specs[@]+"${specs[@]}"}"; do
      case "$spec" in
        ./* | ../*) ;;
        # 靜態 import 的 alias / 絕對路徑 / subpath import：本段不重做 bundler 的解析 → 判不出來
        '~'* | @/* | '#'* | /*) return 1 ;;
        # 裸 package specifier（含 node:）不在 repo 內
        *) continue ;;
      esac
      rc=0
      resolved="$(resolve_import "$dir" "$spec")" || rc=$?
      [[ "$rc" == 2 ]] && continue  # repo 外的檔不可能出現在本次 diff
      [[ "$rc" == 0 ]] || return 1
      case "$CONFIG_CLOSURE" in
        *$'\n'"${prefix}${resolved}"$'\n'*) continue ;;
      esac
      CONFIG_CLOSURE+="${prefix}${resolved}"$'\n'
      case "$resolved" in
        *.ts | *.mts | *.cts | *.tsx | *.js | *.mjs | *.cjs) queue+=("$resolved") ;;
      esac
    done
  done
  return 0
}

# 回 0 = 這個 changed path（以 git toplevel 為基準）是可忽略的 managed `.ts`。
is_ignorable_managed_ts() {
  local p="$1" head
  case "$p" in
    *.ts | *.tsx | *.mts | *.cts) ;;
    *) return 1 ;;
  esac
  # 路徑相對 git toplevel（PROJECT_ROOT 可能是子目錄，如 starter 的 template/）；只算一次。
  if [[ -z "$GIT_TOPLEVEL" ]]; then
    GIT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  fi
  # 只有 project 的 scripts/、vendor/ 底下在 app／server 的 typecheck 圖外（H3）。帶 banner 的投影
  # 也會落在 app/utils、server/plugins（starter 的 evlog-*），那些 NEVER 跳過。
  local prefix="${PROJECT_ROOT#"$GIT_TOPLEVEL"}"
  prefix="${prefix#/}"
  [[ -n "$prefix" ]] && prefix="$prefix/"
  case "$p" in
    "${prefix}scripts/"* | "${prefix}vendor/"*) ;;
    *) return 1 ;;
  esac
  # banner 讀被 push 的 blob，不讀 working tree（pushed ref 不一定是 HEAD、樹可能 dirty）。
  # 本次 push 只有一個 branch tip 時才判；多 tip 或讀不到 fail-open。
  if [[ -z "$PUSH_TIP" ]]; then
    PUSH_TIP="$(awk -v z="$ZERO_SHA" '$2 != z && $3 !~ /^refs\/tags\// { print $2 }' "$REFS_FILE" 2>/dev/null | sort -u)"
    [[ -n "$PUSH_TIP" && "$PUSH_TIP" != *$'\n'* ]] || PUSH_TIP='-'
  fi
  [[ "$PUSH_TIP" != '-' ]] || return 1
  # NEVER 寫成 `git show | head | grep -q`：pipefail 下提早關 pipe 會讓上游吃 SIGPIPE 判失敗。
  head="$(git show "$PUSH_TIP:$p" 2>/dev/null | head -n 3)" || true
  [[ "$head" == *"$MANAGED_BANNER"* ]] || return 1
  if [[ -z "$CONFIG_CLOSURE_STATE" ]]; then
    if compute_config_closure; then CONFIG_CLOSURE_STATE=ok; else CONFIG_CLOSURE_STATE=fail; fi
  fi
  [[ "$CONFIG_CLOSURE_STATE" == ok ]] || return 1
  case "$CONFIG_CLOSURE" in
    *$'\n'"$p"$'\n'*) return 1 ;;
  esac
  return 0
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
      if [[ "$p" == $g ]]; then
        if [[ "$name" == 'nuxt-typecheck' && -z "${CLADE_PREPUSH_NO_MANAGED_SKIP:-}" ]] \
          && is_ignorable_managed_ts "$p"; then
          MANAGED_IGNORED_N=$((MANAGED_IGNORED_N + 1))
          break
        fi
        return 0
      fi
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
    MANAGED_IGNORED_N=0
    if ! check_is_relevant "$name"; then
      SKIP_MSG[$i]="⏭  [clade pre-push] $name skipped — 本次 push 的 ${changed_n} 個 changed path 不含 $(relevance_globs "$name")"
      if [[ "$MANAGED_IGNORED_N" -gt 0 ]]; then
        SKIP_MSG[$i]+="（另有 ${MANAGED_IGNORED_N} 個 clade managed .ts 已排除：帶 LOCKED banner、不在 nuxt/vitest config 的 import 圖內；CLADE_PREPUSH_NO_MANAGED_SKIP=1 可關閉）"
      fi
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
