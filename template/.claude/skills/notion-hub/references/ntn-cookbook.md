# Notion hub 操作 cookbook（notion-hub skill）

只收「怎麼打」的 recipe。座標一律來自 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`；下方 recipe 的欄位名是 canonical 寫法，打之前換成 `hub.fields` 的值。誰來跑、`ntn` 的呼叫紀律與例外見 `rules/Notion執行者與ntn呼叫判準.md`。

## 讀取

```bash
# 解析 hub（座標 + 欄位名 + 狀態字）
node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path . > /tmp/hub.json
DS=$(jq -r .hub.board.dataSourceId /tmp/hub.json); ROW=$(jq -r .project.rowId /tmp/hub.json)

# 本專案的票（board 是 hub 共用，filter 所屬專案）
timeout 60 ntn api -X POST "/v1/data_sources/$DS/query" \
  -d "{\"page_size\":100,\"filter\":{\"property\":\"所屬專案\",\"relation\":{\"contains\":\"$ROW\"}}}" < /dev/null > /tmp/board.json
# has_more → 帶 start_cursor 翻頁；大輸出一律 dump 到檔再 jq / python，不倒進 context

# 找頁面（Phase 8）：只用 notion-scope.ts，NEVER 直接用 /v1/search 的結果（不帶歸屬，會混入其他客戶）
node ~/offline/clade/vendor/scripts/notion-scope.ts search --query "<關鍵字>" --consumer-path . < /dev/null > /tmp/scope.json   # 用 .inScope
node ~/offline/clade/vendor/scripts/notion-scope.ts owner "<Notion URL 或 id>" --consumer-path . < /dev/null                      # URL 尾端 32 碼 hex 就是 id

# 單張 raw（含 property id）
timeout 60 ntn api "/v1/pages/<page-id>" < /dev/null > /tmp/t.json
# 內文與 comment
timeout 60 ntn api "/v1/blocks/<page-id>/children?page_size=100" < /dev/null > /tmp/t-blocks.json   # has_children 要遞迴；has_more 要帶 start_cursor 翻頁
timeout 60 ntn api "/v1/comments?block_id=<page-id>" < /dev/null > /tmp/t-comments.json

# 交付項目（客戶時程頁）本專案列——hub 沒有 交付項目（delivery 為 null）時跳過：
# 進度在 board 的 `進度%`、逾期看 board 的承諾日期欄（`hub.fields.board.dueDate`；fc 是 `預估完成日`），上面的 board 查詢已含
DDS=$(jq -r '.hub.delivery.dataSourceId // empty' /tmp/hub.json)
[ -n "$DDS" ] && timeout 60 ntn api -X POST "/v1/data_sources/$DDS/query" -d "{\"page_size\":100,\"filter\":{\"property\":\"專案\",\"relation\":{\"contains\":\"$ROW\"}}}" < /dev/null
```

## 寫入

狀態 / 版本 / 上線日 / Work ID / PR / 備註 / 交付項目 經 `notion-sync.ts`（file / open / follow / progress / done / release / eta / reconcile）。直接 PATCH 只剩 script 沒有入口的一處：

```bash
# 問客戶：票 → needs-customer（狀態字從 hub.ticketStatus 取，欄位名從 hub.fields 取）
S=$(jq -r '.hub.ticketStatus["needs-customer"]' /tmp/hub.json); K=$(jq -r '.hub.fields.board.status' /tmp/hub.json)
timeout 60 ntn api -X PATCH "/v1/pages/<page-id>" -d "{\"properties\":{\"$K\":{\"status\":{\"name\":\"$S\"}}}}" < /dev/null
```

客戶面欄位能寫什麼見 `rules/客戶面證據判準.md`。

### 頁面內容（Phase 8）

寫入前 MUST 先確認寫入目標屬於本 hub（`rules/頁面歸屬判準.md` Rule 2）：

```bash
node ~/offline/clade/vendor/scripts/notion-scope.ts owner <page-or-block-id> --consumer-path . < /dev/null | jq '.results[0].inConsumerHub'   # 不是 true 就停
```

```bash
# 改 page properties
timeout 60 ntn api -X PATCH "/v1/pages/<page-id>" -d '{"properties":{...}}' < /dev/null
# 接在頁尾
timeout 60 ntn api -X PATCH "/v1/blocks/<page-id>/children" -d '{"children":[...]}' < /dev/null
# 改單一 block（table row 改值也是這條：PATCH 該 row，送整組 table_row.cells）
timeout 60 ntn api -X PATCH "/v1/blocks/<block-id>" -d '{"<type>":{...}}' < /dev/null
```

插到頁面**中段**：`ntn` 會擋 `after`（回 `body.after should be not present`），直接打 Notion API。`after` 是「插在哪個既有 block 之後」的 block id，parent 是該 block 的 parent（頁面本身或巢狀 block）；純加法插入對既有內容零擾動：

```bash
TOKEN=$(python3 -c "import json,os;print(next(iter(json.load(open(os.path.expanduser('~/.config/notion/auth.json'))).values())))")
curl -s -m 30 -X PATCH "https://api.notion.com/v1/blocks/<parent-id>/children" \
  -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28" -H "Content-Type: application/json" \
  -d '{"after":"<sibling-block-id>","children":[{"type":"bulleted_list_item","bulleted_list_item":{"rich_text":[{"type":"text","text":{"content":"…"}}]}}]}'
