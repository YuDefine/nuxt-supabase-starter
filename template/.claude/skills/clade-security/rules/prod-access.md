---
description: agent 讀寫 production DB 的標準——讀走 `prod-sql read`（專用唯讀角色 agent_ro，免提示）；寫只有 update，走 `prod-sql plan --expect --source` → 沒有警訊的例行 plan 由 agent 自己 `apply`（DB 只授白名單表 UPDATE，人不逐筆核准；有警訊、新增或刪除改走 migration）；prod 寫入前要有經 PR 合入的異地備份宣告，以及回退三層、接入步驟與已知限制。觸發：要查 prod 資料當證據、要修 prod 資料、要讓 consumer 接入、判斷某個 prod 動作要不要人授權（§ 誰要同意）、或 prod-sql 回報拒絕
paths:
  [
    'scripts/prod-sql.ts',
    'vendor/scripts/prod-sql.ts',
    '.claude/prod-access.json',
    'supabase/migrations/**',
    '.mcp.json',
  ]
---
<!-- Clade native rule; source: rules/core/prod-access.md; edit canonical source -->

<!-- clade-targets: claude,agents -->

# Prod Access（agent 讀寫 production DB）

**每一個** consumer、**每一個** agent runtime 碰 production DB 都只走 `scripts/prod-sql.ts`（源檔 clade `vendor/scripts/prod-sql.ts`）。[[prod-mcp-safety]] 不變：prod MCP 的 `execute_sql`／`apply_migration` 只能 deny；結構變更（DDL）只走 migration 管線。

安全靠三件事，依可靠度排序：**DB 角色的權限**（agent 的角色寫不了白名單外的東西、對白名單表也只能 UPDATE、建不了任何物件）、**apply 時的資料比對**（受影響列與 plan 不同就整筆回滾）、**可回復性**（apply 前落檔原始列與表 dump、異地備份）。CLI 的檢查與本檔的禁令是防誤判的輔助，不是邊界。

## 誰要同意：授權分級（每一個 prod 動作開跑前 MUST 查這張表）

Charles 2026-10-19：「我希望絕大多數都不用我介入授權，如果真的需要的時候走一個統一的 Passkey」。授權來自下表的「授權來源」，**不**來自對話措辭。

| 動作 | 授權來源 | 人要做什麼 |
| --- | --- | --- |
| `read`、`check` | 無 | 無 |
| 例行 `plan` → `apply`、`rollback` | 白名單（設定檔經 PR 合入） | 無，事後看 ledger |
| `bootstrap --role agent_ro` | `.claude/prod-access.json` 已合入 origin 預設分支 | 無；不需要演練 |
| `bootstrap --role agent_rw` | 同上，且該 consumer 的 evidence 已有 § 接入 第 4 步的演練輸出 | 無 |
| DDL、新增／刪除資料列、有警訊的修正、批次 | migration 管線（PR 合入後由部署流程套用） | 照 PR 流程，不另授權 |
| 異地備份宣告 | § 異地備份宣告 的拍板 | 每個 consumer 拍板一次 |
| 上面沒列到、會寫 prod 或改 prod 權限的動作：直接跑 superuser 路徑（`admin_psql`、ssh 進 prod 主機）、在部署流程外對 prod 跑 migration runner／修補腳本的 `--execute`、`agent_ro`／`agent_rw` 以外的角色或權限變更、prod 的 DB 設定與 extension | **真人驗證** | 每一次各驗一次 |

- 「你應該可以自己查」「你處理」這類話**不擴大也不縮小**上表：表上「無」的直接做、不必再問；表上「真人驗證」的，口語怎麼說都不算授權
- **真人驗證只有 Passkey 一條路**（放行頁：`specs/plans/W-2026-10-12-prod-access-standard/evidence/2026-10-14-prod-admin-passkey-gate.md` 方案 B）。放行頁上線前的過渡：送 Charles 一張 flow 決策卡（`herdr-session-handoff.ts --complete blocked --decision-for charles`，主線用 `flow ask`），題目寫明主機、指令、寫入類別與筆數，以卡上的回答為準。**NEVER** 用對話裡的回覆代替那張卡
- **未接入的 consumer 要讀 prod：沒有一次性查詢路**。照 § 接入 開設定檔 PR → 合入後 `bootstrap --role agent_ro` → `read`。**NEVER** 用 ssh、`admin_psql`、MCP 或 `.env` 的連線字串「先查一次」頂著

## 讀 prod：`prod-sql read`

