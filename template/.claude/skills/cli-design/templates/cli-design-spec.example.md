# shortlink 命令介面規格

## 範圍

- 用途：管理短網址服務上的短連結與自訂網域
- 使用者：agent、CI（部署後自動建立活動連結），以及在終端機操作的人
- 規模：M（11 個命令，`link`、`domain` 兩層）
- 實作：TypeScript（Node.js 22），解析器 `commander` 13
- 本次範圍：新 CLI，從零設計

## 命令樹

```text
shortlink
├── link
│   ├── list      列出短連結
│   ├── get       取得單一短連結
│   ├── create    建立短連結
│   ├── update    修改目標網址或到期日
│   └── delete    刪除短連結
├── domain
│   ├── list
│   ├── get
│   ├── create
│   └── delete
├── commands      輸出機器可讀的命令樹（JSON）
└── login         以瀏覽器登入（只給人用；agent 用 SHORTLINK_TOKEN）
```

## 共通旗標

| 旗標 | 意義 | 適用命令 | 對應判準 |
| --- | --- | --- | --- |
| `--json` | 結果以 JSON 輸出到 stdout | 全部命令 | A3、B2 |
| `--force` | 跳過確認 | `link delete`、`domain delete` | A3、E1 |
| `--dry-run` | 印出將送出的 HTTP 請求（JSON），不送出，不需憑證 | `create`、`update`、`delete` | A3、E2 |
| `--limit`、`--cursor` | 分頁 | `list` | A3、B5 |
| `--workspace-id` | 指定工作區；也可用 `SHORTLINK_WORKSPACE_ID` | 全部遠端命令 | A4、G2、G3 |
| `--no-color`、`--no-input` | 關閉色碼；強制非互動 | 全部命令 | B4、D5 |

## 輸出契約

- 分流：stdout 只放結果；進度、警告、棄用通知都寫到 stderr
- JSON 形狀：

```json
{"items":[{"id":"lnk_8f2","slug":"fall-sale","target_url":"https://shop.example.com/sale","domain":"go.example.com","expires_at":"2026-11-30T15:59:59Z","created_at":"2026-10-18T02:00:00Z"}],"next_cursor":"lnk_8f2"}
```

- 空結果：`{"items":[],"next_cursor":null}`；`get` 找不到時走錯誤路徑（exit 4）
- 分頁與截斷：`list` 預設 50 筆，`next_cursor` 不為 null 即表示還有下一頁；`--all` 自動翻完
- 排版：stdout 是 TTY 時縮排，不是 TTY 時一行一個 JSON（寫進 `--help` 與 README）
- 色碼：只在 stderr 是 TTY、且沒有 `NO_COLOR` 時上色

## 錯誤與退出碼

| 退出碼 | 意義 | 範例情境 |
| --- | --- | --- |
| `0` | 成功 | 建立完成 |
| `1` | 一般失敗 | 伺服器 5xx |
| `2` | 用法錯誤 | 未知命令、未知旗標、缺必填值 |
| `3` | 已拒絕執行 | 非互動模式下刪除沒帶 `--force` |
| `4` | 找不到 | `link get lnk_x` 不存在 |
| `5` | 衝突 | `link create --slug fall-sale` 已存在 |
| `6` | 未授權 | token 缺少或過期 |

- 人類可讀錯誤：

```text
error: slug "fall-sale" already exists on go.example.com (lnk_8f2).
next: choose another --slug, or run `shortlink link update lnk_8f2 --target-url <url>`.
```

- `--json` 錯誤：

```json
{"error":{"code":"conflict","message":"slug \"fall-sale\" already exists on go.example.com","hint":"shortlink link update lnk_8f2 --target-url <url>","existing_id":"lnk_8f2"}}
```

## 非互動行為

- 判定條件：stdin 或 stdout 不是 TTY、有 `CI` 環境變數，或帶 `--no-input`

| prompt | 預設值 | 非互動時 | 事先給值的方式 |
| --- | --- | --- | --- |
| 目標網址 | 無 | exit 2，提示帶 `--target-url` | `--target-url` |
| 網域 | 工作區預設網域 | 用預設值 | `--domain` |
| 刪除確認 | 否 | exit 3，提示帶 `--force` | `--force` |

## 破壞性操作

| 命令 | 確認方式 | 預演 | 冪等語意 | 完成輸出 |
| --- | --- | --- | --- | --- |
| `link delete <id>` | 互動時問 y/N；`--force` 跳過；非互動且沒帶 `--force` → exit 3 | `--dry-run` | 不存在時 exit 4；`--ignore-missing` 改為 exit 0 | `{"deleted":["lnk_8f2"]}` |
| `domain delete <id>` | 同上，另外列出會一起失效的短連結數 | `--dry-run` | 同上 | `{"deleted":["dom_3"],"links_disabled":12}` |
| `link update <id>` | 不需確認 | `--dry-run` | 同值重送為 no-op、exit 0 | 更新後的完整物件 |

目標只接受 ID（`lnk_`、`dom_` 前綴），不接受 slug 前綴或萬用字元。

## 可發現性

