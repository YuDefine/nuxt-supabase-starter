#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋整頁讀取 Notion Secret 頁（block，exit 2）
#
# 為什麼存在：2026-10-30 兩次 Secret 外露（Unifi Access API Key 整顆印進 transcript、Cloudflare 帳密出現在
# 工具輸出），根因相同：先把 Secret 頁整頁／整個區塊印出來再遮罩，遮罩一漏值就外露。
# 規約：notion-hub `references/ntn-cookbook.md` § 讀 Secret——只准「指定 block id → jq 取值 → export」，
# NEVER 列 Secret 頁 children、NEVER 整頁取 Markdown；cf-cli `rules/安裝與認證判準.md` Rule 2 引用它。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），擋誠實但健忘的 agent 順手打出的整頁讀法；
# 不承諾完整語意。
#
# 判定（全用 bash builtin，不依賴 node／jq）：把 payload 轉小寫、去掉引號、反斜線與 `-` 後，
#   1. 含任一 Secret 頁 id（32 碼 hex；帶不帶 `-` 都認），且
#   2. 提到 ntn／curl／wget／notion 任一，且
#   3. 帶整頁讀取的形狀：`children`（blocks/<id>/children）、`pages get`（ntn 整頁轉 Markdown）、`markdown`
# 三者都中 → exit 2。
# 放行：`ntn api /v1/blocks/<指定 block id>`（cookbook 的正路，id 不是 Secret 頁本身）、`/v1/pages/<Secret 頁 id>`
# （只回 properties）、沒提到 Secret 頁 id 的任何指令。
#
# Secret 頁 id 來源：下方 SECRET_PAGE_IDS（硬編，registry 讀不到時仍生效）∪ registry/notion-hubs.json 每個 hub 的
# `secretsPageId`（`$CLADE_HOME` 或 `~/offline/clade`；org 層）∪ `$CLAUDE_PROJECT_DIR/.claude/consumer-meta.json` 的
# `notion.secretPageId`（project 層憑證頁）。test/pre-bash-notion-secret-read-gate.test.ts 釘住硬編
# 清單涵蓋 registry 全部 secretsPageId，新增 hub 的 Secret 頁沒補進來 CI 會紅。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `ntn api "/v1/blocks/<Secret 頁 id>/children?page_size=100"` | 擋 |
#   | dashed id、大寫 id、`chil''dren`、`curl https://api.notion.com/v1/blocks/<id>/children` | 擋：去引號／`-`／轉小寫後判 |
#   | `ntn pages get <Secret 頁 id>` | 擋：整頁 Markdown |
#   | id 放變數（`P=…; ntn api /v1/blocks/$P/children` 分兩次 tool call）、腳本檔、`node -e` | 不攔（已知缺口） |
#   | Notion MCP `notion-fetch` | 不攔（已知缺口；notion-hub Rule 2 另禁 MCP） |
#   | commit 訊息／grep 同時寫了 Secret 頁 id、ntn 與 children | 誤擋：訊息改 Write 落檔用 `-F`，或別寫 id |
#
# 錯誤分支：registry／consumer-meta 讀不到 → 只用硬編清單（不是故障）；本檔只用 builtin，沒有外部依賴會缺。
# 緊急放行（人控面）：啟動 Claude Code 的行程 env 設 CLADE_NOTION_SECRET_GATE_OFF=1（不認指令前綴）。

set -uo pipefail

[[ ${CLADE_NOTION_SECRET_GATE_OFF-} == 1 ]] && exit 0

SECRET_PAGE_IDS=(
  274b791117218176a7f4c5bbe57bf5c5 # FC 公司層 Secret 頁（registry hubs.fc.secretsPageId）
)

input=''
IFS= read -r -d '' input || true

# 正規化：小寫、去引號／反斜線／`-`（dashed id 與 `chil''dren` 都還原）
norm=${input,,}
norm=${norm//[\'\"\\-]/}

# 快篩：沒有任何 32 碼 hex 片段的指令不再往下看
[[ $norm =~ [0-9a-f]{32} ]] || exit 0

ids=("${SECRET_PAGE_IDS[@]}")
# $1=檔案 $2=JSON key：把該 key 的每個 page id（去 `-`、小寫）加進 ids
collect_ids() {
  local reg='' id
  [[ -r $1 ]] || return 1
  IFS= read -r -d '' reg <"$1" || true
  while [[ $reg =~ \"$2\"[[:space:]]*:[[:space:]]*\"([0-9a-fA-F-]+)\" ]]; do
    id=${BASH_REMATCH[1],,}
    ids+=("${id//-/}")
    reg=${reg#*"${BASH_REMATCH[0]}"}
  done
}
for root in "${CLADE_HOME-}" "${HOME-}/offline/clade"; do
  [[ -n $root ]] && collect_ids "$root/registry/notion-hubs.json" secretsPageId && break
done
[[ -n ${CLAUDE_PROJECT_DIR-} ]] && collect_ids "$CLAUDE_PROJECT_DIR/.claude/consumer-meta.json" secretPageId

hit=''
for id in "${ids[@]}"; do
  [[ ${#id} == 32 && $norm == *"$id"* ]] && hit=$id && break
done
[[ -n $hit ]] || exit 0

[[ $norm =~ (ntn|curl|wget|notion) ]] || exit 0

shape=''
if [[ $norm == *children* ]]; then
  shape='blocks/<Secret 頁 id>/children（列出整頁區塊）'
elif [[ $norm =~ pages[[:space:]]+get ]]; then
  shape='ntn pages get（整頁轉 Markdown）'
elif [[ $norm == *markdown* ]]; then
  shape='整頁 Markdown 讀取'
fi
[[ -n $shape ]] || exit 0

{
  printf '⛔ notion-secret-read-gate：這條指令會整頁讀取 Notion Secret 頁（%s），值會印進 transcript。\n' "$shape"
  printf '%s\n' '正路（notion-hub references/ntn-cookbook.md § 讀 Secret）：只用「指定 block id → jq 取值 → export」，不列 children、不印區塊內容：'
  printf '%s\n' '  export X="$(timeout 30 ntn api "/v1/blocks/<block-id>" < /dev/null | jq -r '"'"'.[.type].rich_text | map(.plain_text) | join("")'"'"')"'
  printf '%s\n' 'block id 不知道 → NEVER 列 children 找；向 Charles 要該區塊的「Copy link to block」連結（# 後 32 碼）。'
  printf '%s\n' '誤擋（commit 訊息／grep 同時寫了 Secret 頁 id 與 children）→ 訊息改用 Write 落檔再 -F，或不寫 id。'
} >&2
exit 2