```

寫完 MUST 用 § 讀取 的 blocks 指令讀回，確認位置與內容。

## 建決策題票

`ntn api -X POST /v1/pages`，parent 用 `data_source_id`；內文用 `children` blocks（標題 `heading_1`／`heading_2`、
拍板題的勾選框 `to_do`、接手 Prompt `code`、其餘 `paragraph`／`bulleted_list_item`）。body 先寫檔再 `-d @file`：

```bash
cat > /tmp/decision.json <<'JSON'
{
  "parent": { "type": "data_source_id", "data_source_id": "<hub.board.dataSourceId>" },
  "properties": {
    "名稱":   { "title": [{ "text": { "content": "{客戶口語化標題}" } }] },
    "狀態":   { "status": { "name": "<hub.ticketStatus['needs-customer']>" } },
    "類型":   { "select": { "name": "<hub.ticketType.feature>" } },
    "所屬專案": { "relation": [{ "id": "<project.rowId>" }] }
  },
  "children": [
    { "type": "heading_1", "heading_1": { "rich_text": [{ "text": { "content": "開發前想跟您確認 N 件事" } }] } },
    { "type": "to_do", "to_do": { "checked": false, "rich_text": [{ "text": { "content": "{選項}" } }] } }
  ]
}
JSON
timeout 60 ntn api -X POST /v1/pages -d @/tmp/decision.json < /dev/null > /tmp/decision-out.json   # .id 就是 page id
```

Notion API 硬限制（違反回 400 `validation_error`）：`code` block 的 `language` 必填（接手 Prompt 用 `"plain text"`）；每個 rich_text 物件的 `content` ≤ 2000 字元，長文拆成多個 rich_text 物件；`children` 一次 ≤ 100 個 block，超過的建頁後用 `timeout 60 ntn api -X PATCH "/v1/blocks/<page-id>/children" -d @<file> < /dev/null` 續補。

範本刻意不帶 `提報日期`：`created_time` 型（例如 fc hub）由 Notion 自動填且唯讀，帶了整張票回 400；只有該欄是 `date` 型時才在 `properties` 補 `"提報日期": { "date": { "start": "{YYYY-MM-DD}" } }`。

欄位名換成 `hub.fields.board.*`；`類型` 若該 hub 是 status 型別，改 `{ "status": … }`（以 `ntn api "/v1/data_sources/<id>" < /dev/null` 讀到的型別為準）；bug 修正類決策題改用 `hub.ticketType.bug`。
讀客戶勾了哪幾題：`timeout 60 ntn api "/v1/blocks/<page-id>/children?page_size=100" < /dev/null` → 取 `type=="to_do"` 的 `to_do.checked`；回應 `has_more: true` 時帶 `&start_cursor=<next_cursor>` 翻到底（漏讀的 `to_do` 會被誤判成「客戶沒勾」）。

## 附圖（client 截圖）：token_v2 抓原檔

public API（ntn / MCP integration token）拿不到 in-app attachment：`附件`（files 欄）回 `files:[]`。要原檔走內部 API。Notion 現用 domain `app.notion.com`；`token_v2` 的 secret 處置見 `rules/Notion執行者與ntn呼叫判準.md` Rule 6。

```bash
# Step 1 — 一次性取 token_v2 + notion_user_id（agent-browser persistent profile 需已登入 Notion）
agent-browser --session notion-token open https://app.notion.com
agent-browser --session notion-token wait --load networkidle
umask 077; agent-browser --session notion-token state save /tmp/notion_state.json >/dev/null
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const state = JSON.parse(readFileSync('/tmp/notion_state.json', 'utf8'))
const cookies = state.cookies ?? state.data?.cookies ?? []
const n = Object.fromEntries(cookies.filter(c => c.domain.endsWith('notion.com')).map(c => [c.name, c.value]))
if (n.token_v2) writeFileSync('/tmp/notion_token_v2.txt', n.token_v2, { mode: 0o600 }); else console.log('token_v2 MISSING')
if (n.notion_user_id) writeFileSync('/tmp/notion_user_id.txt', n.notion_user_id, { mode: 0o600 })
NODE

# Step 2 — attachment 引用（spaceId：頁面 URL 的 workspace，或 syncRecordValues 回傳的 space_id）
TOKEN=$(cat /tmp/notion_token_v2.txt); USERID=$(cat /tmp/notion_user_id.txt)
SPACE='<workspace space id>'; PAGE='<ticket page id, with dashes>'
# cookie 用限定 app.notion.com 的 jar（理由見判準 Rule 6）
JAR=$(mktemp); chmod 600 "$JAR"; printf 'app.notion.com\tFALSE\t/\tTRUE\t0\ttoken_v2\t%s\n' "$TOKEN" > "$JAR"
curl -s 'https://app.notion.com/api/v3/syncRecordValues' -b "$JAR" \
  -H 'content-type: application/json' -H "x-notion-active-user-header: $USERID" -H "x-notion-space-id: $SPACE" -A 'Mozilla/5.0' \
  --data "{\"requests\":[{\"pointer\":{\"table\":\"block\",\"id\":\"$PAGE\",\"spaceId\":\"$SPACE\"},\"version\":-1}]}" -o /tmp/rec.json
