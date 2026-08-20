#!/usr/bin/env bash
# gh-ci-watch.sh — GitHub Actions run watcher（機械輪詢，單次 terminal-state 輸出）
#
# 設計目標（見 plugins/hub-core/skills/gh-ci-watch/SKILL.md）：
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
#   2  UNAVAILABLE（gh 不存在 / 未登入 / API 連續失敗 3 次）
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

# ---- Phase 1: resolve run id（workflow mode；「查無 run」= pending 繼續等） ----
if [[ "$MODE" == "workflow" ]]; then
  # gh run list -c 只認**完整 40 碼 SHA**：傳縮寫 SHA 會靜默回空陣列（rc=0、不報錯），
  # 於是上面「查無 run = pending 繼續等」的設計把它當成 run 尚未建立，一路等到
  # WATCH_TIMEOUT。2026-07-31 <consumer-a> 實證：`--commit e1738305`（8 碼）等滿 3600s 回
  # run=unresolved，同一條 run 換完整 SHA 立刻查得到、而且早在 watcher 啟動後一分鐘
  # 內就 success。展不開就 fail fast，NEVER 讓 caller 白等一小時。
  # --tag 是 post-push 場景的正解：發版 tag 是**不可變的 ref**，指向你剛推的那個 commit。
  # 對照組 `--commit "$(git rev-parse HEAD)"` 在 dispatch 當下才解析 HEAD——多 session 共用
  # main 時，push 與派 watcher 之間別的 session 可能已經推了新 commit，HEAD 早就不是你的
  # 發版 commit 了，watcher 於是盯著一個沒有任何 run 的 SHA 等滿 TIMEOUT
  # （2026-08-02 <consumer-b> v1.258.0 實證：HEAD 已前進 2 個 commit，gh run list -c 回空陣列）。
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
  # （2026-07-28 <consumer-b> v1.252.9 實證：run 建立於 20:05:57Z，SINCE=20:06:01Z，晚 4 秒即被擋）。
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
    if [[ $rc -ne 0 ]]; then bump_err "gh run list" "$OUT"; sleep "$INTERVAL"; continue; fi
    ERRS=0
    RUN_ID="$OUT"
    if [[ -z "$RUN_ID" ]]; then
      # run 尚未建立（tag push 先、main push 後的窗口）→ pending，繼續等
      sleep "$INTERVAL"
    fi
  done
  echo "[watch] resolved run=$RUN_ID"
else
  RUN_ID="$TARGET"
fi

# ---- Phase 2: poll 到 terminal state（cancelled + successor → 改追） ----
CANCEL_GRACE=0
STATUS=""; CONCLUSION=""; WF_NAME=""; HEAD_BRANCH=""; HEAD_SHA=""; URL=""; CREATED=""; TITLE=""
while :; do
  check_deadline
  OUT=$(gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" \
    --json status,conclusion,workflowName,headBranch,headSha,url,createdAt,displayTitle \
    --jq '[.status, (.conclusion // "-"), .workflowName, .headBranch, .headSha, .url, .createdAt, (.displayTitle // "-")] | @tsv' 2>&1)
  rc=$?
  if [[ $rc -ne 0 ]]; then bump_err "gh run view $RUN_ID" "$OUT"; sleep "$INTERVAL"; continue; fi
  ERRS=0
  IFS=$'\t' read -r STATUS CONCLUSION WF_NAME HEAD_BRANCH HEAD_SHA URL CREATED TITLE <<<"$OUT"

  if [[ "$STATUS" != "$LAST_STATUS" ]]; then
    echo "[watch] $(date -u +%Y-%m-%dT%H:%M:%SZ) run=$RUN_ID status=$STATUS"
    LAST_STATUS="$STATUS"
  fi

  if [[ "$STATUS" == "completed" ]]; then
    if [[ "$CONCLUSION" == "cancelled" && "$FOLLOW" -eq 1 ]]; then
      SUCC=$(gh run list ${RARGS[@]+"${RARGS[@]}"} -w "$WF_NAME" -b "$HEAD_BRANCH" -L 20 \
        --json databaseId,createdAt \
        --jq "[.[] | select(.createdAt >= \"$CREATED\") | select(.databaseId != $RUN_ID)] | sort_by(.createdAt) | last | .databaseId // empty" 2>/dev/null)
      if [[ -n "$SUCC" ]]; then
        echo "[watch] run $RUN_ID cancelled — superseded by $SUCC (concurrency cancel-in-progress), following"
        RUN_ID="$SUCC"; LAST_STATUS=""; CANCEL_GRACE=0
        continue
      elif (( CANCEL_GRACE == 0 )); then
        # successor 可能還沒被 list 看到，寬限一輪再確認
        CANCEL_GRACE=1
        echo "[watch] run $RUN_ID cancelled — waiting one cycle to check for superseding run"
        sleep "$INTERVAL"
        continue
      fi
      # 寬限後仍無 successor → 真 cancelled，往 terminal report
    fi
    break
  fi
  sleep "$INTERVAL"
done

# ---- Phase 3: terminal report（單次、結構化、含證據） ----
echo "=== CI WATCH RESULT ==="
echo "RESULT: $CONCLUSION"
echo "RUN: $RUN_ID $URL"
echo "WORKFLOW: $WF_NAME | BRANCH: $HEAD_BRANCH | SHA: ${HEAD_SHA:0:12}"
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
  echo "--- failed logs (first 200 lines) ---"
  gh run view ${RARGS[@]+"${RARGS[@]}"} "$RUN_ID" --log-failed 2>/dev/null | head -200
fi
echo "=== END ==="

[[ "$CONCLUSION" == "success" ]] && exit 0 || exit 1
