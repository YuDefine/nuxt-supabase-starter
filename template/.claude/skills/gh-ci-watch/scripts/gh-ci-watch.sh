#!/usr/bin/env bash
# gh-ci-watch.sh — GitHub Actions run watcher（機械輪詢，單次 terminal-state 輸出）
#
# 設計目標（判準見 capabilities/core/skills/gh-ci-watch/rules/）：
#   - 無 LLM 參與：達 terminal state 才 exit，配 Bash(run_in_background=true) 剛好一次完成通知
#   - 涵蓋所有 terminal state（success / failure / cancelled / timed_out / ...）— 沉默不等同成功
#   - run 尚未建立 → 視為 pending 繼續等（workflow mode）
#   - run 被 concurrency cancel-in-progress 取代 → 自動改追 superseding run
#   - 輪詢間隔對 GitHub API 下限 30s
#
# Usage:
#   gh-ci-watch.sh run <run-id> [options]
#   gh-ci-watch.sh workflow <workflow-name-or-file> [--branch <b>] [--commit <sha>] [options]
#
# Options:
#   --repo <owner/repo>     指定 repo（預設：cwd 的 gh repo）
#   --interval <sec>        輪詢間隔（預設 30；<30 會被強制拉回 30）
#   --timeout <sec>         watch 上限（預設 3600 — 單槽 self-hosted runner queued 30+ min 是常態）
#   --since <ISO8601>       workflow mode：忽略此時間點前建立的 run（預設：腳本啟動前 120s）
#   --evidence-grep <ERE>   完成後對 full log 跑 grep -E，輸出前 40 行命中作驗證證據
#   --no-follow             cancelled 時不追 superseding run（預設會追）
#
# Exit codes:
#   0  conclusion=success
#   1  其他 terminal conclusion（failure / cancelled 無 successor / timed_out / ...）
#   2  UNAVAILABLE（gh 不存在 / 未登入 / API 連續失敗 3 次；撞限流不算失敗，會睡到 reset；
#      釘了 --commit／--tag 而實際驗到的 run SHA 不是該 commit 時也是 2，結論不採用）
#   3  WATCH_TIMEOUT（超過 --timeout；run 可能仍在跑，輸出含最後已知狀態）
#
# 最後一段輸出保證含 `RESULT: <state>` 行，caller 讀 BashOutput 尾段即可分流。
set -u

usage() { awk 'NR==1{next} !/^#/{exit} {print substr($0, $0 ~ /^# / ? 3 : 2)}' "$0"; }

MODE="${1:-}"; shift || true
case "$MODE" in
  run|workflow) TARGET="${1:-}"; shift || true ;;
  -h|--help|"") usage; exit 2 ;;
  *) echo "RESULT: UNAVAILABLE (unknown mode '$MODE'; expected run|workflow)"; exit 2 ;;
esac
[[ -z "$TARGET" ]] && { echo "RESULT: UNAVAILABLE (missing <run-id> or <workflow>)"; exit 2; }

REPO=""; BRANCH=""; COMMIT=""; TAG=""; SINCE=""; INTERVAL=30; TIMEOUT=3600; EVIDENCE=""; FOLLOW=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)          REPO="$2"; shift 2 ;;
    --branch)        BRANCH="$2"; shift 2 ;;
    --commit)        COMMIT="$2"; shift 2 ;;
    --tag)           TAG="$2"; shift 2 ;;
    --since)         SINCE="$2"; shift 2 ;;
    --interval)      INTERVAL="$2"; shift 2 ;;
    --timeout)       TIMEOUT="$2"; shift 2 ;;
    --evidence-grep) EVIDENCE="$2"; shift 2 ;;
    --no-follow)     FOLLOW=0; shift ;;
    *) echo "RESULT: UNAVAILABLE (unknown flag '$1')"; exit 2 ;;
  esac
done

[[ "$INTERVAL" -lt 30 ]] && { echo "[watch] interval clamped to 30s (GitHub API 下限)"; INTERVAL=30; }

RARGS=()
[[ -n "$REPO" ]] && RARGS=(-R "$REPO")

