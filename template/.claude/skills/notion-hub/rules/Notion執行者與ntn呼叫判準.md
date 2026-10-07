# Rule 1 - 確定性 script 主線直接跑，自由形式的 Notion 讀寫經〔`notion-ops`〕派出，NEVER 主線第一手自己跑 `ntn`

- Level: `MUST`
- 主線直接跑：`vendor/scripts/notion-sync.ts`、`vendor/scripts/lib/notion-hub.ts resolve`、`scripts/audit-notion-hub-schema.ts`。它們的寫入範圍、授權轉移表、schema 檢查、sidecar 都寫死在 script 裡。
- 自由形式的 Notion 讀寫（查詢、讀頁／blocks、comment、建頁、PATCH）走 Routing Table〔`notion-ops`〕：Pi `--model gemini --effort high` → `grok-xai` xhigh → 鏈尾 `dispatch-fallback`（Opus 5.5 low）。
- **NEVER** 主線第一手自己跑 `ntn`。
- 狀態轉移一律經 `notion-sync.ts`（file／open／follow／progress／done／release／eta／reconcile），它帶授權表、客戶面證據守門、regression 偵測與 sidecar；**NEVER** 自己 PATCH 狀態繞過 script。唯一例外是問客戶時把票設成 needs-customer（`references/ntn-cookbook.md` § 寫入）。

## Good Example

- 這個例子是好的，因為 resolve 主線直接跑，撈票交給 notion-ops。

```text
主線：node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .
派〔notion-ops〕：依 references/ntn-cookbook.md § 讀取 撈本專案票，dump 到檔回傳路徑
```

## Bad Example

- 這個例子是壞的，因為主線第一手跑 `ntn`，還自己 PATCH 狀態繞過授權表。

```text
主線：ntn api -X PATCH /v1/pages/<id> -d '{"properties":{"狀態":{"status":{"name":"驗收中"}}}}'
```

# Rule 2 - 自由形式的 Notion 讀寫一律 `ntn api`，NEVER Notion MCP 或 WebFetch，只有三處具名例外

- Level: `MUST`
- **NEVER** 用 Notion MCP（`notion-fetch`／`notion-create-pages`／`notion-get-comments`…）或 WebFetch（Notion 需登入，只會拿到 redirect loop）。
- 不走 `ntn` 的只有三處：
  1. `ntn` 的 `PATCH /v1/blocks/<id>/children` 不支援 `after`：要把 block 插到頁面中段直接打 Notion API，指令見 `references/ntn-cookbook.md` § 寫入 › 頁面內容。
  2. in-app 附件原檔：public API 拿不到，走 token_v2 內部 API（`references/ntn-cookbook.md` § 附圖，secret 處置見 Rule 6）。
  3. provision 的整頁複製：Notion MCP `notion-duplicate-page`（public API 沒有 duplicate）；move、改名、改 view 仍走 `ntn api`，且 **NEVER** 以 MCP 回傳當完成——副本非同步建出，每步用 `ntn api` 讀回確認。

## Good Example

- 這個例子是好的，因為只有整頁複製用 MCP，其餘仍是 `ntn api` 並讀回確認。

```text
notion-duplicate-page {page_id: <Org 模板>} → ntn api POST /v1/pages/<副本>/move → ntn api GET /v1/pages/<副本> 確認 parent 已變
```

## Bad Example

- 這個例子是壞的，因為讀票改走 MCP。

```text
notion-fetch {id: <ticket page id>}
```

# Rule 3 - 每個 `ntn api` 呼叫 MUST 帶 `< /dev/null` 並包 `timeout 60`，逾時 NEVER 直接歸因成權限

- Level: `MUST`
- `ntn api` 在 stdin 沒關、stdout 又導向檔案（`> file`）時會一直等 stdin，看起來像卡死或逾時（ntn 0.23.8 實測：同一個 query `> file` 20 秒逾時、加 `< /dev/null` 0.7 秒回來）。
- 仍逾時或回錯時，再用同路徑 `curl -m 30` 直打（token 取自 `~/.config/notion/auth.json`）看錯誤本文判成因；**NEVER** 沒排除 stdin 就下「DB 沒分享給 integration」的結論或改走 MCP。
- 大輸出一律 dump 到檔再 `jq`／python，不倒進 context。

## Good Example