需要 prod 資料當證據（調查 bug、確認 schema、量測現況）時：

```bash
node scripts/prod-sql.ts read --sql '<一句 SELECT>' [--limit N]
```

- 以 `agent_ro` 連線，唯讀交易、15 秒逾時；預設回 200 列、上限 2000。**免提示**，不必問使用者
- 要總數就查 `count(*)`；**NEVER** 靠調高 `--limit` 撈全表，也 **NEVER** 用迴圈分頁把表搬回來（bulk 匯出走 `rules/modules/db-runtime/supabase-self-hosted/database.md` 的 seed 流程）
- 查到的個資、憑證欄位 **NEVER** 貼進 commit、PR、issue 或落盤文件；對話裡只引用回答問題所需的最少欄位

| `prod-sql` 回報 | 意思與下一步 |
| --- | --- |
| exit 3 `沒有憑證檔` | 本 consumer 尚未接入 → § 接入 |
| exit 3 `不在 tailnet 範圍` | 連線字串指向非 Tailscale 位址；修 `.claude/prod-access.json` 的 `connect.host` 後重跑 bootstrap |
| exit 3 `指向演練目標`／`指向prod目標` | 憑證檔放錯位置（主目錄只放 prod 的、`drill/` 只放演練的）。**NEVER** 使用那個檔；回報使用者，照 § 接入重跑對應目標的 bootstrap |
| exit 4 `prod-sql preflight` | 角色權限已不符標準（多了寫入或 CREATE 權限）。SQL 沒有執行；把輸出原文回報使用者並重跑 § 接入 的 bootstrap。**NEVER** 換別的憑證或改走 ssh／MCP 繞過 |
| exit 5 | 查詢本身的錯；讀錯誤、改 SQL |

## 改 prod 資料：例行 plan → agent 自己 apply

適用：修正白名單表裡既有資料列的欄位值（只有 `update`），單次 ≤ 500 列。**不適用**（改走 migration 管線，同一 commit 同步 seed）：新增或刪除資料列、任何 DDL、沒有 primary key 的表、目標表超過 100 MB、需要跨表一致的批次、以及 plan 標出警訊的修正。

沒有人逐筆核准（Charles 2026-10-14：逐筆密碼核准只會變成蓋章，撤掉）。擋住錯誤寫入的是 DB 權限、apply 時的資料比對與可回復性；人看的是白名單（設定檔經 PR 合入）與事後的 ledger。

```bash
node scripts/prod-sql.ts plan --op update --table <schema.table> --where '<條件>' --set '<指派>' \
  --expect <你預期改到幾列> --source '<請求來源：票號、訊息原文>' --reason '<為什麼>'
node scripts/prod-sql.ts apply <plan-id>
```

1. **先查證再 plan**：用 `read` 確認條件撈到的就是要改的列、沒有漏掉相依資料，算出 `--expect`。`--source` 寫這次修正的來源（Notion 票、客戶訊息原文、使用者的話），不是自己的推測
2. **plan**：以 `agent_rw` 在交易內實際執行後 ROLLBACK，回報受影響列、變更前後樣本、表上的 trigger。命中列數 ≠ `--expect` 就不產生 plan——**NEVER** 改 `--expect` 去湊，回頭查條件。`--where`／`--set` 不收帶括號的函式呼叫（只放行 `now`、`lower`、`upper`、`trim`、`length`、`abs`、`round`、`coalesce`、`nullif`、`greatest`、`least`）：要用其他函式算出的值，先 `read` 算好再寫成常值
3. **看警訊**：plan 標出警訊（超過 50 列、目標表有會寫到別處的 trigger）時 `apply` 一律拒絕。照輸出改走 migration 管線，或縮小條件後重新 plan
4. **apply**：沒有警訊的 plan 由 agent 自己 `apply`。它先落檔受影響列的原始內容與目標表 `pg_dump`，再在單一交易內鎖列、比對內容與 plan 完全相同、執行、比對列數，全部相符才 COMMIT；prod 另驗異地備份宣告（下節）與每日上限（10 次、200 列）
5. **驗證並回報**：用 `read` 驗一次結果，回報使用者 apply id、表、列數與來源

**Iron Law：NO PROD WRITE EXCEPT `prod-sql apply` OF A ROUTINE PLAN。違反字面就是違反精神。**