now_epoch() { date +%s; }
iso_to_epoch() { # GNU date → BSD date fallback
  local iso="${1:-}"
  [[ -z "$iso" ]] && { echo ""; return; }
  date -d "$iso" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null || echo ""
}
default_since() {
  date -u -d '-120 seconds' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-120S +%Y-%m-%dT%H:%M:%SZ
}

command -v gh >/dev/null 2>&1 || { echo "RESULT: UNAVAILABLE (gh CLI not found)"; exit 2; }

DEADLINE=$(( $(now_epoch) + TIMEOUT ))
ERRS=0
RUN_ID=""
LAST_STATUS=""

check_deadline() {
  if (( $(now_epoch) >= DEADLINE )); then
    echo "=== CI WATCH RESULT ==="
    echo "RESULT: WATCH_TIMEOUT (${TIMEOUT}s elapsed; last status=${LAST_STATUS:-unknown}; run=${RUN_ID:-unresolved})"
    echo "=== END ==="
    exit 3
  fi
}

bump_err() { # $1 = context, $2 = raw output
  ERRS=$(( ERRS + 1 ))
  if (( ERRS >= 3 )); then
    echo "=== CI WATCH RESULT ==="
    echo "RESULT: UNAVAILABLE ($1 failed ${ERRS}x: $(printf '%s' "$2" | head -3 | tr '\n' ' '))"
    echo "=== END ==="
    exit 2
  fi
}

# 撞 GitHub API 限流：睡到 reset 再續，不計入 bump_err 的 3 次錯誤。
# 5000/hr 是同一個 token 下全工具、全 agent 共用的額度；把 403 當一般抖動重試 3 次就
# 回 UNAVAILABLE，等於在額度回來之前放棄監看，而重試本身又再吃一次額度
# （實證：`gh run watch` 3 秒刷新撞 HTTP 403）。
# reset 晚於 deadline 時只睡到 deadline，交給 check_deadline 回 WATCH_TIMEOUT。
# core 額度沒用完卻被擋＝secondary rate limit，GitHub 不給 reset，至少等 60 秒。
is_rate_limited() { # $1 = gh 的輸出
  printf '%s' "$1" | grep -qiE 'rate limit|HTTP 429|HTTP 403: (API rate|You have exceeded)'
}
sleep_until_reset() {
  local core remaining reset now wait
  core=$(gh api rate_limit --jq '.resources.core | "\(.remaining) \(.reset)"' 2>/dev/null || true)
  read -r remaining reset <<<"$core"
  now=$(now_epoch)
  if [[ "${remaining:-}" =~ ^[0-9]+$ && "${reset:-}" =~ ^[0-9]+$ && "$remaining" -eq 0 ]]; then
    wait=$(( reset - now + 1 ))
  else
    wait=60
  fi
  (( wait < 1 )) && wait=1
  (( now + wait > DEADLINE )) && wait=$(( DEADLINE - now > 0 ? DEADLINE - now : 0 ))
  echo "[watch] $(date -u +%Y-%m-%dT%H:%M:%SZ) GitHub API rate limited (core remaining=${remaining:-?}) — sleeping ${wait}s until reset"
  sleep "$wait"
}

# ---- Phase 1: resolve run id（workflow mode；「查無 run」= pending 繼續等） ----
if [[ "$MODE" == "workflow" ]]; then
  # gh run list -c 只認**完整 40 碼 SHA**：傳縮寫 SHA 會靜默回空陣列（rc=0、不報錯），
  # 於是上面「查無 run = pending 繼續等」的設計把它當成 run 尚未建立，一路等到
  # WATCH_TIMEOUT。2026-07-31 實證：`--commit e1738305`（8 碼）等滿 3600s 回
  # run=unresolved，同一條 run 換完整 SHA 立刻查得到、而且早在 watcher 啟動後一分鐘
  # 內就 success（見舊條目 pitfall-gh-ci-watch-short-sha-silently-returns-empty（specs/truth/legacy-ids.json））。
  # 展不開就 fail fast，NEVER 讓 caller 白等一小時。
  # --tag 是 post-push 場景的正解：發版 tag 是**不可變的 ref**，指向你剛推的那個 commit。
  # 對照組 `--commit "$(git rev-parse HEAD)"` 在 dispatch 當下才解析 HEAD——多 session 共用
  # main 時，push 與派 watcher 之間別的 session 可能已經推了新 commit，HEAD 早就不是你的
  # 發版 commit 了，watcher 於是盯著一個沒有任何 run 的 SHA 等滿 TIMEOUT
  # （2026-08-02 v1.258.0 實證：HEAD 已前進 2 個 commit，gh run list -c 回空陣列；
