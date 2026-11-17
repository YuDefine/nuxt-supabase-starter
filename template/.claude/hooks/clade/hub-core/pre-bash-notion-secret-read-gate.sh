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
#   1. 提到 ntn／curl／wget／notion 任一，且
#   2. 帶整頁讀取的形狀：`children`（blocks/<id>/children）、`pages get`（ntn 整頁轉 Markdown）、`markdown`，且
#   3. 含任一 Secret 頁 id（32 碼 hex；帶不帶 `-` 都認）；或 `blocks/<id>/children`、`pages get … <id>`（同一段
#      指令內 `pages get` 之後的任一 id，flag 放在 id 前也算）位置的 id 經 `ntn api /v1/blocks/<id>` 往上走
#      parent 鏈（≤6 層，期限 3.5 秒）遇到 Secret 頁（子區塊、子頁）
# 三者都中 → exit 2。parent 鏈查不到（ntn 缺、未登入、網路失敗、逾時）→ fail-closed exit 2；
# 只有第 0 層（目標 id 本身）404 object_not_found、且指令沒自帶或改換憑證時放行（token 看不到該 id，
# 指令本身也讀不到）；中間祖先 404 → 無法確認，fail-closed。
# 放行：`ntn api /v1/blocks/<指定 block id>`（cookbook 的正路，id 不是 Secret 頁本身）、`/v1/pages/<Secret 頁 id>`
# （只回 properties）、不帶整頁讀取形狀的指令、整頁讀取位置的 id 經 parent 鏈確認不在 Secret 頁之下的指令。
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
#   | `ntn api /v1/blocks/<Secret 頁子區塊 id>/children`、`ntn pages get <Secret 頁子頁 id>` | 擋：parent 鏈 walk |
#   | `ntn pages get --format x <Secret 頁子頁 id>`（flag 在 id 前） | 擋：`pages get` 之後同段的 id 都是候選 |
#   | token 只分享到子頁、中間父頁 404 | 擋：祖先 404 判無法確認（fail-closed） |
#   | `NOTION_TOKEN=… ntn …`、`ntn --profile x …` 換了 token，hook 的預設 token 查到 404 | 擋：指令帶憑證字樣時 404 也 fail-closed |
#   | 子區塊 id 配 `markdown` 形狀 | 不攔（walk 只看 children／pages get 兩個位置） |
#   | 指令文字（heredoc、commit 訊息）寫了 ntn＋`blocks/<假 id>/children`，ntn 離線或未登入 | 誤擋（fail-closed）：改用 Write 落檔 |
#   | id 放變數（`P=…; ntn api /v1/blocks/$P/children` 分兩次 tool call）、腳本檔、`node -e` | 不攔（已知缺口） |
#   | Notion MCP `notion-fetch` | 不攔（已知缺口；notion-hub Rule 2 另禁 MCP） |
#   | commit 訊息／grep 同時寫了 Secret 頁 id、ntn 與 children | 誤擋：訊息改 Write 落檔用 `-F`，或別寫 id |
#
# 錯誤分支：registry／consumer-meta 讀不到 → 只用硬編清單（不是故障）；parent walk 依賴 ntn（PATH 上）與
# timeout，查不到一律 fail-closed（同一指令本來也要打同一個 API，查不到時它多半也跑不成）。
# 載入範圍：hub-core plugin（consumer）與 clade home `.claude/settings.json`；hub-core 沒啟用的目錄（例：
# yudefine-hq 等非 consumer）不載入本 hook，在那些目錄裡本 gate 不存在。
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

[[ $norm =~ (ntn|curl|wget|notion) ]] || exit 0

shape=''
if [[ $norm == *children* ]]; then
  shape='blocks/<id>/children（列出整頁區塊）'
elif [[ $norm =~ pages[[:space:]]+get ]]; then
  shape='ntn pages get（整頁轉 Markdown）'
elif [[ $norm == *markdown* ]]; then
  shape='整頁 Markdown 讀取'
fi
[[ -n $shape ]] || exit 0

