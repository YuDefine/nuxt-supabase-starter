# flow CLI 稽核報告

## 摘要

- 對象：`node vendor/scripts/flow/flow.ts`（clade `vendor/scripts/flow/flow.ts`，2026-10-18 版本）
- 規模：M（39 個子命令，`plan`、`handoff` 下有第二層）；使用者：agent 為主，人偶爾直接下
- 判定統計：PASS 12、PARTIAL 4、FAIL 8、N/A 15、未驗 12（共 51 項）
- 待修：P0 0 項、P1 9 項、P2 3 項（合併成 10 筆發現）
- 最先修：退出碼 2 一碼多義，加上未知旗標被靜默吞掉；agent 會把「拒絕執行」「結果為空」「打錯旗標」混為一談

## 探測範圍

- 執行的探測：`uv run <skill 根目錄>/scripts/probe_cli.py --allow short_help,help_subcommand,version,unknown_command,unknown_flag --typo sattus --depth 1 --max-commands 80 -- node vendor/scripts/flow/flow.ts`
- 預設動作確認：`vendor/scripts/flow/flow.ts:745-747`，沒有位置參數時印 USAGE 並 exit 1；看不懂的旗標被 `strict: false` 略過後也落到這裡，看不懂的位置參數走 `fail()`（unknown subcommand）→ `--allow` 的五項都安全
- 遞迴依據：同一段，`args.help` 為真時在 dispatch 前就印 USAGE 並 exit
- 校準：同一支 probe 以 `--typo atuh` 對 `gh` 命中 `typo_command`（exit 1、`suggestion_detected=true`），證明建議偵測有效
- 刻意不執行的命令：所有會寫 spine 的命令（`open`、`done`、`drop`、`plan drop --apply`、`sweep --apply` 等）；唯讀的 `status --json` 也未實跑，未取得使用者同意

## 發現

### P1｜C2：退出碼 2 同時代表三種意思

- 判定：FAIL
- 證據：
  - USAGE 寫明 `handoff render --write` 拒絕覆寫時 exit 2、`--check` 沒有 spine 時也 exit 2（`flow.ts:532`）。
  - `pending` 結果為空時 exit 2（`flow.ts:620`）。
  - 用法錯誤卻是 exit 1（`fail()`，`flow.ts:741-743`）。
- 對 agent 的影響：拿到 exit 2 時，無法判斷是「該停手」「沒事可做」還是「沒有資料」，只能去解析 stderr 的句子。
- 修法：在 USAGE 開頭加一張退出碼表，每個碼只有一個意思，例如 `2` 用法錯誤、`3` 已拒絕（需確認或會覆寫）、`4` 結果為空、`5` 缺少 spine。舊碼依 H4 保留一個版本，並在 stderr 印棄用提示。
- 改後行為：`flow pending; echo $?` → `4`；`flow handoff render --write`（拒絕覆寫）→ `3`

### P1｜C5、C3：未知旗標被靜默吞掉，未知命令沒有建議

- 判定：FAIL
- 證據：
  - `parseArgs({ strict: false })`（`flow.ts:485`）。
  - `probes.typo_command`：`flow sattus` → exit 1，stderr 是「unknown subcommand: sattus」加 246 行 USAGE，`suggestion_detected=false`。
  - `probes.unknown_flag` → exit 1，stdout 印 USAGE。
- 對 agent 的影響：打錯旗標（例如 `--dryrun`）時命令照常執行，等於不預演就直接動手；打錯子命令時，要從 246 行 USAGE 自己找出正確名稱。
- 修法：
  - 保留 `strict: false` 給 `flow step` 轉發旗標，其餘子命令在 dispatch 後用各自宣告的旗標集合比對，出現未宣告的旗標時 exit 2 並列出最接近的旗標。
  - 未知子命令只印「Did you mean: status?」與 `flow --help`，不要整份 USAGE 倒出來。
- 改後行為：`flow sattus` → stderr `unknown subcommand "sattus". Did you mean: status?`、exit 2

### P1｜A1：命令順序同時有動詞在前與名詞在前

- 判定：FAIL
- 證據：`root_subcommands` 同時有 `open`、`drop`、`close`（動詞在前），以及 `plan open`、`plan drop`、`handoff render`（名詞在前）。
- 對 agent 的影響：agent 學會頂層動詞（`drop <id>`）之後，會猜 `drop plan`，或拿頂層 `open` 去開 plan。
- 修法：工作項目的生命週期命令收進 `flow work <動詞>`，與 `flow plan <動詞>` 對齊；舊的頂層寫法依 H4 保留成別名。
- 改後行為：`flow work open <slug>`、`flow plan open <slug>`

### P1｜A3：預演有兩種寫法