- help 結構：每一層都有 `-h`／`--help`，內容依序為用途、用法、旗標與預設值、範例、相關命令；不需憑證與網路
- 根 help 第一屏：第一行是 `Agents: run \`shortlink commands --json\` for the full command tree; every command supports --json.`
- 命令搜尋：`shortlink commands --json` 輸出全部命令、旗標與說明（規模 M，不另做搜尋）
- 版本：`shortlink --version` → `shortlink 0.1.0`
- AGENTS.md 建議句：「要建立或查詢短網址時用 `shortlink` CLI，並一律帶 `--json`；認證用 `SHORTLINK_TOKEN`。」

## 認證與設定

- 認證：agent 與 CI 用 `SHORTLINK_TOKEN`；人用 `shortlink login`（瀏覽器）
- 設定優先序：旗標 > 環境變數 > 專案的 `.shortlink.json` > `$XDG_CONFIG_HOME/shortlink/config.json` > 預設值
- 多帳號或多環境：token 可存取多個工作區、又沒有指定時，非互動下 exit 2 並列出工作區 ID 與 `--workspace-id` 用法
- secret 處理：token 不出現在任何輸出；`--dry-run` 的 Authorization 標頭顯示為 `Bearer ***`；不提供 `--token` 旗標，改用環境變數或 `--token-file`

## 一致性治理

- 機械檢查：`test/cli-surface.test.ts` 遍歷 `shortlink commands --json`，斷言動詞屬於 `list|get|create|update|delete`、所有命令都有 `--json`、會改變遠端狀態的命令都有 `--dry-run`、沒有 `--format` 與 `--yes`；每次 PR 由 CI 執行
- 棄用政策：改名的命令與旗標保留兩個 minor 版本，期間照常可用，並在 stderr 印 `deprecated: use <新名稱>`

## 判準對照

| ID | 如何滿足／N/A 理由 |
| --- | --- |
| A1 | 全部採 `shortlink <名詞> <動詞>` |
| A2 | 只用 `list`、`get`、`create`、`update`、`delete`；`login` 與 `commands` 是具體動作 |
| A3 | `--json`、`--force`、`--dry-run`、`--limit`／`--cursor`、`--no-color`，沒有同義旗標 |
| A4 | 工作區一律叫 `--workspace-id`；到期日用 `--expires-at`（ISO 8601） |
| A5 | 長旗標全 kebab-case；短旗標只有 `-h` |
| A6 | 位置參數只有資源 ID 一個 |
| B1 | 見〈輸出契約〉分流 |
| B2 | 全部命令支援 `--json`，空結果為空陣列 |
| B3 | 欄位一律 snake_case、時間為 ISO 8601 UTC；欄位變動走棄用政策 |
| B4 | 非 TTY 不上色，尊重 `NO_COLOR` |
| B5 | `next_cursor` 與 `--all` |
| B6 | N/A：只有遠端，沒有本機模式 |
| B7 | TTY 縮排、非 TTY 單行，已寫進 help |
| B8 | 每個 `process.exit` 出口改用 `writeThenExit` |
| C1 | 見退出碼表 |
| C2 | 見退出碼表，每碼一個意思 |
| C3 | 每個錯誤都有 `next:` 行 |
| C4 | `--json` 時錯誤以 JSON 寫到 stderr，`code` 為穩定字串 |
| C5 | 用 commander 的 `showSuggestionAfterError`，未知命令與旗標皆 exit 2 |
| C6 | 拒絕執行 exit 3 |
| C7 | N/A：沒有多目標命令 |
| C8 | stack trace 只在 `SHORTLINK_DEBUG=1` 時印 |
| D1 | 見〈非互動行為〉判定條件 |
| D2 | 見 prompt 表 |
| D3 | 每個 prompt 都有對應旗標 |
| D4 | 不讀 stdin；`--target-url -` 才從 stdin 讀 |
| D5 | `--no-input` |
| D6 | 每個請求逾時 30 秒，可用 `--timeout 60s` 調整；Ctrl-C 時印出已完成的步驟 |
| E1 | 見破壞性操作表 |
| E2 | `create`、`update`、`delete` 都有 `--dry-run`，不需憑證 |
| E3 | 見破壞性操作表的冪等語意 |
| E4 | 只接受 ID |
| E5 | 刪除後輸出受影響的 ID |
| F1 | 每層 `-h`／`--help` |
| F2 | help 固定五段，含範例 |
| F3 | N/A：規模 M（`commands --json` 已足夠） |
| F4 | 根 help 第一行即 agent 入口 |
| F5 | `--version` 單行 |
| F6 | 見 AGENTS.md 建議句 |
| F7 | `shortlink completion bash\|zsh\|fish` |
| G1 | `SHORTLINK_TOKEN` |
| G2 | 見設定優先序 |
| G3 | 多工作區未指定時失敗並列出候選 |
| G4 | 見 secret 處理 |
| G5 | 設定檔放 `$XDG_CONFIG_HOME/shortlink/`，可用 `SHORTLINK_CONFIG` 覆寫 |
| G6 | N/A：沒有 telemetry |
| G7 | N/A：規模 M |
| H1 | N/A：規模 M |
| H2 | `test/cli-surface.test.ts` |
| H3 | N/A：規模 M |
| H4 | 見棄用政策 |

## 未決事項

- 自訂網域的 DNS 驗證可能要等好幾分鐘：要讓 `domain create` 預設等驗證完成（附 `--no-wait`），還是預設馬上回傳 `status: pending`？
