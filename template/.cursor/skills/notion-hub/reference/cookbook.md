# Notion hub 操作 cookbook（notion-hub skill）

> 座標**不在這裡**：一律 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`。本檔只收「怎麼打」的 recipe。狀態字用輸出的 `hub.ticketStatus`，類型字用 `hub.ticketType`，欄位名用 `hub.fields`（已含本 hub 的改名覆寫；下方 recipe 的欄位名是 canonical 寫法，打之前換成 `hub.fields` 的值）。

自由形式的 Notion 讀寫**一律 `ntn api`**，**NEVER** 用 Notion MCP（`notion-fetch`／`notion-create-pages`／`notion-get-comments`…）或 WebFetch；走 Routing Table 〔`notion-ops`〕，**NEVER** 主線第一手跑。`notion-sync.ts` 與 `notion-hub.ts resolve` 主線直接跑。

`ntn api` 在 stdin 沒關、stdout 又導向檔案（`> file`）時會一直等 stdin，看起來像卡死或逾時（ntn 0.23.8 實測：同一個 query `> file` 20 秒逾時、加 `< /dev/null` 0.7 秒回來）——每個呼叫 MUST 帶 `< /dev/null` 並包 `timeout 60`。仍逾時或回錯時，再用同路徑 `curl -m 30` 直打（token 取自 `~/.config/notion/auth.json`）看錯誤本文判成因；**NEVER** 沒排除 stdin 就下「DB 沒分享給 integration」的結論或改走 MCP。

## 1. 讀

```bash
# 解析 hub（座標 + 欄位名 + 狀態字）
node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path . > /tmp/hub.json
DS=$(jq -r .hub.board.dataSourceId /tmp/hub.json); ROW=$(jq -r .project.rowId /tmp/hub.json)

# 本專案的票（board 是 hub 共用，filter 所屬專案）
timeout 60 ntn api -X POST "/v1/data_sources/$DS/query" \
  -d "{\"page_size\":100,\"filter\":{\"property\":\"所屬專案\",\"relation\":{\"contains\":\"$ROW\"}}}" < /dev/null > /tmp/board.json
# has_more → 帶 start_cursor 翻頁；大輸出一律 dump 到檔再 jq / python，不倒進 context

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

## 2. 寫（machine 欄位）

狀態 / 版本 / 上線日 / Work ID / PR / 備註 / 交付項目 一律經 `notion-sync.ts`（file / open / follow / progress / done / release / eta / reconcile），它帶授權表、客戶面證據守門、regression 偵測與 sidecar。直接 PATCH 只剩 script 沒有入口的一處：

```bash
# 問客戶：票 → needs-customer（狀態字從 hub.ticketStatus 取，欄位名從 hub.fields 取）
S=$(jq -r '.hub.ticketStatus["needs-customer"]' /tmp/hub.json); K=$(jq -r '.hub.fields.board.status' /tmp/hub.json)
timeout 60 ntn api -X PATCH "/v1/pages/<page-id>" -d "{\"properties\":{\"$K\":{\"status\":{\"name\":\"$S\"}}}}" < /dev/null
```

`備註` 與內文是客戶看得到的地方：只放 consumer prod 網域的完整 URL（D2），**NEVER** 手動 PATCH 進 GitHub 連結或其他網域。

`ntn` 的 `PATCH /v1/blocks/<id>/children` **不支援 `after`**；要把 block 插到頁面中段直接打 Notion API（token 在 `~/.config/notion/auth.json`），見 `~/.claude/docs/notion-api.md`。

## 3. 建決策題票（問客戶）

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

欄位名換成 `hub.fields.board.*`；`類型` 若該 hub 是 status 型別，改 `{ "status": … }`（以 `ntn api "/v1/data_sources/<id>" < /dev/null` 讀到的型別為準）。
讀客戶勾了哪幾題：`timeout 60 ntn api "/v1/blocks/<page-id>/children?page_size=100" < /dev/null` → 取 `type=="to_do"` 的 `to_do.checked`；回應 `has_more: true` 時 MUST 帶 `&start_cursor=<next_cursor>` 翻到底，漏讀的 `to_do` 會被誤判成「客戶沒勾」。

## 4. 附圖（client 截圖）方案 C：token_v2 抓原檔

public API（ntn / MCP integration token）拿不到 in-app attachment：`檔案和媒體` 回 `files:[]`。要原檔走內部 API。Notion 現用 domain `app.notion.com`；`token_v2` 是 session secret，**NEVER** 印到 stdout / log / chat，寫檔 chmod 600。

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
# cookie 用限定 app.notion.com 的 jar，NEVER 用 -b "token_v2=..." 字串：-L 跟 redirect 到附件儲存 host 時字串 cookie 會一併送出
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

## 5. git 模糊對帳（ticket 沒 `Work ID` 時的 fallback）

有 `Work ID`（`<consumerId>/<workId>`，前綴是本 repo）一律 `notion-sync.ts status --work <workId>`，這段只在沒有時用。

```bash
TERM="<從 ticket 名稱抽的 domain 詞>"
git log --all --oneline -i --grep="$TERM" | head -10          # 候選 fix commit
git tag --contains <sha> | sort -V | head -1                  # 最早含它的 tag = 發版版本（空 = 未發版）
git branch -a --contains <sha>                                # 只在 session/* → worktree-only，維持 in-progress
git show --stat <sha>                                         # 輔助判斷是否真解客戶抱怨
```

判定：拿得到 tag 且在 main → **補跑 `release` 的候選**（版本 = 該 tag；代表 `/commit` Step 6b 當時漏跑）；否則維持 in-progress。命中 ≠ 真解，回填前 **MUST** 逐張給 user 看證據。

## 6. 版本對照

版本欄（`hub.fields.board.fixVersion`）填 git tag（`vX.Y.Z`），由 `notion-sync.ts release --tag` 寫；`git describe --tags --abbrev=0` 只在 `/commit` 打完 tag 之後才是本次版本。客戶看版本對照 consumer 的 `CHANGELOG.md` / release 頁。