- 這個例子是好的，因為 stdin 已關、有時限、輸出落檔。

```bash
timeout 60 ntn api "/v1/pages/<page-id>" < /dev/null > /tmp/t.json
```

## Bad Example

- 這個例子是壞的，因為 stdin 沒關，逾時後又直接歸因成權限問題。

```text
ntn api "/v1/data_sources/$DS/query" -d … > /tmp/board.json → 20 秒逾時 → 「DB 沒分享給 integration」，改用 MCP
```

# Rule 4 - 狀態字、類型字、欄位名一律取自 resolve 輸出，Notion 座標一律住 registry

- Level: `MUST`
- 狀態字用 `hub.ticketStatus`，`類型` 字用 `hub.ticketType`，欄位名用 `hub.fields`（已含本 hub 的改名覆寫）；cookbook recipe 的欄位名是 canonical 寫法，打之前換成 `hub.fields` 的值。**NEVER** 憑記憶寫——不同 hub 不同字，客戶也會改，寫錯 Notion 直接拒絕。
- 懷疑欄位或選項被改過 → `node ~/offline/clade/scripts/audit-notion-hub-schema.ts --hub <key>`。
- **NEVER** 在 skill、文件、script 寫 Notion id；座標一律在 `registry/notion-hubs.json`，經 `notion-hub.ts resolve` 取得。
- `類型` 若該 hub 是 status 型別，改 `{ "status": … }`（以 `ntn api "/v1/data_sources/<id>" < /dev/null` 讀到的型別為準）。

## Good Example

- 這個例子是好的，因為狀態字與欄位名都從 resolve 輸出取。

```bash
S=$(jq -r '.hub.ticketStatus["needs-customer"]' /tmp/hub.json); K=$(jq -r '.hub.fields.board.status' /tmp/hub.json)
```

## Bad Example

- 這個例子是壞的，因為憑記憶寫了別的 hub 的狀態字。

```text
"狀態": { "status": { "name": "等客戶回覆" } }
```

# Rule 5 - 生命週期由 flow 事件自動推進，NEVER 叫人「做完記得同步 Notion」

- Level: `MUST`
- `flow plan open`／`flow done` 成功後 `follow` 自動推進 ticket 狀態與交付項目進度，`/commit` Step 6b 跑 `release`。
- 沒推進代表 hook 或 Step 6b 沒跑，修那裡；不要在本 skill 補一句提醒。
- 例外一個手動掛載點：非 `file` 建票的工作開工前要跑一次 `notion-sync.ts open`（見認領分流判準 Rule 3）。

## Good Example

- 這個例子是好的，因為發版後票沒推進時去查 Step 6b。

```text
票仍進行中但 v1.42.0 已發 → /commit Step 6b 的 release 沒跑 → 補跑 notion-sync.ts release --tag v1.42.0
```

## Bad Example

- 這個例子是壞的，因為把自動化該做的事轉成人工提醒。

```text
做完後記得到 Notion 把票拉到驗收中
```

# Rule 6 - `token_v2` 是 session secret，NEVER 印出或用字串 cookie 傳送

- Level: `MUST`
- 只有抓 in-app 附件原檔時才取 `token_v2`；只要「人看一眼」用 agent-browser 開 ticket 截圖即可，不必取 token。
- **NEVER** 把 `token_v2` 印到 stdout／log／chat；寫檔一律 `umask 077` 或 chmod 600，用完刪除暫存 cookie jar。
- curl 帶 cookie 用限定 `app.notion.com` 的 cookie jar，**NEVER** 用 `-b "token_v2=..."` 字串：`-L` 跟 redirect 到附件儲存 host 時，字串 cookie 會一併送出。

## Good Example

- 這個例子是好的，因為 token 只進權限 600 的 jar，且 jar 綁定網域。

```bash
JAR=$(mktemp); chmod 600 "$JAR"; printf 'app.notion.com\tFALSE\t/\tTRUE\t0\ttoken_v2\t%s\n' "$TOKEN" > "$JAR"
curl -sL -b "$JAR" … ; rm -f "$JAR"
```

## Bad Example

- 這個例子是壞的，因為 token 進了 argv，redirect 時也會送到別的 host。

```bash
curl -sL -b "token_v2=$TOKEN" "https://app.notion.com/image/…"
```
