# Rule 1 - 先定規模與使用者，再逐項判定適用的判準 ID

- Level: `MUST`
- 本檔每一項判準都有 ID（`<類別字母><序號>`，如 `C6`）。design lane 用 ID 對照「這項怎麼滿足」，audit lane 用同一批 ID 判定，兩條 lane 都 NEVER 另起一套清單。
- 每項標注兩個屬性：
  - `[P0]`／`[P1]`／`[P2]` 是預設嚴重度。
  - `[S+]`／`[M+]`／`[L]` 是最小適用規模。
- 規模由可觀察事實判定，取符合的最大一級：
  - `S`：單一入口，沒有子命令，或子命令 ≤ 5 個。
  - `M`：子命令 > 5 個，或命令樹有 2 層以上。
  - `L`：命令 ≥ 50 個，或由 API／schema 生成，或由多個團隊共同維護。
- 適用規則：
  - 標 `[S+]` 的項目對任何規模都適用。
  - 標 `[M+]` 的項目在 M、L 適用。
  - 標 `[L]` 的項目只在 L 適用。
  - 項目另寫「僅當…」的，條件不成立時判 N/A。
- 使用者預設包含 agent 與 CI。只有使用者明說「只給人互動使用」時，B、C、D 類的 P0 才可依 audit 規則下調。
- 嚴重度定義：
  - `P0`：agent／CI 會誤判結果、卡住，或造成非預期的變更（靜默失敗、誤刪、無限等待輸入）。
  - `P1`：agent 會走錯命令、多花回合，或必須解析人類文字猜意思。
  - `P2`：一致性或體驗問題，不改變執行結果。
- 不適用的項目逐項寫 N/A 與理由。NEVER 以「這支很小」「只是內部工具」整類跳過。
- 每項後面括號標的出處：
  - 「cf」指 Cloudflare `cf` CLI 的公開說明。
  - 「clig」指 clig.dev 等通用準則。
  - 原文與網址在 `references/來源摘錄.md`。

## Good Example

- 這個例子是好的，因為它先用可觀察事實定規模，再逐項列出適用與 N/A 理由。

````md
對象：`flow`（子命令 39 個、兩層）→ 規模 M；使用者含 agent → B／C／D 全適用。
- F3 `[L]` → N/A：規模 M，不需要命令搜尋入口
- G1 `[S+]` 僅當需要認證 → N/A：本機 CLI，不呼叫外部 API
- 其餘 `[S+]`、`[M+]` 項目全部適用
````

## Bad Example

- 這個例子是壞的，因為它憑印象整類跳過，後續報告會漏掉 P0 項。

````md
對象：內部小工具，D、E 類不用看。
````

# Rule 2 - A 類：命令文法與命名要讓 agent 猜得中

- Level: `MUST`
- **A1** `[P1][M+]` 命令層級順序全 CLI 固定一種：`<tool> <名詞> <動詞>` 或 `<tool> <動詞> <名詞>`。同一支 CLI 兩種並存即 FAIL。cf 的命令呈 `cf <產品> <動詞>` 形狀。（cf，順序是從範例歸納，原文未明訂）
- **A2** `[P1][S+]` 讀寫資源使用標準動詞：`list`、`get`、`create`、`update`、`delete`；其他動作用具體動詞（`deploy`、`run`、`login`）。同義詞一律收斂到標準動詞：
  - `info`、`describe`、`show`、`inspect` → `get`
  - `remove`、`rm`、`destroy` → `delete`
  - `ls` → `list`

  別名可以保留，但 help 與文件只列標準名。cf 的原則是「always `get`, never `info`」，理由是 agent 預期 `get` 時，遇到用 `info` 的產品就會呼叫一個不存在的命令。（cf）