| 情境 | 該怎麼做 |
| --- | --- |
| plan 有警訊，但「這次確定沒問題」 | 改走 migration 管線。**NEVER** 改 plan 檔拿掉警訊（hash 會不符）、**NEVER** 拆成多張小 plan 繞過列數警訊 |
| 撞到每日上限 | 這是批次修正，改走 migration。**NEVER** 改 ledger 或等隔天分批硬做 |
| 要新增或刪除資料列 | migration 管線。`agent_rw` 在 DB 沒有 INSERT／DELETE 權限 |
| 白名單不夠用 | 在設定檔加表、開 PR；合入後重跑 `bootstrap --role agent_rw`。只改工作樹的設定檔不會生效 |
| plan 過期（60 分鐘）、apply 失敗過、資料變了 | 重新 plan |

演練目標全程加 `--drill`（plan、apply、rollback、bootstrap 都一樣），憑證只從 `drill/` 讀。

- **NEVER** 把演練的輸出當成 prod 的結果回報：`plan` 與 `APPLIED` 的目標行都標了 `（prod）` 或 `（演練）`，照標示說
- **NEVER** 繞過 `prod-sql` 寫 prod：包含 ssh 進主機 `docker exec psql`、借用 `.env` 或主機上的高權限連線字串、prod MCP、Studio、手動對 prod 跑 `drizzle-kit push`／`migrate`／`studio` 與任何拿 prod 連線字串的 ORM CLI 或 DB GUI。你**拿得到**這些路徑不等於可以用；本標準的每一道檢查都只存在於 `prod-sql` 這條路上
- drizzle 的 CLI（含 `pull`、`studio`）只對 dev／本機 DB 跑，prod 的 schema 只由部署流程套用；哪些 `drizzle-kit` 子命令可用、schema 的 SoT 在哪，照 [[auth-data-path-consistency]] § 資料存取層選型（Supabase）與 [[data-layer-d1]]（D1）。**NEVER** 把 prod 連線字串放進 drizzle 設定或它讀的 `.env`
- prod Supabase MCP 不是 prod 操作路徑：要讀就 `read`（有逾時、列數上限與唯讀角色）。新 consumer **NEVER** 加 prod MCP 連線；既有的連線在移除前照 [[prod-mcp-safety]] 封鎖。dev MCP 不受影響
- `apply` 回 `結果不明` 時 **NEVER** 重跑：先用 `read` 比對目標列與 `before.json`，把比對結果回報使用者

## 異地備份宣告（prod 寫入的前提）

prod 的資料異動在 `apply` 時要有一份**沒過期的異地備份宣告**；沒有就 exit 8、不寫入、plan 不被消耗。`rollback` 產生的逆向 plan 不受限（出事時要能撤銷），bootstrap 也不受限。

宣告寫在 consumer 的 `.claude/prod-access.json` 的 `backup` 區段（欄位見 `vendor/snippets/prod-access/README.md` § 設定檔），**經 PR 合入**才算：prod 的設定一律讀 origin 預設分支那份。流程（Charles 2026-10-14，span `f5e4f6a34f8616e1`）：agent 盤點 → `flow ask` 請 Charles 對盤點結果拍板 → 拍板後 agent 寫 `backup` 區段（`decision` 填那筆拍板的 span）並開 PR → 0-A 審過即合，不限 Charles 本人合入。三件事都屬實才寫：

1. 有一份**不在 prod 主機上**的備份副本（`offsite_location`）
2. **agent 平常的身分刪改不了那份副本**（`agent_cannot_alter` 寫明為什麼）。副本放在 agent 有 SSH 或寫入權的機器——包含 agent 自己這台——不算：一次誤操作會同時毀掉資料庫與備份
3. 實際從那份副本**還原成功過**（`last_restore_drill`），證據放 `evidence` 指的檔

`attested_at` 起 90 天有效；還原演練超過 365 天就不收，要重新演練。每個 consumer 各寫各的。

- CLI 連不到備份主機，驗的是「宣告存在、`decision` 形狀對、沒過期」，不是備份本身。三件事 MUST 都屬實才寫；PR 的審查要對照 `evidence` 與 `decision` 指的那筆拍板。**NEVER** 在任何一件不成立、或 Charles 還沒拍板時先寫宣告
- Charles 接受這個做法的條件是回退與還原措施到位：還原演練 MUST 有 `evidence` 可查；宣告有誤（副本其實不在、演練沒成功）時 revert 那張 PR——origin 上的 `backup` 一消失，prod 的 `apply` 隨即 exit 8，已做的寫入照 § 回退 撤銷
- exit 8 → 把訊息原文回報使用者；備份或演練不到位時，要做的是補備份，不是找替代寫入路徑