- 判定：FAIL
- 證據：USAGE 中 `--dry-run` 出現在 `answer`、`publish-answers` 等 4 處；預設預演、帶 `--apply` 才執行的寫法出現在 `plan drop`、`sweep` 等 24 處。
- 對 agent 的影響：agent 無法從一個命令推出另一個命令要不要帶旗標才不會真的寫入。
- 修法：全面改成「預設預演、帶 `--apply` 執行」（佔多數，也較安全）；`--dry-run` 依 H4 保留成無作用的別名並印提示。
- 改後行為：`flow answer … ` 預設只印將寫入的事件，`--apply` 才寫

### P1｜C4：`--json` 模式下錯誤仍是純文字

- 判定：FAIL
- 證據：`fail()` 一律寫純文字加 USAGE 到 stderr（`flow.ts:741-743`），不看 `args.json`。
- 對 agent 的影響：用 `--json` 呼叫時，錯誤只能靠解析句子判斷原因。
- 修法：`args.json` 為真時，`fail()` 改印 `{"error":{"code":"…","message":"…","hint":"…"}}`，不附 USAGE。
- 改後行為：`flow status --json --bogus` → stderr `{"error":{"code":"unknown_flag","message":"…","hint":"did you mean --all?"}}`、exit 2

### P1｜F1、F2：`-h`、`help` 與子命令 help 都退回整份 USAGE

- 判定：PARTIAL
- 證據：
  - `probes.help` exit 0、輸出到 stdout。
  - `probes.short_help` exit 1；`probes.help_subcommand` → 「unknown subcommand: help」、exit 1。
  - 39 個 `commands[*].same_as_root_help` 全為 `true`。
  - `signals.has_examples=false`。
- 對 agent 的影響：每次查一個子命令都要吞 246 行說明，也沒有可直接複製的範例。
- 修法：宣告 `-h` 別名、加 `help <子命令>`；`<子命令> --help` 只印該子命令的段落並附一個範例。
- 改後行為：`flow plan --help` 只印 `plan` 的 6 個子命令與範例

### P1｜H2：命名一致性沒有機械檢查

- 判定：PARTIAL
- 證據：`test/` 有 110 支 flow 行為測試，其中沒有檢查子命令順序、預演旗標或退出碼表的測試；A1、A3 的不一致就是沒被擋下的結果。
- 對 agent 的影響：本報告修好的不一致，下一個新子命令還會再犯。
- 修法：新增 `test/flow-cli-surface.test.ts`，遍歷 USAGE 的子命令表，斷言：會寫入的命令都用 `--apply`、沒有 `--dry-run`；命令順序符合 A1 修法後的形狀；USAGE 的退出碼表與 `fail()` 的實際退出碼一致。
- 改後行為：新增一個帶 `--dry-run` 的子命令時，CI 會失敗並指出 A3

### P2｜F4：根 help 第一屏沒有 agent 入口

- 判定：FAIL
- 證據：`probes.help.stdout_head` 第一行就是 39 個子命令的長串列，沒有「先看哪裡」的提示。
- 嚴重度調整：P1 → P2：主要呼叫端是 skill 與 hook，已寫死要用的命令，agent 很少需要從根 help 自己找命令。
- 修法：USAGE 第一段加一行「Agents: start with `flow status --json`; `flow <cmd> --help` for one command」。
- 改後行為：根 help 第一行即是入口提示

### P2｜F5：沒有 `--version`

- 判定：FAIL
- 證據：`probes.version` exit 1，輸出 USAGE。
- 修法：`--version` 印 clade 版本（`package.json` 的 version）加上 commit 短碼。
- 改後行為：`flow --version` → `flow 1.13.75 (07157cc)`

### P2｜F7：沒有 shell completion

- 判定：FAIL
- 證據：`flow.ts` 中沒有 completion 相關程式碼（grep `completion` 只命中說明文字）。
- 修法：等 F2 改成每個子命令各自的 help 後，用同一份子命令表產生 completion。
- 改後行為：`flow completion zsh` 輸出 zsh 補完腳本

## 全項對照