- **A3** `[P1][S+]` 共通旗標使用固定詞彙，同一意義全 CLI 只有一個標準名：
  - `--json`：機器可讀輸出。不和 `--format json`、`--output json`、`-o json` 混用；已有 `--format` 時，`--json` 是它的捷徑且每個命令都有。cf 原文：「always `--json`, never `--format`, and always supported across commands」。
  - `--force`：跳過確認。不和 `--yes`、`-y`、`--skip-confirmations` 各自代表同一件事；已有 `--yes` 的 CLI 選定一個標準名，另一個只當別名。（cf）
  - 預演：二擇一，全 CLI 一致。一是帶 `--dry-run` 只預演不送出；二是預設就只預演，帶 `--apply` 才真的執行。兩種並存即 FAIL，因為 agent 無法從一個命令推出另一個命令要不要帶旗標。
  - `--limit`／`--cursor`：分頁。
  - `--quiet`／`--verbose`：輸出量。
  - `--no-color`：關閉色碼。
- **A4** `[P2][S+]` 同一概念跨命令同名：`--account-id` 不能在別的命令叫 `--account` 或 `--acct`。單位寫進旗標名（`--timeout-seconds`），或要求值帶單位（`--timeout 30s`）。
- **A5** `[P2][S+]` 長旗標用 kebab-case。短旗標只給高頻旗標，且全 CLI 意義一致：`-f` 不能一處是 `--force`、另一處是 `--file`。
- **A6** `[P1][S+]` 位置參數只放一個主要對象，或同型的多個對象。兩個以上角色不同的值改成具名旗標，否則 agent 會猜錯順序。

## Good Example

- 這個例子是好的，因為動詞、旗標詞彙與層級順序在不同產品間完全一致，agent 學會一個就能推出其他。

````md
mycli db list --json
mycli db get <db-id> --json
mycli db delete <db-id> --force
mycli kv list --json
mycli kv get <namespace-id> --json
mycli kv delete <namespace-id> --force --dry-run
````

## Bad Example

- 這個例子是壞的，因為每個產品各取各的動詞與旗標，正是 cf 改版前 `d1 info`／`hyperdrive get`／`workflows describe` 的問題。

````md
mycli db info <name> --format json
mycli kv show <name> -o json
mycli queue describe <name> --output=json
mycli db rm <name> --yes
mycli kv delete <name> --skip-confirmations
````

# Rule 3 - B 類：輸出要分清楚結果與訊息，並以 JSON 為契約

- Level: `MUST`
- **B1** `[P0][S+]` stdout 只放結果資料。進度、提示、警告、spinner、棄用通知一律走 stderr。驗法：`<cmd> --json 2>/dev/null | jq .` 必須成功。（cf、clig）
- **B2** `[P1][S+]` 每個會回資料的命令都支援 `--json`（或預設輸出 JSON）。JSON 只包含結果本身，cf 原文：「it contains only the result, so an agent can parse it or filter it with `jq`」。空結果回 `[]` 或 `{}`，NEVER 回「No items found」這類句子。（cf）
- **B3** `[P1][S+]` JSON 結構是契約：
  - 欄位名與型別穩定。時間用 ISO 8601 UTC 字串；數量用數字，單位放在欄位名或另開欄位。
  - 可以新增欄位。改名、刪除或改型別要走 H4 棄用政策。
  - 人類可讀格式可以自由調整，但 NEVER 要求 agent 解析它。