grep -oE 'attachment:[0-9a-f-]{36}:[^"\\]+' /tmp/rec.json | head -1

# Step 3 — image-proxy 下載（width=2000 / cache=v2 / -L 三者必帶）
ATT='attachment:…'; ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$ATT")
curl -sL -b "$JAR" -A 'Mozilla/5.0' -o /tmp/ticket_img.png \
  "https://app.notion.com/image/${ENC}?id=${PAGE}&table=block&spaceId=${SPACE}&width=2000&userId=${USERID}&cache=v2"
file -b /tmp/ticket_img.png   # 期望 PNG image data；回 text/plain 或 Found. Redirecting = 認證或 -L 漏了
rm -f "$JAR"
```

只要「人看一眼」用 agent-browser 開 ticket 截圖即可，不必走方案 C。

## 模糊對帳（ticket 沒 `Work ID` 時的 fallback）

有 `Work ID` 時用 `notion-sync.ts status --work <workId>`，這段只在沒有時用；判定見 `rules/看板分桶與對帳判準.md` Rule 2。

```bash
TERM="<從 ticket 名稱抽的 domain 詞>"
git log --all --oneline -i --grep="$TERM" | head -10          # 候選 fix commit
git tag --contains <sha> | sort -V | head -1                  # 最早含它的 tag = 發版版本（空 = 未發版）
git branch -a --contains <sha>                                # 只在 session/* → worktree-only，維持 in-progress
git show --stat <sha>                                         # 輔助判斷是否真解客戶抱怨
```


## Provision：開新 hub／既有 hub 加專案

在 clade 做（寫的是 clade `registry/`）。判準見 `rules/hub-provision判準.md`；每步做完用 `ntn api` 讀回確認（副本是非同步建出來的）。

```bash
# A. 新客戶／獨立 repo：複製 Org 模板
ORG=$(jq -r '.templates.org.pageId' ~/offline/clade/registry/notion-fleet.json)
# 1) Notion MCP notion-duplicate-page {page_id: $ORG}  ← 唯一的 MCP 呼叫（public API 沒有 duplicate）
# 2) 移到客戶指定位置、改名（public API 就有）
timeout 60 ntn api -X POST "/v1/pages/<副本>/move" -d '{"parent":{"type":"page_id","page_id":"<目標父頁>"}}' < /dev/null
timeout 60 ntn api -X PATCH "/v1/pages/<副本>" -d '{"properties":{"title":{"title":[{"text":{"content":"Ticket 管理（<客戶/專案>）"}}]}}}' < /dev/null
# 3) 找出副本的 board／專案／里程碑 database 與 data source（Main 的「全專案共用資料庫」列底下）
timeout 60 ntn api "/v1/blocks/<共用資料庫頁>/children?page_size=100" < /dev/null   # child_database → GET /v1/databases/<id> 取 data_sources[0].id
# 4) 專案主檔建一列（名稱、專案代碼）→ 記 rowId
# 5) 「專案標準架構」列改名成專案頁 → 裡面「專案管理」就是入口頁（ticketPageId），照 B-3 把 Ticket view 篩成本專案

# B. 既有 hub 加專案：複製同 hub 已有的入口頁（registry projects.<任一>.ticketPageId）
# 1) notion-duplicate-page {page_id: <同 hub 的 ticketPageId>}；linked view 仍指向同一張 board（board 不在被複製的子樹裡）
# 2) 專案主檔建列 → rowId；副本 move 到專案頁底下、改名「專案管理（<CODE>）」
# 3) 入口頁 Ticket view 改篩本專案：讀出 filter，把 relation contains 換成新 rowId 再寫回
timeout 60 ntn api "/v1/blocks/<入口頁>/children" < /dev/null                          # child_database id
timeout 60 ntn api /v1/views database_id==<該 child_database id> < /dev/null          # view ids
V=$(mktemp -d)                                                                         # 每次 provision 自己的暫存目錄
timeout 60 ntn api /v1/views/<view-id> < /dev/null > "$V/view.json"                    # filter.and[] 裡 relation.contains 那條
timeout 60 ntn api -X PATCH /v1/views/<view-id> -d @"$V/view-patch.json" < /dev/null    # {"filter": <改好的整個 filter>}；寫完 GET 讀回核對

# C. 登記＋驗證
#   registry/notion-hubs.json：A 新增整個 hub（ticketStatus／ticketType／fields 照 Org 模板＝fc 同一套字）；
#   B 只加 projects.<CODE> = {pageId, rowId, ticketPageId}
CLADE_HOME=<clade 樹> node scripts/audit-notion-hub-schema.ts --hub <key>                 # 必須 ok
CLADE_HOME=<clade 樹> node vendor/scripts/notion-intake.ts --hub <key>                    # 讀得到、歸屬對
```