## 回退

| 層 | 機制 | 何時用 |
| --- | --- | --- |
| 交易 | apply 的每一項檢查不符就 RAISE，整筆回滾，不留半套 | 自動 |
| 列 | `node scripts/prod-sql.ts rollback <apply-id> --reason '…'` 從 `before.json` 產生逆向 plan（把欄位還原），agent 再 `apply`；目標沿用該次 apply 的（演練的回滾加 `--drill`）。回滾不受警訊、每日上限與備份宣告限制 | 改錯了、改多了 |
| 表 | 每次 apply 前的目標表 `pg_dump`（`applies/<apply-id>/dump.sql`，在 agent 機器上、不在 prod 主機） | 逆向 plan 還原不了（trigger 連帶改了別的列、列在 apply 後又被改過且要逐欄比對） |
| 庫 | prod 主機自己的備份（PITR／WAL 封存／定期 dump），MUST 有一份 agent 刪改不了的異地副本並演練過還原 | 表級以上的災難。**現況由各 consumer 接入時盤點並記錄**；沒有異地副本或沒演練過，就寫不出備份宣告，prod 寫入不開放 |

`rollback` 的 plan 若警告「這些列在 apply 之後又被改過」，回滾會蓋掉那些後續變更——apply 前把警告原文回報使用者。

事故處置（發現誤改時怎麼停、怎麼評估、怎麼回退）：clade `vendor/snippets/prod-access/README.md` § 事故 runbook。

## 接入（每個 consumer 一次）

1. 在 consumer 根建 `.claude/prod-access.json`（欄位見 `vendor/snippets/prod-access/README.md` § 設定檔）：superuser 進 DB 的指令、agent 連線位址、`read_schemas`、`write_tables` 白名單、演練目標的 `drill` 區段。**NEVER** 列 `auth`、`storage`、`vault` 等平台 schema（CLI 會拒絕）。開 PR 合入——prod 的 bootstrap 只讀 origin 預設分支那份
2. 第 1 步合入後，agent 自己跑 `node scripts/prod-sql.ts bootstrap --role agent_ro`，不必等人授權（§ 誰要同意）；`agent_rw` 要等第 4 步演練完才跑（白名單為空就不建）。bootstrap 先 `git fetch`、以合入的設定檔執行 superuser 路徑，在單一交易內建角色、授權，並以該角色身分實際嘗試建表、改白名單外的表、對白名單表新增或刪除——任何一個成功就整筆回滾；成功後寫入憑證並跑一次 `check`
3. `node scripts/prod-sql.ts check --role agent_ro` 回 `OK`；它列出的「可執行的 SECURITY DEFINER 函式」逐一判斷，會寫資料的收回 PUBLIC 執行權（走 migration）。`agent_rw` 更嚴：平台 schema 以外、它可執行的 SECURITY DEFINER 函式，以及白名單表上函式為 SECURITY DEFINER 的 trigger，有一個 `check`／`plan`／`apply` 就 exit 4——`REVOKE EXECUTE ON FUNCTION … FROM PUBLIC`（需要的角色另行 GRANT）、trigger 函式改 SECURITY INVOKER，或把那張表移出白名單
4. 在 **dev 或臨時還原環境**（loopback）實跑一次「plan → apply → rollback → apply」並各試一次警訊被拒（全程加 `--drill`；演練目標的 superuser 指令與連線位址填在設定檔的 `drill` 區段。**NEVER** 為了演練去改頂層的 `connect.host`：`admin_psql` 還指著 prod 時，那次「演練」bootstrap 會重設 prod 的角色密碼），把輸出留在該 consumer 的 evidence；沒有演練紀錄的 consumer **NEVER** 對 prod 跑 `bootstrap --role agent_rw` 或 `apply`。只讀的接入（`agent_ro`）不需要演練
5. 盤點庫級備份（README § 庫級備份盤點）。有 agent 刪改不了的異地副本且演練過還原 → 在設定檔寫 `backup` 宣告並開 PR；沒有 → 回報使用者，prod 寫入在補齊前不開放（讀不受影響）
6. `.claude/settings.json`、`.mcp.json` 對齊 `vendor/snippets/prod-access/README.md` § consumer 設定基準：`permissions.allow` 加 `Bash(node scripts/prod-sql.ts read:*)`、`Bash(node scripts/prod-sql.ts check:*)`；`plan`／`apply`／`rollback`／`bootstrap` **NEVER** 放進 `allow`，整個 `Bash(node:*)` 與 `Bash(psql:*)` 也不放