- **B4** `[P2][S+]` 輸出不是 TTY 時，不印 ANSI 色碼、spinner 或進度條覆寫字元；尊重 `NO_COLOR` 與 `TERM=dumb`，並提供 `--no-color`。（clig、no-color.org）
- **B5** `[P1][M+]` 僅當 list 類命令有上限或分頁：JSON 輸出要看得出是否截斷，並給出下一頁的取法（例如 `{"items":[…],"next_cursor":"…"}`，或提供 `--all`）。NEVER 靜默截斷。（clig；cf 未公開分頁規則）
- **B6** `[P1][S+]` 僅當同一命令可以作用在本機與遠端：輸出明示這次作用的是哪一邊，預設對象寫進 help。cf 的 Local Explorer 要求輸出「clearly signal whether commands are applied to remote or local resources」。（cf）
- **B7** `[P2][S+]` JSON 的排版（縮排或壓縮）寫進文件且全命令一致。cf 的上線文說給 agent 時會壓縮，文件卻說一律縮排，兩者互相矛盾；設計時自己定一種並寫明，NEVER 只照其中一邊抄。（cf）
- **B8** `[P0][S+]` 僅當 CLI 以 Node.js 實作，且輸出會被 pipe 消費：每個 `process.exit()` 出口都先等 stdout flush。判準與寫法在 fleet 的 `code-style` 規約〈CLI script 的 stdout 收尾〉，本項只判有沒有做到，NEVER 另寫一套。

## Good Example

- 這個例子是好的，因為結果與訊息分流、空結果是空陣列、截斷可被機器看出。

````md
$ mycli db list --json --limit 2 2>/dev/null
{"items":[{"id":"db_1","name":"main","created_at":"2026-10-01T03:00:00Z"},{"id":"db_2","name":"logs","created_at":"2026-10-02T03:00:00Z"}],"next_cursor":"db_2"}

$ mycli kv list --json 2>/dev/null
{"items":[],"next_cursor":null}
````

## Bad Example

- 這個例子是壞的，因為警告混進 stdout、空結果是句子、截斷沒有任何訊號，`jq` 一接就壞。

````md
$ mycli db list --json
Warning: config file is deprecated
[{"id":"db_1"},{"id":"db_2"}]
(showing first 2 of 40)

$ mycli kv list --json
No namespaces found.
````

# Rule 4 - C 類：錯誤與退出碼要讓 agent 不必讀懂句子就知道成敗

- Level: `MUST`
- **C1** `[P0][S+]` 成功時 exit 0。任何沒有完成使用者要求的情況都 exit 非 0。（cf：「A failed command exits with a non-zero status」）
- **C2** `[P1][S+]` 退出碼的語意寫進文件並保持穩定：
  - 至少區分 `0` 成功、`1` 一般失敗、`2` 用法錯誤（未知命令、未知旗標、缺參數）。
  - 需要時再加碼，例如未授權、找不到、衝突、逾時。
  - 同一個碼 NEVER 代表兩種意義。
- **C3** `[P1][S+]` 錯誤訊息走 stderr，並包含三件事：發生了什麼、為什麼（附具體值）、下一步怎麼做（可直接複製的命令，或要帶的旗標）。
- **C4** `[P1][S+]` `--json` 模式下，錯誤也要機器可讀：stderr 印單一 JSON 物件，例如 `{"error":{"code":"not_found","message":"…","hint":"…"}}`。`code` 是穩定字串；stdout 不混入錯誤。
- **C5** `[P1][S+]` 遇到未知命令或未知旗標：exit 2（用法錯誤），stderr 列出最接近的候選，並說明怎麼列出全部命令。cf 原文：「If an agent types a command that does not exist, `cf` lists the closest matches」。（cf）
- **C6** `[P0][S+]` 因為缺少確認而拒絕執行（例如非互動模式下沒帶 `--force`）時，MUST exit 非 0，並在 stderr 寫明要帶什麼。
  - cf 是反例：它印 `Aborted.` 後 exit 0，文件自己警告「A successful exit does not mean the resource was deleted」。
  - 稽核時遇到同樣行為照 FAIL 判，NEVER 以「cf 也這樣」放行。
- **C7** `[P0][M+]` 僅當有批次或多目標操作：部分失敗時 exit 非 0，並逐一列出每個目標的成功或失敗。
- **C8** `[P2][S+]` 預設錯誤輸出不印 stack trace，只在 `--verbose` 或 debug 環境變數下才印。

## Good Example