#   見舊條目 pitfall-gh-ci-watch-head-moved-by-parallel-session（specs/truth/legacy-ids.json））。
  if [[ -n "$TAG" ]]; then
    if [[ -n "$COMMIT" ]]; then
      echo "RESULT: UNAVAILABLE (--tag 與 --commit 互斥，兩者都指定目標 commit)"
      exit 2
    fi
    TAG_SHA=$(git rev-parse --verify "${TAG}^{commit}" 2>/dev/null || true)
    if [[ ! "$TAG_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
      echo "RESULT: UNAVAILABLE (--tag '$TAG' 解不出 commit；tag 打了沒？拼字對嗎？)"
      exit 2
    fi
    COMMIT="$TAG_SHA"
  fi

  if [[ -n "$COMMIT" && ! "$COMMIT" =~ ^[0-9a-fA-F]{40}$ ]]; then
    FULL_SHA=$(git rev-parse --verify "${COMMIT}^{commit}" 2>/dev/null || true)
    if [[ "$FULL_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
      echo "[watch] --commit '$COMMIT' → ${FULL_SHA}（gh run list -c 不接受縮寫 SHA）"
      COMMIT="$FULL_SHA"
    else
      echo "RESULT: UNAVAILABLE (--commit '$COMMIT' 展不開成完整 40 碼 SHA；gh run list -c 只認完整 SHA)"
      exit 2
    fi
  fi
  # --commit 模式：SHA 本身已唯一識別 run，不疊 createdAt 下界 —— caller 常見模式是
  # 「push 完才派 watcher」，run 早於 script 啟動時間建立，若仍套用預設 120s-ago 下界
  # 會把已存在的 run 過濾掉，watcher 誤判「run 尚未建立」永遠 pending 到 WATCH_TIMEOUT
  # （2026-07-28 v1.252.9 實證：run 建立於 20:05:57Z，SINCE=20:06:01Z，晚 4 秒即被擋；見
#   舊條目 pitfall-gh-ci-watch-commit-mode-createdat-filter-races-post-push-dispatch（specs/truth/legacy-ids.json））。
  # --since 顯式傳入時仍尊重使用者指定值；--branch 或無 commit 的模式維持既有時間窗。
  if [[ -z "$SINCE" ]]; then
    if [[ -n "$COMMIT" ]]; then
      SINCE="1970-01-01T00:00:00Z"
    else
      SINCE=$(default_since)
    fi
  fi
  # 回顯目標 commit 的身分。盯錯 commit 的失敗形狀是「一路 pending 到 TIMEOUT」，
  # 跟「run 還沒建立」外觀完全一樣——把 subject 與所屬 tag 印在第一行，讓派錯目標
  # 當場看得出來，而不是一小時後才發現。
  if [[ -n "$COMMIT" ]]; then
    SUBJECT=$(git log -1 --format=%s "$COMMIT" 2>/dev/null || echo '<不在本地 repo>')
    AT_TAGS=$(git tag --points-at "$COMMIT" 2>/dev/null | paste -sd, - || true)
    IS_HEAD=$([[ "$COMMIT" == "$(git rev-parse HEAD 2>/dev/null)" ]] && echo yes || echo no)
    echo "[watch] target commit ${COMMIT:0:8} = \"$SUBJECT\" (tags: ${AT_TAGS:--}, is-HEAD: $IS_HEAD)"
  fi
  # ---- pre-flight：先確定 workflow 識別字串真的存在 ----------------------------
  # `gh run list -w X` 只認 workflow **檔名**（ci.yml）或**逐字 display name**（name: 欄位）。
  # display name 是自由文字、與檔名無關，所以憑印象填一個像 "CI" 的簡稱是常見失手。
  # 那種錯**永遠不會自己好**，但下面的迴圈把 gh 的非零 exit 一律送進 bump_err（那是為 API
  # 抖動設計的重試路徑），於是重試 3 次後回一個通用 UNAVAILABLE，訊息與「gh 掛了 / 沒授權」
  # 同形，讀的人會去查 gh 狀態而不是回頭看自己傳了什麼字串
  # （2026-08-28 v1.272.0 實證：傳 "CI"，實際檔名 ci.yml / display name "CI / Deploy"；見
#   舊條目 pitfall-gh-ci-watch-workflow-display-name-guess-fails-opaquely（specs/truth/legacy-ids.json））。
  # 這裡把不可恢復的錯誤從重試路徑移出去，並讓失敗訊息自帶正確答案。
  # jq 缺席時整段跳過：沒有 jq 就判不出名稱在不在，而「判不出」MUST fail-open 交回下面的
  # 迴圈——若照舊往下走，`jq -e` 的非零 exit 會被讀成「名稱不存在」，把**正確**的名稱擋掉，
  # 而那個錯誤訊息會信誓旦旦地列出一份它其實沒解析成功的清單。
  # `--all -L 200`：gh 預設只列 active 且筆數有上限，workflow 多的 repo 會漏掉合法名稱。
  WF_LIST=''
  if command -v jq >/dev/null 2>&1; then
    WF_LIST=$(gh workflow list ${RARGS[@]+"${RARGS[@]}"} --all -L 200 --json name,path 2>&1) || WF_LIST=''
  fi
  if [[ -n "$WF_LIST" ]] && printf '%s' "$WF_LIST" | jq -e 'type == "array"' >/dev/null 2>&1; then
    if ! printf '%s' "$WF_LIST" | jq -e --arg t "$TARGET" \
         'any(.[]; .name == $t or (.path | endswith("/" + $t)) or (.path == $t))' >/dev/null 2>&1; then
      AVAIL=$(printf '%s' "$WF_LIST" | jq -r '[.[] | "\(.name) [\(.path | split("/") | last)]"] | join(", ")' 2>/dev/null)
      echo "RESULT: UNAVAILABLE (workflow '$TARGET' 不存在；可用：${AVAIL:-<列不出來>}。傳 workflow 檔名最穩，display name 會漂)"
      exit 2
    fi
  fi
  # gh workflow list 失敗 / jq 缺席 / 輸出不是 JSON 陣列 → fail-open，交給下面的迴圈照舊處理

  echo "[watch] resolving run: workflow='$TARGET' branch='${BRANCH:-*}' commit='${COMMIT:-*}' createdAt>=$SINCE"
  while [[ -z "$RUN_ID" ]]; do
    check_deadline
    LISTARGS=(-w "$TARGET" -L 20)
    [[ -n "$BRANCH" ]] && LISTARGS+=(-b "$BRANCH")
    [[ -n "$COMMIT" ]] && LISTARGS+=(-c "$COMMIT")
    OUT=$(gh run list ${RARGS[@]+"${RARGS[@]}"} "${LISTARGS[@]}" \
      --json databaseId,createdAt \
      --jq "[.[] | select(.createdAt >= \"$SINCE\")] | sort_by(.createdAt) | last | .databaseId // empty" 2>&1)
    rc=$?
    if [[ $rc -ne 0 ]] && is_rate_limited "$OUT"; then sleep_until_reset; continue; fi
    if [[ $rc -ne 0 ]]; then bump_err "gh run list" "$OUT"; sleep "$INTERVAL"; continue; fi
    ERRS=0
    RUN_ID="$OUT"
    if [[ -z "$RUN_ID" ]]; then
      # run 尚未建立（push 送達到 run 建立之間的窗口；發版序列是 main push 先、tag push 後）→ pending，繼續等
      sleep "$INTERVAL"
    fi
  done
  echo "[watch] resolved run=$RUN_ID"
else
  RUN_ID="$TARGET"
fi

# 終點不變式（下方）以 byte 比對 SHA，而 gh 回的 headSha 是小寫完整 40 碼：兩種 mode 都 MUST 先展開並轉小寫，
# 否則 run mode 的縮寫／大寫 SHA 會被誤判成「不是目標 commit」。workflow mode 已在 Phase 1 展開，這裡只補轉小寫。
if [[ -n "$COMMIT" ]]; then
  if [[ ! "$COMMIT" =~ ^[0-9a-fA-F]{40}$ ]]; then
    FULL_SHA=$(git rev-parse --verify "${COMMIT}^{commit}" 2>/dev/null || true)
    if [[ ! "$FULL_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
      echo "RESULT: UNAVAILABLE (--commit '$COMMIT' 展不開成完整 40 碼 SHA)"
      exit 2
    fi
    COMMIT="$FULL_SHA"
  fi
  COMMIT=$(printf '%s' "$COMMIT" | tr 'A-F' 'a-f')
fi

# run 的來源 repo 的數字 id。`gh run list／view --json` 沒有這個欄位，只有 REST 有。
# 用 id 不用 owner/name：名稱可改、可在刪除後被別人重新註冊，id 不會。
# 結果放 HEAD_REPO_ID（不用 $(...) 取值：子 shell 帶不出 RATE_LIMITED）。查不到＝空字串，
# 呼叫端 MUST 把空字串當成「不可比」而不是「相同」。
# 撞限流時另設 RATE_LIMITED=1：呼叫端要睡到 reset 重查，NEVER 把「額度用完」讀成「沒有 successor」。
RATE_LIMITED=0
HEAD_REPO_ID=""
run_head_repo() { # $1 = run id
  local slug="$REPO" out rc
  HEAD_REPO_ID=""
  [[ -z "$slug" ]] && slug='{owner}/{repo}'
  out=$(gh api "repos/$slug/actions/runs/$1" --jq '.head_repository.id // ""' 2>&1); rc=$?
  if [[ $rc -ne 0 ]]; then
    is_rate_limited "$out" && RATE_LIMITED=1
    return 0
  fi
  [[ "$out" =~ ^[0-9]+$ ]] && HEAD_REPO_ID="$out"
  return 0
}

# 找接手 $RUN_ID 的 run，結果放 FOUND_ID／FOUND_SHA（找不到兩者皆空）。$1 非空時只認該 SHA。
# 追 successor 與印 SUPERSEDED_BY 共用這一支：兩條路徑的來源檢查 MUST 是同一份。
# 撞限流時 RATE_LIMITED=1 並提早回傳（FOUND_* 為空）：呼叫端睡到 reset 再重查，不當成「無 successor」。
#
# 接手者 MUST 與原 run 同 workflow（比 workflowDatabaseId——`-w` 用的顯示名稱可以重複）、同 branch、
# 同 event、同來源 repo（比 repo id）：`-b` 只比 branch 名、`-c` 只比
# SHA，fork 的 PR 兩者都可以撞（同名 branch、同一個 commit）。event 擋掉「原 run 是 push／tag」的
# 情況；原 run 本身是 pull_request 時 fork 的 PR 也是同一種 event，所以再比 head_repository。
# event、workflow id 或原 run 的來源 repo 判不出來 → 不找（fail-closed），NEVER 退成不篩。
#
# 候選由新到舊**逐筆**驗，取第一筆通過的。NEVER 只驗最新一筆：那樣外部 PR 只要搶到最新，就能讓
# 合法的接手者被整個略過。id 不是純數字、SHA 不是 40 碼 hex 的列直接跳過——它們會進 RUN_ID 與報告。
find_successor() { # $1 = 要釘的 commit（可空）
  FOUND_ID=""; FOUND_SHA=""; RATE_LIMITED=0
  if [[ ! "$EVENT" =~ ^[a-z_]+$ ]]; then
    echo "[watch] run $RUN_ID cancelled — 原 run 的 event 判不出來（'${EVENT:0:40}'），不找 successor"
    return 0
  fi
  # RUN_ID 與 CREATED 會插進下面的 jq 程式：形狀不對就不找，NEVER 原樣帶進去。
  if [[ ! "$RUN_ID" =~ ^[0-9]+$ || ! "$CREATED" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$ ]]; then
    echo "[watch] run '${RUN_ID:0:40}' cancelled — run id 或 createdAt 形狀不對，不找 successor"
    return 0
  fi
  if [[ ! "$WF_ID" =~ ^[0-9]+$ ]]; then
    echo "[watch] run $RUN_ID cancelled — 原 run 的 workflow id 判不出來，不找 successor"
    return 0
  fi
  local orig_repo; run_head_repo "$RUN_ID"; orig_repo="$HEAD_REPO_ID"
  if [[ -z "$orig_repo" ]]; then
    [[ "$RATE_LIMITED" -eq 1 ]] && return 0
    echo "[watch] run $RUN_ID cancelled — 原 run 的來源 repo 查不到，不找 successor"
    return 0
  fi
  # -L 是篩選**之前**的筆數上限：太小的話，同 branch 名的 run 夠多就能把合法接手者擠出視窗。
  # 100 是 gh 單頁上限；被擠出去的結果是「找不到 → cancelled」（fail-closed），不會變成假綠燈。
  local args=(-w "$WF_NAME" -b "$HEAD_BRANCH" -e "$EVENT" -L 100) rows rc id sha repo
  [[ -n "$1" ]] && args+=(-c "$1")
  rows=$(gh run list ${RARGS[@]+"${RARGS[@]}"} "${args[@]}" \
    --json databaseId,createdAt,headSha,workflowDatabaseId \
    --jq "[.[] | select(.workflowDatabaseId == $WF_ID) | select(.createdAt >= \"$CREATED\") | select(.databaseId != $RUN_ID)] | sort_by(.createdAt) | reverse | .[] | [.databaseId, .headSha] | @tsv" 2>&1); rc=$?
  if [[ $rc -ne 0 ]]; then
    is_rate_limited "$rows" && RATE_LIMITED=1
    return 0
  fi
  while IFS=$'\t' read -r id sha; do
    [[ "$id" =~ ^[0-9]+$ && "$sha" =~ ^[0-9a-fA-F]{40}$ ]] || continue
    run_head_repo "$id"; repo="$HEAD_REPO_ID"
    [[ "$RATE_LIMITED" -eq 1 ]] && return 0
    if [[ "$repo" != "$orig_repo" ]]; then
      echo "[watch] 略過候選 run $id：來源 repo id（'${repo:-?}'）與原 run（'$orig_repo'）不同或查不到"
      continue
    fi
    FOUND_ID="$id"; FOUND_SHA="$sha"
    return 0
  done <<<"$rows"
  return 0
}

# ---- Phase 2: poll 到 terminal state（cancelled + successor → 改追） ----
CANCEL_GRACE=0
FOLLOWED_FROM=""   # 跨 SHA 追 successor 時記下最初盯的 run／SHA
SUPERSEDED_BY=""   # 釘了 commit 而被別個 SHA 的 run 取代時記下對方
STATUS=""; CONCLUSION=""; WF_NAME=""; HEAD_BRANCH=""; HEAD_SHA=""; URL=""; CREATED=""; TITLE=""; EVENT=""; WF_ID=""
while :; do
  check_deadline
  OUT=$(gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" \
    --json status,conclusion,workflowName,headBranch,headSha,url,createdAt,displayTitle,event,workflowDatabaseId \
    --jq '[.status, (.conclusion // "-"), .workflowName, .headBranch, .headSha, .url, .createdAt, ((.displayTitle // "") | if . == "" then "-" else . end), ((.event // "") | if . == "" then "-" else . end), (.workflowDatabaseId // "-")] | @tsv' 2>&1)
  rc=$?
  if [[ $rc -ne 0 ]] && is_rate_limited "$OUT"; then sleep_until_reset; continue; fi
  if [[ $rc -ne 0 ]]; then bump_err "gh run view $RUN_ID" "$OUT"; sleep "$INTERVAL"; continue; fi
  ERRS=0
  IFS=$'\t' read -r STATUS CONCLUSION WF_NAME HEAD_BRANCH HEAD_SHA URL CREATED TITLE EVENT WF_ID <<<"$OUT"

  if [[ "$STATUS" != "$LAST_STATUS" ]]; then
    echo "[watch] $(date -u +%Y-%m-%dT%H:%M:%SZ) run=$RUN_ID status=$STATUS"
    LAST_STATUS="$STATUS"
  fi

  if [[ "$STATUS" == "completed" ]]; then
    if [[ "$CONCLUSION" == "cancelled" && "$FOLLOW" -eq 1 ]]; then
      # 釘了目標 commit（--commit／--tag）時 successor 也 MUST 是同一個 SHA：concurrency 取消後接手的
      # run 幾乎都屬於更新的 commit，追過去會把「較新 commit 的綠燈」回報成目標 commit 的結果。
      # 沒釘 commit（run mode／只給 --branch）才跨 SHA 追，且換 SHA 時在輸出點名。
      find_successor "$COMMIT"
      # 撞限流＝沒查成，不是「沒有 successor」：睡到 reset 重來（不吃寬限輪），NEVER 就此報 cancelled。
      if [[ "$RATE_LIMITED" -eq 1 ]]; then sleep_until_reset; continue; fi
      SUCC="$FOUND_ID"; SUCC_SHA="$FOUND_SHA"
      if [[ -n "$SUCC" ]]; then
        if [[ "$SUCC_SHA" != "$HEAD_SHA" ]]; then
          echo "[watch] run $RUN_ID cancelled — superseded by $SUCC (concurrency cancel-in-progress), following; SHA changed ${HEAD_SHA:0:12} → ${SUCC_SHA:0:12}"
          [[ -z "$FOLLOWED_FROM" ]] && FOLLOWED_FROM="run $RUN_ID @ ${HEAD_SHA:0:12}"
        else
          echo "[watch] run $RUN_ID cancelled — superseded by $SUCC (concurrency cancel-in-progress, same SHA ${HEAD_SHA:0:12}), following"
        fi
        RUN_ID="$SUCC"; LAST_STATUS=""; CANCEL_GRACE=0
        continue
      elif (( CANCEL_GRACE == 0 )); then
        # successor 可能還沒被 list 看到，寬限一輪再確認
        CANCEL_GRACE=1
        echo "[watch] run $RUN_ID cancelled — waiting one cycle to check for superseding run"
        sleep "$INTERVAL"
        continue
      fi
      # 寬限後仍無 successor → 真 cancelled，往 terminal report。
      # 釘了 commit 時「無 successor」只代表同 SHA 沒有：把接手的別個 SHA 點名，讓 caller 知道
      # 目標 commit 沒被驗到、該改盯哪一個，而不是把 cancelled 讀成無解的紅燈。
      if [[ -n "$COMMIT" ]]; then
        find_successor ""
        while [[ "$RATE_LIMITED" -eq 1 ]]; do sleep_until_reset; check_deadline; find_successor ""; done
        [[ -n "$FOUND_ID" ]] && SUPERSEDED_BY="run $FOUND_ID @ ${FOUND_SHA:0:12}"
      fi
    fi
    break
  fi
  sleep "$INTERVAL"
done

# 終點不變式：釘了 commit 就只回報屬於那個 commit 的結果。前面每一關都只在「查詢條件」上把關
# （-c、find_successor），這裡對**實際驗到的 run** 再比一次 SHA——中途任何一步選錯 run，
# 都不會以該 run 的 conclusion 收場。
if [[ -n "$COMMIT" && "$HEAD_SHA" != "$COMMIT" ]]; then
  echo "=== CI WATCH RESULT ==="
  echo "RESULT: UNAVAILABLE (run $RUN_ID 的 SHA '${HEAD_SHA:0:40}' 不是目標 commit ${COMMIT:0:40}；它的 conclusion 不屬於目標，未採用)"
  echo "=== END ==="
  exit 2
fi

# ---- Phase 3: terminal report（單次、結構化、含證據） ----
echo "=== CI WATCH RESULT ==="
echo "RESULT: $CONCLUSION"
echo "RUN: $RUN_ID $URL"
echo "WORKFLOW: $WF_NAME | BRANCH: $HEAD_BRANCH | SHA: ${HEAD_SHA:0:12}"
# RESULT 驗的是上面那個 SHA。下面兩行只在「驗到的不是最初盯的」或「目標沒被驗到」時出現。
[[ -n "$FOLLOWED_FROM" ]] && echo "FOLLOWED_FROM: $FOLLOWED_FROM（原 run 被 concurrency 取消；RESULT 屬於 SHA ${HEAD_SHA:0:12}，不是原 SHA）"
[[ -n "$SUPERSEDED_BY" ]] && echo "SUPERSEDED_BY: $SUPERSEDED_BY（目標 commit ${HEAD_SHA:0:12} 的 run 被取消且未被驗證；要結果就改盯該 SHA）"
echo "TITLE: $TITLE"

echo "--- job timings ---"
gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" --json jobs \
  --jq '.jobs[] | [.name, (.conclusion // .status // "-"), (.startedAt // ""), (.completedAt // "")] | @tsv' 2>/dev/null |
while IFS=$'\t' read -r JNAME JCONC JSTART JEND; do
  S=$(iso_to_epoch "$JSTART"); E=$(iso_to_epoch "$JEND")
  if [[ -n "$S" && -n "$E" ]] && (( E >= S )); then DUR="$(( E - S ))s"; else DUR="-"; fi
  printf '%s | %s | %s\n' "$JNAME" "$JCONC" "$DUR"
done

if [[ -n "$EVIDENCE" ]]; then
  echo "--- evidence: grep -E '$EVIDENCE' (first 40) ---"
  gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" --log 2>/dev/null | grep -E "$EVIDENCE" | head -40
fi

if [[ "$CONCLUSION" != "success" ]]; then
  # 最後綠燈 SHA：紅燈的起點決定該往哪查。紅燈早於最近一次環境變更（換 runner、升 image）
  # 時，根因與那次變更無關——不先比 range，第一個嫌疑人永遠是「剛剛動過的東西」
  # （實證：一條 BDD 紅燈早於 runner 搬家三天，卻在搬家後才被發現，差點被讀成搬家造成；
  # 時間線見舊條目 pitfall-pnpm-allowbuilds-entry-removal-reddens-unrelated-scripts（specs/truth/legacy-ids.json））。
  # tag 觸發的 run 其 headBranch 是 tag 名，不能拿來當 -b 過濾。
  echo "--- last green (same workflow) ---"
  LG_ARGS=(-w "$WF_NAME" -s success -L 1)
  if [[ -n "$HEAD_BRANCH" ]] && ! git rev-parse --verify --quiet "refs/tags/$HEAD_BRANCH" >/dev/null 2>&1; then
    LG_ARGS+=(-b "$HEAD_BRANCH")
  fi
  LAST_GREEN=$(gh run list ${RARGS[@]+"${RARGS[@]}"} "${LG_ARGS[@]}" \
    --json headSha,createdAt,url --jq '.[0] | select(.) | [.headSha, .createdAt, .url] | @tsv' 2>/dev/null || true)
  if [[ -n "$LAST_GREEN" ]]; then
    IFS=$'\t' read -r LG_SHA LG_AT LG_URL <<<"$LAST_GREEN"
    echo "LAST_GREEN: ${LG_SHA:0:12} $LG_AT $LG_URL"
    echo "RANGE: git log --oneline ${LG_SHA:0:12}..${HEAD_SHA:0:12}"
  else
    echo "LAST_GREEN: unknown（gh 查無 success run，或查詢失敗）"
  fi
  echo "--- failed logs (first 200 lines) ---"
  gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" --log-failed 2>/dev/null | head -200
fi
echo "=== END ==="

[[ "$CONCLUSION" == "success" ]] && exit 0 || exit 1