is_secret_id() {
  local id
  for id in "${ids[@]}"; do [[ ${#id} == 32 && $1 == "$id" ]] && return 0; done
  return 1
}

hit=''
for id in "${ids[@]}"; do
  [[ ${#id} == 32 && $norm == *"$id"* ]] && hit=$id && break
done

# 子區塊／子頁：靜態清單只有 Secret 頁本身，任意子區塊 id 認不出。只對「blocks/<id>/children」「pages get <id>」兩個整頁讀取位置的 id，用
# `ntn api /v1/blocks/<id>` 往上走 parent 鏈，祖先是 Secret 頁就擋。回應只進本行程變數，NEVER 印出。
# 查不到（ntn 缺、API 失敗、逾時、超過 MAX_HOPS 層）→ fail-closed 擋：同一指令本來也要打同一個 API。
# hook timeout 5 秒，整段 walk 的期限 WALK_BUDGET_MS 留餘裕，逾時前自己判定。
MAX_HOPS=6
WALK_BUDGET_MS=${CLADE_NOTION_SECRET_GATE_WALK_MS:-3500}
now_ms() { local t=${EPOCHREALTIME/[.,]/}; printf '%s' $((t / 1000)); }
deadline=$(($(now_ms) + WALK_BUDGET_MS))

# $1=要查的 id。return 0：祖先含 Secret 頁；1：確認不在 Secret 頁之下；2：無法確認
ancestor_is_secret() {
  local cur=$1 kind=blocks hop resp left p pid
  for ((hop = 0; hop < MAX_HOPS; hop++)); do
    left=$((deadline - $(now_ms)))
    ((left > 150)) || return 2
    # 2>&1：ntn 的錯誤訊息在 stderr；只進變數，NEVER 印出
    if ! resp=$(timeout "$((left / 1000)).$(printf '%03d' $((left % 1000)))" ntn api "/v1/$kind/$cur" </dev/null 2>&1); then
      # 第 0 層 404 object_not_found：ntn 這把 token 看不到目標 id，同一個 ntn 指令也拿不到內容 → 放行。
      # 祖先 404（token 只分享到子頁）、或指令自帶／改換憑證（token 可能不同）→ 無法確認，fail-closed
      [[ $resp == *object_not_found* && $own_auth == 0 && $hop == 0 ]] && return 1
      return 2
    fi
    [[ $resp =~ \"parent\"[[:space:]]*:[[:space:]]*\{([^}]*)\} ]] || return 2
    p=${BASH_REMATCH[1]}
    if [[ $p =~ \"(page_id|block_id)\"[[:space:]]*:[[:space:]]*\"([0-9a-fA-F-]+)\" ]]; then
      kind=blocks
    elif [[ $p =~ \"(database_id)\"[[:space:]]*:[[:space:]]*\"([0-9a-fA-F-]+)\" ]]; then
      kind=databases
    elif [[ $p =~ \"type\"[[:space:]]*:[[:space:]]*\"workspace\" ]]; then
      return 1 # 頂層
    else
      return 2 # 認不得的 parent 型別：無法確認
    fi
    pid=${BASH_REMATCH[2],,}
    pid=${pid//-/}
    is_secret_id "$pid" && return 0
    cur=$pid
  done
  return 2
}

# 指令自帶或改換憑證的字樣（curl／wget、authorization header、行內 *TOKEN=／*KEY=、--profile；`-` 已去掉）
own_auth=0
auth_re='(curl|wget|authorization|token=|key=|profile[[:space:]=])'
[[ $norm =~ $auth_re ]] && own_auth=1
unresolved=''
if [[ -z $hit ]]; then
  cands=()
  rest=$norm
  while [[ $rest =~ blocks/([0-9a-f]{32})/children ]]; do
    cands+=("${BASH_REMATCH[1]}")
    rest=${rest#*"${BASH_REMATCH[0]}"}
  done
  # `pages get` 之後到指令分隔符（; | &）或 JSON 欄位邊界（, }）為止的整段，裡面每個 32 碼 id 都是候選（flag 可在 id 前）
  pg_re='pages[[:space:]]+get([^;|&,}]*)'
  rest=$norm
  while [[ $rest =~ $pg_re ]]; do
    seg=${BASH_REMATCH[1]}
    rest=${rest#*"${BASH_REMATCH[0]}"}
    while [[ $seg =~ [0-9a-f]{32} ]]; do
      cands+=("${BASH_REMATCH[0]}")
      seg=${seg#*"${BASH_REMATCH[0]}"}
    done
  done
  # 不設候選數上限：整段 walk 共用 deadline，逾時即 unresolved → 擋
  for id in "${cands[@]}"; do
    ancestor_is_secret "$id"
    case $? in
      0) hit=$id && break ;;
      2) unresolved=$id && break ;;
    esac
  done
fi
if [[ -z $hit && -n $unresolved ]]; then
  {
    printf '⛔ notion-secret-read-gate：無法確認 %s 不在 Notion Secret 頁之下（ntn 查 parent 失敗或逾時），先擋（fail-closed）。\n' "$unresolved"
    printf '%s\n' '確認 ntn 已登入、網路正常後重試；Secret 值只准 notion-hub references/ntn-cookbook.md § 讀 Secret 的「指定 block id → jq 取值 → export」。'
  } >&2
  exit 2
fi
[[ -n $hit ]] || exit 0

{
  printf '⛔ notion-secret-read-gate：這條指令會整頁讀取 Notion Secret 頁或其子區塊（%s），值會印進 transcript。\n' "$shape"
  printf '%s\n' '正路（notion-hub references/ntn-cookbook.md § 讀 Secret）：只用「指定 block id → jq 取值 → export」，不列 children、不印區塊內容：'
  printf '%s\n' '  export X="$(timeout 30 ntn api "/v1/blocks/<block-id>" < /dev/null | jq -r '"'"'.[.type].rich_text | map(.plain_text) | join("")'"'"')"'
  printf '%s\n' 'block id 不知道 → NEVER 列 children 找；向 Charles 要該區塊的「Copy link to block」連結（# 後 32 碼）。'
  printf '%s\n' '誤擋（commit 訊息／grep 同時寫了 Secret 頁 id 與 children）→ 訊息改用 Write 落檔再 -F，或不寫 id。'
} >&2
exit 2