- 這個例子是好的，因為退出碼、錯誤串流、下一步與機器可讀碼都具備，agent 可以直接修正重跑。

````md
$ mycli db delete db_1; echo "exit=$?"
error: refusing to delete db_1 without confirmation in non-interactive mode.
next: re-run with --force, or preview with --dry-run.
exit=3

$ mycli db gt db_1; echo "exit=$?"
error: unknown command "gt" for "mycli db". Did you mean: get?
run `mycli db --help` to list commands.
exit=2
````

## Bad Example

- 這個例子是壞的，因為拒絕執行卻回 0（cf 的 `Aborted.` 行為），未知命令也沒有建議，agent 會把沒刪掉當成已刪掉。

````md
$ mycli db delete db_1; echo "exit=$?"
Aborted.
exit=0

$ mycli db gt db_1; echo "exit=$?"
Error!
exit=1
````

# Rule 5 - D 類：非互動模式 NEVER 等人輸入

- Level: `MUST`
- **D1** `[P0][S+]` 僅當 CLI 有任何互動行為（prompt、表單、分頁器、確認）：非互動的判定是：stdin 或 stdout 不是 TTY，或環境變數 `CI` 存在時，視為非互動。（cf：「no terminal, or when it detects a CI environment」）
- **D2** `[P0][S+]` 非互動時 NEVER 跳出 prompt 等待輸入。有預設值的 prompt 用預設值；沒有預設值的直接失敗（exit 非 0），並寫明要改帶哪個旗標。cf 原文：「Prompts without a default fail, so pass the value as an option instead」。（cf）
- **D3** `[P1][S+]` 僅當有 prompt：每個 prompt 都有對應的旗標或環境變數，可事先給值。互動表單只是填旗標的捷徑，cf 會把 API 需求「deconstructs … into a series of validated inputs」。（cf）
- **D4** `[P0][S+]` 沒被要求讀 stdin 的命令不讀 stdin。需要讀 stdin 時以 `-` 或 `--file -` 明示。stdin 接 `/dev/null` 時不能卡住。（clig）
- **D5** `[P2][S+]` 提供 `--no-input` 或等價旗標，強制進入非互動模式。（clig）
- **D6** `[P1][M+]` 長時間操作要能設逾時。收到 Ctrl-C／SIGTERM 時要結束，並說明已完成到哪裡。（clig）

## Good Example

- 這個例子是好的，因為非互動下缺值時立刻失敗並指名旗標，不會讓 CI 或 agent 卡到逾時。

````md
$ CI=1 mycli db create; echo "exit=$?"
error: missing required value "name" in non-interactive mode.
next: pass --name <name>.
exit=2
````

## Bad Example

- 這個例子是壞的，因為非互動下仍在等輸入，agent 只會看到命令逾時，不知道缺什麼。

````md
$ CI=1 mycli db create < /dev/null
? Database name: █        ← 永遠等不到輸入
````

# Rule 6 - E 類：破壞性操作要可預演、可確認、目標精確

- Level: `MUST`
- **E1** `[P0][S+]` 會刪除、覆寫或做不可逆變更的命令：
  - 互動模式預設要確認，`--force` 跳過確認。
  - 非互動且沒帶 `--force` 時，依 C6 拒絕並 exit 非 0。（cf：「always `--force`」）
- **E2** `[P1][S+]` 僅當命令會改變遠端狀態：提供預演（依 A3 選定的寫法：`--dry-run`，或預設預演並以 `--apply` 執行），以 JSON 印出將送出的請求或變更清單，但不送出。最好不需要憑證就能跑。cf 原文：「Add `--dry-run` to print the request as JSON without sending it」「Dry runs need no credentials」。（cf）
- **E3** `[P1][S+]` 冪等語意寫明：create 遇到已存在、delete 遇到不存在時的行為（回錯誤碼，或視為成功的 no-op）固定且寫進文件；需要時提供 `--if-not-exists`、`--ignore-missing` 這類旗標。agent 遇錯重試是常態，行為不固定就會重複建立或誤報失敗。（clig；cf 未公開冪等規則）
- **E4** `[P0][S+]` 破壞性操作的目標必須以 ID 或完整名稱精確指定。NEVER 對模糊匹配、前綴或萬用字元展開後直接執行；多目標操作先列出清單，再要求確認。
- **E5** `[P2][M+]` 破壞性操作完成後，以 JSON 輸出受影響的資源 ID，供 agent 驗證。