憑證由 bootstrap 產生並存到 `~/.config/clade/prod-access/<consumer_id>/<role>.url`（600）；演練目標的兩個角色存 `drill/<role>.url`。**NEVER** 把它複製進 repo、`.env`、對話或文件；**NEVER** 在那個目錄放其他角色的連線字串。舊版留下的 `keyring.sealed.json` 不再使用，可以刪掉；**NEVER** 嘗試解開它。

## 已知限制

撤掉逐筆核准之後，真正的邊界只剩 **DB 權限**（`agent_rw` 只拿得到白名單表的 UPDATE）。下列殘餘是 Charles 接受撤掉密碼時一併接受的取捨（決策 span `94323a836c62a272`）：

- **`agent_rw` 以明文存放**：任何能讀主目錄的行程（含其他 session、被 prompt injection 的 agent）都能在白名單範圍內寫 prod
- **腳本層的檢查都是護欄**：警訊、每日上限、`--expect`、ledger、plan 的 hash——agent 與 CLI 同一個 OS 帳號，改得到 `scripts/prod-sql.ts` 與狀態檔。plan 的 hash 沒有 key：改了 plan 檔（拿掉警訊、延長期限）再重算 hash 就過得了 hash 比對；偽造 `applies/<id>/record.json` 與 `before.json` 能讓任意 plan 被當成回滾，跳過警訊、每日上限與備份宣告；改 ledger 能重設每日上限。apply 會重驗 plan 裡進 SQL 的欄位（表名、`--where`／`--set` 與 plan 時同一套檢查）並在 DB 重查目標表的 write trigger，所以偽造擋不到的只剩這幾道護欄，越不過 DB 權限
- **例行 UPDATE 沒有人逐筆看過**：值改錯但列數對的語意錯誤，只能事後靠 ledger、使用者回報與 `rollback` 發現
- **`--source` 是 agent 自述**，不驗證
- **「讀 origin 那份設定」靠預設分支的保護、PR 審查與本機的 registry**：CLI 不讀本機的 remote-tracking ref 與 `origin/HEAD`（`git update-ref`／`symbolic-ref` 改得到），而是先比對 origin URL 與 clade `registry/consumers.json` 登記的 `repo_id`（會套到 origin 的 `url.*.insteadOf` 改寫一律拒絕），再以 `git ls-remote` 問 GitHub 預設分支的 sha、fetch 後只讀那個 sha。殘餘：預設分支允許 agent 直接 push 時，白名單擴張與備份宣告就不經審查；clade 中央倉（或 `CLADE_HOME` 指的位置）在同一台機器、同一個 OS 帳號改得到 registry；git 的憑證與 SSH 設定（例如 `~/.ssh/config` 把 github.com 指到別台）也在同一個帳號手上。這一道擋的是本機 ref 被改、remote 被換，不擋刻意改 registry 或 SSH 設定
- **異地備份宣告是自我申報**：CLI 不驗備份存在、不驗還原得回來
- **送鍵入偽造**仍然存在（harness 把送進終端的字記成使用者打的）；現在沒有任何閘依賴人在對話裡的回覆，這一點是刻意接受
- **superuser 路徑本身不受保護**：`admin_psql`（典型是 ssh root 進 prod 主機）agent 拿得到就跑得動。本標準只讓 `prod-sql` 的 bootstrap 走它；直接跑那條路由上面的 **NEVER** 繞過與 prod 主機的 SSH 存取控制處理。備份與 PGDATA 同機時，這條路也碰得到備份——異地備份宣告要求的就是一份這條路碰不到的副本
- **psql 執行期間**，密碼以已刪除的 passfile 經 fd 傳給 psql／pg_dump（不在環境變數與 argv），同帳號行程仍讀得到 `/proc/<pid>/fd`
- **`default_transaction_read_only` 只是預設值**，session 自己能關掉。擋寫入的是 `agent_ro` 沒有任何寫入權限，不是這個設定
- **函式預設 PUBLIC 可執行**：prod 若有會寫資料的 `SECURITY DEFINER` 函式，`agent_ro` 用 `SELECT 函式()` 就可能寫到資料。`prod-sql read` 的唯讀交易會擋下，但那是預設值層級的保護；根治是收回該函式的 PUBLIC 執行權（接入第 3 步）
- **`agent_rw` 的寫入交易沒有唯讀保護**：SECURITY DEFINER 函式在寫入交易裡以 owner 權限執行，能寫白名單外的表；plan 雖然 ROLLBACK，pg_net／dblink 這類非交易副作用照樣送出，apply 則會 COMMIT。所以 `agent_rw` 的 preflight 遇到可執行的 SECURITY DEFINER 函式、或白名單表上的 SECURITY DEFINER trigger 就拒絕（接入第 3 步），片段也不收帶括號的函式呼叫。PostgreSQL 的屬性寫法（`t.fn`、`(t).fn` 等於 `fn(t)`）不帶括號，片段檢查擋不住：SECURITY DEFINER 函式照樣被 preflight 擋下，SECURITY INVOKER 函式的非交易副作用是殘餘。殘餘：平台與 PostgreSQL 內建 schema（`pg_*`、`information_schema`、`auth`、`storage`、`vault`、`realtime`、`_realtime`、`supabase_functions`、`supabase_migrations`、`pgsodium`、`pgsodium_masks`、`net`、`cron`、`graphql`、`graphql_public`、`extensions`、`pgbouncer`、`_analytics`）的 SECURITY DEFINER 函式不檢查——它們不是 consumer 寫的，`agent_rw` 也沒有那些 schema 的 USAGE 時本來就叫不到；一般（SECURITY INVOKER）trigger 以 `agent_rw` 的權限執行，寫不出白名單，但非交易副作用（trigger 呼叫 pg_net）同樣撤不回，靠下兩條的 write trigger 警訊
- **trigger 對其他表的效果不在快照內**，`rollback` 不會還原；「會寫到別處的 trigger」是以函式本體的字面判斷的啟發式警訊，抓不到經由其他函式間接寫入的情形
- **外鍵的參照動作不算 trigger 警訊**：UPDATE 一個被別表以 `ON UPDATE CASCADE／SET NULL／SET DEFAULT` 參照的欄位，會以表 owner 的權限改子表；那些寫入沒有警訊、不在快照內，`SET NULL`／`SET DEFAULT` 的回滾還原不了。白名單表若被這樣參照，plan 前自己查 `pg_constraint`（`confupdtype <> 'a'`），改那些欄位走 migration
- **plan 的試跑在 prod 上真的執行過再 ROLLBACK**：期間鎖住受影響列（最多 30 秒），非交易性的副作用（例如 trigger 呼叫外部服務）不會被撤回；已知有「會寫到別處」警訊的表在試跑前就拒絕，所以只有啟發式漏掉的 trigger 會在 prod 跑到
- **loopback 不代表不是 prod**：`--drill` 以「host 解析到 loopback」認定演練目標，但 `ssh -L` 把 prod 轉到本機埠、或把 prod 的 socket 掛到本機，看起來都是 loopback。演練的 `admin_psql` 因此只收本機的 `psql …` 或 `docker exec … psql …`，拒絕 shell 與遠端包裝、`-h`／`--host`、連線字串與 `PGHOST` 類環境變數，執行時也拿掉環境裡的 `PG*` 與 `DOCKER_HOST`；這擋的是設定寫錯，擋不住刻意的轉發。演練的 `bootstrap` 用工作樹的白名單、`apply --drill` 不驗備份宣告——**NEVER** 為了演練去轉發 prod
- **Studio 的 `/api/mcp` 未驗證**時，能連到該埠的行程都能呼叫 `execute_sql`，不受本標準約束。處置見 `vendor/snippets/prod-access/README.md` § Studio 暴露面（建議項，非接入前置）

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `scripts/audit-tooling-drift.ts` 的 `prodAccess`：manifest `db-runtime` 是 `supabase-self-hosted`、有 prod Supabase MCP 連線或有設定檔的 consumer 缺憑證、憑證檔權限或角色不對、角色檢查 receipt 缺席／過期／不符、`allow` 放行了寫入子命令，或偏離 README § consumer 設定基準（`prod-mcp-present`、`broad-allow`、`dev-apply-migration-allowed`）→ drift（各 status 見該 script 檔頭） |
| 消費端 | 跑 `clade-health` 的 session 與該 consumer 的主線：照 § 接入 補齊，或把 `allow` 裡的寫入子命令拿掉 |
| 觸發點 | 本檔由 `paths:` 與 work-route `rules/production證據判準.md`載入；`prod-sql` 的每一種拒絕輸出都指回本檔對應段 |
