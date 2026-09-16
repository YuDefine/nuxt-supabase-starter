# Notion hub 操作 cookbook（notion-board / notion-ticket 共用）

> 座標**不在這裡**：一律 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`。本檔只收「怎麼打」的 recipe。狀態字用輸出的 `hub.ticketStatus`，欄位名用 `fields`。

## 1. 讀

```bash
# 解析 hub（座標 + 欄位名 + 狀態字）
node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path . > /tmp/hub.json
DS=$(jq -r .hub.board.dataSourceId /tmp/hub.json); ROW=$(jq -r .project.rowId /tmp/hub.json)

# 本專案的票（board 是 hub 共用，filter 所屬專案）
ntn api -X POST "/v1/data_sources/$DS/query" \
  -d "{\"page_size\":100,\"filter\":{\"property\":\"所屬專案\",\"relation\":{\"contains\":\"$ROW\"}}}" > /tmp/board.json
# has_more → 帶 start_cursor 翻頁；大輸出一律 dump 到檔再 jq / python，不倒進 context

# 單張 raw（含 property id）
ntn api "/v1/pages/<page-id>" > /tmp/t.json
# 好讀 markdown / comment：MCP notion-fetch <page-id>、notion-get-comments <page-id>

# 交付項目（客戶時程頁）本專案列
DDS=$(jq -r .hub.delivery.dataSourceId /tmp/hub.json)
ntn api -X POST "/v1/data_sources/$DDS/query" -d "{\"page_size\":100,\"filter\":{\"property\":\"專案\",\"relation\":{\"contains\":\"$ROW\"}}}"
```

## 2. 寫（machine 欄位）

狀態 / 版本 / 上線日 / Work ID / 交付項目 一律經 `notion-sync.ts`（open / progress / done / release / eta / reconcile），它帶授權表、regression 偵測與 sidecar。直接 PATCH 只用於 script 沒有入口的兩處：

```bash
# triage：backlog → needs-customer（狀態字從 hub.ticketStatus 取）
S=$(jq -r '.hub.ticketStatus["needs-customer"]' /tmp/hub.json)
ntn api -X PATCH "/v1/pages/<page-id>" -d "{\"properties\":{\"狀態\":{\"status\":{\"name\":\"$S\"}}}}"
# 補開發備註（不動客戶欄）
ntn api -X PATCH "/v1/pages/<page-id>" -d '{"properties":{"備註":{"rich_text":[{"text":{"content":"已在 line 通知"}}]}}}'
```

`ntn` 的 `PATCH /v1/blocks/<id>/children` **不支援 `after`**；要把 block 插到頁面中段直接打 Notion API（token 在 `~/.config/notion/auth.json`），見 `~/.claude/docs/notion-api.md`。

## 3. 建票（outbound）

MCP `notion-create-pages`，parent 用 `data_source_id`：

```json
{
  "parent": { "type": "data_source_id", "data_source_id": "<hub.board.dataSourceId>" },
  "pages": [{
    "properties": {
      "名稱": "{客戶口語化標題}",
      "狀態": "<hub.ticketStatus['needs-customer']>",
      "類型": "功能調整",
      "所屬專案": ["<project.rowId>"],
      "date:提報日期:start": "{YYYY-MM-DD}",
      "date:提報日期:is_datetime": 0
    },
    "content": "{markdown}"
  }]
}
```

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

判定：拿得到 tag 且在 main → **sync 候選**（版本 = 該 tag）；否則維持 in-progress。命中 ≠ 真解，回填前 **MUST** 逐張給 user 看證據。

## 6. 版本對照

`修復版本 >=` 填 git tag（`vX.Y.Z`），由 `notion-sync.ts release --tag` 寫；`git describe --tags --abbrev=0` 只在 `/commit` 打完 tag 之後才是本次版本。客戶看版本對照 consumer 的 `CHANGELOG.md` / release 頁。
