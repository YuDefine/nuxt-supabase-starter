#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/evlog-map-gate.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/evlog-map-gate.sh
# CLADE:VENDOR-SCRIPT
#
# evlog-map-gate (pre-push) — 推出去之前跑與 CI 同一道 evlog map gate
#
# 本檔不做判定：它只呼叫 .github/actions/evlog-map-gate/local.ts，由 local.ts 讀 CI workflow
# 裡這個 action 的 mode／cwd，跑 CI 同一支 run.sh ＋ gate.ts —— 判定與 CI 同一份；CI 沒有這道
# gate 的 repo 自動 no-op。
#
# 與 CI 仍可能不同的兩處（都會在輸出點名，不靜默）：evlog map 掃的是本機 working tree，不是
# 推出去的 commit；變更檔清單比的是 <base>...HEAD，推的 branch tip 不是 HEAD 時對不上。
#
# 為什麼放 pre-push：commit 0-E 是散文 gate，被跳過時（<consumer-b> v1.268.0）缺口要等 CI 才被抓；
# 而 CI 只在 tag 觸發的 repo（<consumer-b>），那一刻就是發版、deploy 當場被擋。本機跑一次 2–4 秒。
#
# 變更檔清單只算已 commit 的（--committed-only）：推出去的是 commit，不是 working tree。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

TOPLEVEL="$(git rev-parse --show-toplevel)"
# meta-monorepo（starter 的 template/）的 action 目錄在 app root 底下，workflow 在 git toplevel；
# local.ts 以 toplevel 解析 workflow 與 `uses: ./…`，本檔只負責找到 local.ts 在哪。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$TOPLEVEL}"

LOCAL=""
for cand in "$TOPLEVEL/.github/actions/evlog-map-gate/local.ts" \
  "$PROJECT_ROOT/.github/actions/evlog-map-gate/local.ts"; do
  if [[ -f "$cand" ]]; then
    LOCAL="$cand"
    break
  fi
done
[[ -n "$LOCAL" ]] || exit 0 # local.ts 未散播到此 consumer → no-op

# 推的 branch tip 不是 HEAD：本機掃的是 HEAD 的樹、比的是 <base>...HEAD，與推出去的內容對不上。
# 照跑（HEAD 通常就是要推的那個），但點名。refs 由 runner.sh 從 git 的 stdin 落檔交過來。
if [[ -s "${CLADE_PREPUSH_REFS_FILE:-}" ]]; then
  HEAD_SHA="$(git rev-parse HEAD)"
  while read -r _local_ref local_sha remote_ref _remote_sha; do
    [[ -n "${local_sha:-}" && "$local_sha" != 0000000000000000000000000000000000000000 ]] || continue
    [[ "${remote_ref:-}" == refs/tags/* ]] && continue
    if [[ "$local_sha" != "$HEAD_SHA" ]]; then
      echo "[evlog-map-gate pre-push] 注意：推的 ${remote_ref} 是 ${local_sha:0:12}，不是 HEAD ${HEAD_SHA:0:12} —— 本機判定的是 HEAD，與 CI 看到的內容可能不同"
    fi
  done < "$CLADE_PREPUSH_REFS_FILE"
fi

exec node "$LOCAL" --repo "$TOPLEVEL" --committed-only