## Good Example

- 這個例子是好的，因為 agent 能先預演看清楚影響範圍，再用精確 ID 執行，最後拿到可驗證的結果。

````md
$ mycli db delete db_1 --dry-run
{"method":"DELETE","path":"/v1/databases/db_1"}
$ mycli db delete db_1 --force --json
{"deleted":["db_1"]}
````

## Bad Example

- 這個例子是壞的，因為前綴匹配直接展開刪除，沒有預演也沒有回傳實際刪了什麼。

````md
$ mycli db delete prod --force
Deleted 3 databases.
````

# Rule 7 - F 類：命令要能被 agent 自己找到，help 要能被機器讀

- Level: `MUST`
- **F1** `[P1][S+]` 每一層都支援 `-h` 與 `--help`：exit 0、輸出到 stdout，不執行任何動作，也不需要憑證或網路。
- **F2** `[P1][S+]` help 包含：
  - 一行用途。
  - 用法。
  - 旗標與預設值。
  - 至少一個可直接複製的範例。
  - 相關命令。

  子命令清單的格式固定，可被機器解析。
- **F3** `[P1][L]` 提供離線、不需憑證、以 JSON 回傳的命令搜尋入口，或機器可讀的命令樹輸出（例如 `<tool> commands --json`）。cf 的 `cf cli search "<task>"` 在本機執行，回傳最多五筆、最佳者在前的 JSON 陣列。（cf）
- **F4** `[P1][M+]` 根層與群組層 help 的第一屏，告訴 agent 怎麼找命令。cf 的根層與群組層 `--help` 開頭就提醒 agent 先用 `cf cli search`。（cf）
- **F5** `[P2][S+]` `--version` exit 0，輸出單行且可解析（例如 `mycli 1.2.3`），不需要網路。
- **F6** `[P2][M+]` 提供一句可放進 AGENTS.md／CLAUDE.md 的使用建議，寫明何時用這支 CLI、何時不用。cf 的建議句是「When interacting with Cloudflare, use the `cf` CLI unless the project has a Wrangler configuration file.」。（cf）
- **F7** `[P2][M+]` 提供 shell completion。（clig）

## Good Example

- 這個例子是好的，因為根 help 第一屏就給 agent 找命令的路，子命令清單格式固定，還附範例。

````md
$ mycli --help
Agents: run `mycli commands search "<task>"` to find the right command (JSON, offline).

Usage: mycli <resource> <verb> [flags]

Resources:
  db      Manage databases
  kv      Manage key-value namespaces

Examples:
  mycli db list --json
````

## Bad Example

- 這個例子是壞的，因為 `--help` 被當成未知旗標而報錯，agent 連命令清單都拿不到。

````md
$ mycli db --help; echo "exit=$?"
Error: unknown option --help
exit=1
````

# Rule 8 - G 類：認證與設定要能完全不靠人操作