| ID | 判定 | 嚴重度 | 證據 |
| --- | --- | --- | --- |
| A1 | FAIL | P1 | 見發現 A1 |
| A2 | PASS | — | `leaf_names` 39 個都是領域動詞（open／done／accept…），沒有 CRUD 同義詞並存（對照判準 A2 的同義詞表） |
| A3 | FAIL | P1 | 見發現 A3 |
| A4 | PASS | — | USAGE 中 `--reason` 16 處、`--repo` 21 處、`--actor` 7 處皆同名；`--why` 是「推薦理由」，與 `--reason` 不同概念 |
| A5 | PASS | — | 長旗標全是 kebab-case；沒有宣告短旗標 |
| A6 | PASS | — | 位置參數只有 `<work_id>` 或 `<slug>` 一個（USAGE） |
| B4 | PASS | — | 所有 probe 的 `ansi_in_stdout`／`ansi_in_stderr` 都是 false；原始碼沒有色碼字元 |
| B5 | N/A | — | list 類命令沒有上限或分頁（USAGE 未提及） |
| B6 | N/A | — | 只操作本機 spine，沒有遠端對象 |
| C1 | PASS | — | 未知命令與用法錯誤皆 exit 非 0（`probes.unknown_command.exit_code=1`） |
| C2 | FAIL | P1 | 見發現 C2 |
| C3 | PARTIAL | P1 | 錯誤走 stderr 並說明原因，但下一步是整份 USAGE（見發現 C5） |
| C4 | FAIL | P1 | 見發現 C4 |
| C5 | FAIL | P1 | 見發現 C5 |
| C6 | PASS | — | 拒絕執行時 exit 非 0：`handoff render --write` 拒絕覆寫 hand-written 檔時 exit 2（`flow.ts:532`） |
| C7 | N/A | — | 沒有多目標命令 |
| C8 | PASS | — | 錯誤經 `fail()` 輸出單行訊息，不印 stack trace |
| D1 | N/A | — | 沒有任何 prompt，不需判定互動與否 |
| D2 | PASS | — | 原始碼沒有 readline；`any_timeout=false` |
| D3 | N/A | — | 沒有 prompt |
| D4 | PASS | — | 原始碼不讀 `process.stdin`；stdin 接 `/dev/null` 時沒有卡住 |
| D5 | PASS | — | 沒有任何 prompt（原始碼沒有 readline、不讀 `process.stdin`），永遠是非互動模式，等同 `--no-input` 恆開 |
| E1 | PASS | — | `plan drop`、`sweep` 不帶 `--apply` 只預演（USAGE） |
| E2 | N/A | — | 不改變遠端狀態；本機預演見 E1 |
| F1 | PARTIAL | P1 | 見發現 F1、F2 |
| F2 | PARTIAL | P1 | 見發現 F1、F2 |
| F3 | N/A | — | 規模 M |
| F4 | FAIL | P2 | 見發現 F4 |
| F5 | FAIL | P2 | 見發現 F5 |
| F7 | FAIL | P2 | 見發現 F7 |
| G1 | N/A | — | 不需認證 |
| G3 | N/A | — | 沒有多帳號 |
| G4 | N/A | — | 不經手 secret |
| G5 | N/A | — | 沒有設定檔 |
| G6 | N/A | — | 沒有對外 telemetry |
| G7 | N/A | — | 規模 M |
| H1 | N/A | — | 規模 M |
| H2 | PARTIAL | P1 | 見發現 H2 |
| H3 | N/A | — | 規模 M |

## 未驗項

| ID | 原因 | 取得證據需要什麼 |
| --- | --- | --- |
| B1 | 只觀察到 help 與錯誤路徑，資料命令未實跑 | 經同意後實跑 `flow status --json 2>/dev/null \| jq .` |
| B2 | help 列出 7 個命令有 `--json`；`sources`、`plan stale` 等命令的輸出形式要實跑才知道 | 逐一讀這些命令的輸出程式碼，或實跑唯讀命令 |
| B3 | JSON 欄位的穩定性要比對歷史版本 | 比對 `status --json` 在兩個 tag 間的欄位差異 |
| B7 | JSON 排版需要實跑才看得到 | 實跑一個 `--json` 命令 |
| B8 | 84 個 `process.exit()` 出口只看到部分改用 `writeThenExit`（`flow.ts:1799`） | 逐一核對每個 `--json` 命令的出口 |
| D6 | `ingest`、`sources --apply` 可能執行很久，逾時與中斷行為要讀程式碼 | 讀 `sources` 的實作 |
| E3 | `open` 重複 slug、`done` 重複呼叫的行為要讀 fold 邏輯 | 讀 `spine.ts` 的 fold 規則 |
| E4 | `link`、`drop` 是否接受模糊 ID 要讀解析程式碼 | 讀 work id 的解析函式 |
| E5 | `sweep --apply`、`plan drop --apply` 完成後輸出什麼，USAGE 沒寫 | 讀兩者 `--apply` 分支的輸出程式碼 |
| F6 | 使用建議散落在多份規約，要確認有沒有一句可直接放進 AGENTS.md 的建議 | 搜尋 `rules/core/flow-work-tracking.md` |
| G2 | `CLADE_WORK_ID` 與旗標的優先序要讀程式碼 | 讀 ambient work id 的解析 |
| H4 | 棄用政策要看 CHANGELOG 的歷史 | 搜尋 CHANGELOG 的 flow 改名紀錄 |