- Level: `MUST`
- **G1** `[P0][S+]` 僅當 CLI 需要認證：非互動認證走環境變數 token（cf 用 `CLOUDFLARE_API_TOKEN`），NEVER 只支援瀏覽器登入。（cf）
- **G2** `[P1][S+]` 設定來源的優先序寫明且固定：旗標 > 環境變數 > 專案設定檔 > 使用者設定檔 > 預設值。cf 的 token 環境變數「Takes priority over any stored login」。（cf、clig）
- **G3** `[P0][S+]` 僅當同一身分可以存取多個帳號或環境：無法自動決定唯一目標時，非互動下失敗並列出候選與指定方式，NEVER 默默挑第一個。cf 的錯誤訊息：「More than one account available but unable to select one in non-interactive mode.」。（cf）
- **G4** `[P0][S+]` 僅當 CLI 經手 secret（token、密碼、金鑰）：secret 不出現在 stdout、stderr、log、`--dry-run` 輸出或錯誤訊息裡；CI 環境下可遮蔽帳號識別（cf 在 CI 會把帳號名稱換成 `(redacted)`）。用旗標傳 secret 會留在 shell history 與 process list，所以要另外提供環境變數或 `--token-file`。（cf）
- **G5** `[P2][S+]` 僅當 CLI 讀寫設定檔：設定檔位置遵循 XDG（`$XDG_CONFIG_HOME/<tool>/`），並可用環境變數覆寫。（clig）
- **G6** `[P2][S+]` 僅當有 telemetry：可用環境變數關閉，並尊重 `DO_NOT_TRACK=1`。cf 支援 `CF_SEND_TELEMETRY=false` 或 `DO_NOT_TRACK=1`。（cf）
- **G7** `[P2][L]` 專案設定檔附型別定義或 JSON Schema，讓 agent 與 LSP 能驗證。cf 改用 `cloudflare.config.ts` 提供型別資訊。（cf）

## Good Example

- 這個例子是好的，因為 agent 只靠環境變數就能認證、選定帳號，輸出中也沒有 secret。

````md
$ MYCLI_API_TOKEN=*** MYCLI_ACCOUNT_ID=acc_1 mycli db list --json 2>/dev/null
{"items":[],"next_cursor":null}
````

## Bad Example

- 這個例子是壞的，因為非互動環境沒有替代的認證方式，而且 debug 輸出洩漏了 token。

````md
$ CI=1 mycli db list
Opening browser to log in…
debug: Authorization: Bearer sk_live_9f…
````

# Rule 9 - H 類：一致性靠機械治理，不靠記得

- Level: `SHOULD`
- **H1** `[P1][L]` 命令面（命令、旗標、說明、範例）從單一 schema 產生，CLI、help、文件、completion、MCP 同源。cf 的命令「directly from the API schema that powers our API documentation and SDK generation」，由 Forge pipeline 生成。（cf）
- **H2** `[P1][M+]` A 類命名判準寫成可機械檢查的 lint，CI 每次變更都跑。cf 把規則「enforced at the schema layer」，Forge「lints every change」。M 規模可以只是一支掃描全部 `--help` 的測試，不一定要 schema。（cf）
- **H3** `[P2][L]` 手寫命令也走同一套 schema 與 lint。cf 的 `cf dev`、`cf build` 是手寫命令，疊在生成的命令之上。（cf）
- **H4** `[P1][M+]` 命令、旗標與 JSON 欄位的棄用政策：
  1. 先加入新名稱。
  2. 舊名稱照常可用，並在 stderr 印棄用警告。
  3. 保留期過後才移除。

  NEVER 靜默改名或移除。

## Good Example

- 這個例子是好的，因為命名規則變成 CI 會擋的測試，改名也走有警告的保留期。

````md
- test/cli-naming.test.ts：遍歷 `mycli <每個子命令> --help`，斷言動詞 ∈ {list,get,create,update,delete,…}、
  輸出類命令都有 --json、沒有 --format／--yes
- `mycli db info` 保留一個 minor 版本：仍可用，stderr 印 "deprecated: use `mycli db get`"
````

## Bad Example

- 這個例子是壞的，因為一致性只寫在 README，新命令照樣各取各的名字，舊名直接消失。

````md
- README：「請盡量使用一致的命名」
- v2.0：`db info` 直接改成 `db get`，舊名回 unknown command
````
