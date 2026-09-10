
# 0-S Codex Security — 放行條件與額度配置

`gates.md` § **0-S.3** 的延伸檔。準備 `baseline` 或 `path` 掃描、或判讀掃描失敗時讀取。

**本檔不服務 pre-commit。** commit 路徑上的安全 gate 是 0-S.1（`security-precommit.ts`）
與 0-S.2（`/security-review`），兩者都不經過本檔描述的任何模式。
退出碼與 `failure_class` 維持既有放行契約；`failure_reason` 與 `failure_phase` 提供診斷，沒有新增自動放行路徑。

## 掃描模型

wrapper 固定預設模型為 `gpt-5.6-sol`，每次呼叫 scanner 都明確傳入模型；
差異掃描與 `baseline` 都使用 `xhigh`。顯式 `--model`／`--effort` 可覆寫，
空白模型會在啟動 scanner 前被拒絕；新 ledger 記錄本次指定模型，舊 row 的 null 保留為未知。
這裡的模型是 Codex Security 的安全分析模型，與負責執行命令的代理模型分開。

官方 CLI quickstart 的預設組合是 `gpt-5.6-sol + xhigh`，plugin quickstart 也推薦此組合以取得最佳掃描品質。
Clade 的模型與推理強度預設採同一組合。來源：
[CLI 模型與推理強度](https://learn.chatgpt.com/docs/security/cli#choose-a-model-and-reasoning-effort)、
[plugin 品質建議](https://learn.chatgpt.com/docs/security/plugin#run-your-first-scan)。

## Scanner 登入位置

wrapper 固定使用 `${XDG_DATA_HOME:-$HOME/.local/share}/clade/codex-security-state`，
與未指定 state directory 的裸 CLI 登入分開。修復 `auth-failure` 時使用相同位置與已安裝版本：

```bash
security_data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
CODEX_SECURITY_STATE_DIR="$security_data_home/clade/codex-security-state" \
  "$security_data_home/clade/codex-security/0.1.25/node_modules/.bin/codex-security" login --device-auth
```

同一命令的尾端換成 `login status` 可讀取登入狀態；顯示已登入只代表有儲存的憑證，
refresh 是否成功仍以新一次真實掃描為準。直接執行未帶 state directory 的 `npx … login`
不會修復 wrapper 使用的那份登入；不複製憑證檔或改用 API key。

## 工具故障放行（僅 `tool-failure-no-artifacts` / `tool-timeout`）

先依實際 `(exit, failure_class)` 分流；只有 `(2, tool-failure-no-artifacts)` 或 `(2, tool-timeout)` 進入本節。

**`(2, stop-line-refused)` NEVER 進入本節。** 它代表停止線低於本 target 同一範圍已實測不足的
水位，wrapper 在啟動掃描**之前**就拒絕了（`failure_reason: stop-line-below-observed-floor`、
`failure_phase: wrapper-preflight`），一次 scanner 都沒跑、零花費。處置照下方停止線那一節：
提高 `--max-cost` 到建議值以上重跑，或縮小範圍。**NEVER** 對它請求未掃描放行——沒有工具故障，
只有一個已知不夠的預算。（本值列在這裡是因為未列名的 `failure_class` 會落到「保留原始輸出並
調查工具契約」，而它不是工具契約問題。）

**`(2, scope-abort)` NEVER 進入本節。** 它代表 watchdog 在第一個分母行判定範圍沒收斂並中止了掃描
（stderr 有 `[security-scan] scope abort:` 那行）——處置是**修範圍**：改用
`path --path <relative>`，或縮小批次讓 scanner 推導得出來。**NEVER** 對它請求未掃描放行，
也 **NEVER** 提高 `--max-cost` 重試：那趟本來就不會在任何預算內跑完。缺欄、未列名或互相矛盾時保留原始輸出並調查工具契約，不提供未掃描放行。修復後以新一次實跑結果重新判定。

未掃描放行是人的決定。使用當前 runtime 可用的提問介面；沒有工具就在對話提問並等待本批明確回答，**NEVER** 自行決定放行：

- **`[1] 停下修工具`**（推薦）：依 [runtime-lifecycle.md](runtime-lifecycle.md) 收回背景工作並釋放自己的 commit-lock，回報 failure_class、failure_reason、failure_phase、output_dir，本批不 commit。
- **`[2] 授權未掃描落地`**：user 明確承擔風險。放行時 **MUST 同時**做到兩件事，缺一不可：
  1. `HANDOFF.md` 追加 `0-S UNSCANNED` 條目：日期、failure_class、診斷原因、output_dir，以及本批命中 Tier 3 的**每一個 path**。
  2. 本批**每一個** commit message 帶 trailer `Security-Scan: unscanned (<failure_class>)`。

HANDOFF 承載補掃範圍；commit trailer 承載歷史 parent/head 的對帳入口。

- **NEVER** 把 `[2]` 讀成掃過；完成報告寫 `0-S 未執行（<failure_class>）`。
- **NEVER** 把使用者沒有回應讀成 `[2]`，不得沿用另一批的工具故障授權；本批相同 paths／failure 的既有明確授權仍有效，範圍或故障狀態改變須取得對應授權。
- **NEVER** 對 `coverage-incomplete` 使用這條放行路徑；部分掃描仍未完成。

## 先檢查輸入，再執行有停止線的掃描

| 入口 | 做什麼 | 能證明什麼 |
| --- | --- | --- |
| 原子命令加 `--dry-run` | wrapper invocation preview | 參數將如何傳遞；沒有 scanner 結果 |
| `preflight` | 官方 `scan --dry-run` 本機 input check | 輸入是否合法；沒有認證、配額或 coverage 證據 |
| 真實 `working-tree` / `diff` / `baseline` | 啟動 scanner，可能消耗 ChatGPT 配額 | 由 canonical artifacts 與 coverage 判定完成度 |

`preflight` 的本機 input check 與真實掃描進度中的 preflight phase 是兩件事。
Files 進度分母隨 scanner 版本、模式與範圍改變；單次分母不能推導整個 repo 的固定成本地板。

每次真實掃描都指定 `--max-cost <本次停止線>`。這是模型成本**估算停止線**，在途請求可能超出；
它不是實際扣款、完成報價或訂閱剩餘量。選值依同一 repo、模式、版本與範圍的既有結果，
缺少成功樣本時先給明確的診斷停止線；失敗後保留結果再評估，**NEVER** 用不限額掃描量地板。

**停止線的地板由 ledger 機械決定，不靠記憶猜。** wrapper 在啟動 scanner 之前先讀 target 自家
ledger，取同 `run_kind` / model / effort / scanner 版本裡**每一筆撞上停止線或被計時器砍掉**的
`estimated_cost_usd` 最大值當已知不足水位；`--max-cost` 低於或等於它就 fail closed
（exit 2、`failure_reason: stop-line-below-observed-floor`、`failure_phase: wrapper-preflight`），
一次 scanner 都不啟動，訊息裡帶建議值。**NEVER** 用「這次應該就夠了」把同一面牆再撞一次——
<consumer-a> 2026-09-07 一晚 $2 → $8 → $15 三次猜測、每次都低於當時 ledger 已記錄的水位，燒掉 $22.4
換到零 findings 與零 coverage。

**比對鍵是範圍，不是模式。** `run_kind` 只固定住模式；`working-tree --paths-file`、`path`、
components / deep baseline 的實際掃描範圍逐次不同。clade 自家
ledger 的五筆 working-tree row 範圍分別是 39 / 40 / 95 / 95 個檔與 7 個檔，其中 39 檔那批以
$12.09 撞上停止線——只比對 `run_kind` 的話，之後每一次 ≤$12.09 的 `working-tree` 掃描都會被那筆擋掉，
含只有一個檔的批次。（**NEVER** 寫成「0-S 掃描」——0-S.1／0-S.2 都不經過本檔，見本檔開頭。）所以 wrapper 另外比對 row 記下的範圍（`snapshot_paths` / `paths` /
`diff_base`+`diff_head` / `scan_strategy`+`scan_mode`），範圍不同的紀錄不構成地板。

**`working-tree` 的 `snapshot_paths` 是「同一份請求清單」，不是「同一個掃描範圍」**：那個清單只
用來建私有快照，傳給 scanner 的參數只有 `--working-tree`，實際分母由 scanner 自己去 diff 那個快照
推導（見 `gates.md` § 0-S.3）。同一份清單在不同日期的快照內容不同，分母可能收斂到完全不同的數字——
clade ledger 兩筆同為 95 檔清單的 timeout 分別花 $11.55 / $9.07，而 40 檔那筆 $24.58 反而跑完。
所以對這個模式，「已實測不足」是**啟發式**而非證明；行為仍 fail-closed（同清單擋、不同清單放），
但 **NEVER** 把它讀成「這個範圍被證明過不夠」。`path` 模式沒有這個落差——它的 `paths` 就是傳給
scanner 的那組。

`diff` 是唯一沒有地板的模式：它的 row 記的是解析後的 SHA，而地板判定跑在 snapshot 建立**之前**，
拿不到同一個值。**NEVER** 為了讓它「也有保護」而拿 raw ref 去對 SHA 湊一個看起來會過的鍵——
證不出範圍相同就不主張地板，也 **NEVER** 把 `diff` 沒被擋下讀成「這個預算夠」。

`--timeout-sec` 的職責是**抓住掛死的 scanner**，不是限制花費——花費由 `--max-cost` 管。沒給時
wrapper 由**實際生效的**預算推導（180 s/$，下限 900s），因此**提高停止線會自動放大 timeout**；
顯式給值則完全覆寫。「實際生效」是字面意思：`hook` 在沒有 paths file 也沒有 `--max-cost` 時
根本不傳 `--max-cost` 給 scanner（量地板用），那一次拿 900s 下限並記
`timeout_source: 'wrapper-minimum'`。**NEVER** 拿 wrapper 預設值推導、也 **NEVER** 把那一次記成
`derived-from-budget`——它會與同一列的 `max_cost_source: 'unset'` 互相矛盾，讀的人分不出
「900s 是下限」還是「900s 是某個預算算出來的」。顯式給一個花不完預算的值時，掃描會被計時器而不是預算結束，那一次的結果讀起來與
「scanner 在這個 repo 規模下跑不完」逐字相同。

| failure_reason | 當次處置 |
| --- | --- |
| `quota-exhausted` | 停止該帳號的後續掃描；保留額度訊息與重設時間原文，不提高美元停止線重試。額度耗盡是**帳號層**狀態，換模式、換 repo、換停止線都不會繞過它（2026-09-07 實測：`You've hit your usage limit… try again at Sep 13th`，六天不可用）|
| `auth-failure` | 修復既有認證；不自動切 API 計費或購買 credits |
| `output-dir-not-empty` | 使用新的私有 output directory；不刪既有證據 |
| `cost-limit-reached` | 記錄已完成單位、模型估算成本與剩餘範圍，再決定新一輪停止線 |
| `timeout-before-budget` | 計時器在預算用掉 80% 之前結束了掃描：**這不是** scanner 走不下去的證據。放大 `--timeout-sec`（或改讓它由預算推導）後重跑，**NEVER** 據此宣稱 scanner 在本 repo 不可用 |
| `timeout` | 掃描已接近或用盡預算才被計時器結束；比照 `cost-limit-reached` 重新評估停止線 |
| `stop-line-below-observed-floor` | 停止線低於本 target 同一掃描範圍已實測不足的水位，未啟動掃描、零花費。依訊息給的建議值提高 `--max-cost` 後重跑 |
| `scope-abort` | watchdog 判定分母 > 請求檔數並中止。改用 `path` 模式或縮小批次，**NEVER** 提高停止線重試 |
| 其他或 `unknown` | 依 failure_phase、stderr 與 artifacts 查證；不從缺產物推定成本原因 |

scanner stderr 在 `<output_dir>.stderr.log`，與 output directory 同層；scanner 起跑前 output directory 保持空白。
`--workflow-id` 的續跑相容性依固定 scanner 版本契約判定，不承諾不同 scope、base/head 或安全上下文可重用。

## 提交內容與歷史覆蓋

**啟動任何真掃描之前 MUST 先確認範圍會收斂。** scanner 在第一秒就印出分母
（`[00:01] Scan phase: preflight (0/<M> files)`，首次成本計量在 `[00:18]` 之後），
`<M>` 不等於你請求的檔數就 **MUST 立刻中止**，不要等 `--max-cost` 把錢燒完才停——
它停得住花費，停不住那趟已經注定跑不完的作業。

`path --path <relative>` 是唯一把範圍交給呼叫端的模式（直接傳 `--path`，不建快照）。
2026-09-07 實跑分母 `0/2`，等於請求檔數。

`working-tree --paths-file <批次清單>` 的範圍由 scanner 自己推導：固定 HEAD 後在私有 Git
快照加入選定內容，原 repo index、WIP 與未追蹤檔保持原樣，清單是一行一個 repo-relative 檔案；rename 列出兩端。
同一檔混有其他工作的變更時，使用精確 patch 選定本批 hunks；**NEVER** 擅自把整檔納入本批。
掃描後、commit 前重新比對批次內容；內容變了即重掃，不能把舊快照結果套到新內容。

歷史補掃使用 `diff --base <parent> --head <commit>`。wrapper 解析完整 SHA，再於固定 head 的
私有快照執行。每個未掃 commit 保留 parent/head；只有 diff 與安全上下文完全相同才可去重。
當前 baseline 不覆蓋已被後續 commit 覆寫的歷史內容。

ledger 記錄兩端 SHA、snapshot digest、scanner 版本及 `security_md_sha`，成本值附來源；
缺成本資料以 null / unknown 表示，不寫成零或實際扣款。舊 row 缺新增欄位時視為未知。
成本優先讀 manifest；缺值時讀官方 stderr 的停止訊息或最後進度估算，來源記為 `scanner-stderr`。
停止訊息的成本優先於先前進度；美元停止線不當成已用成本，stderr 估算也不代表實際扣款。
ledger 在 target 自家 `docs/evidence/security-scan-ledger.jsonl`（可由 `CLADE_SECURITY_SCAN_LEDGER` 覆寫），
掃描後併入本批 selective commit。

有 `SECURITY.md` 時掃描器使用快照中的憲法並記 hash；没有時 pointer warn 並記 null。
憲法不變量改動後重跑 deep baseline；`verify --finding <id>` 對 finding 做唯讀複驗。

## 完成證據

成功需要完整 manifest、coverage、findings、report，以及 coverage complete。input check、
空 output directory、state DB 的 phase 或 seal 欄位都不能單獨證明掃過哪些程式碼。
診斷若只看到 phase 停在 preflight，就只回報該觀察，不推導全部成本花在 inventory。

## `baseline --components`（分件，opt-in）

分件模式先建立 component plan，再以 `--workers 1` 序列執行；每批停止線使用剩餘預算。
達停止線或成本無法解析時停止排程並回 exit 2。它只跑 standard mode，不能充當 deep baseline。
`scan_strategy: components` / `scan_mode: standard` 與 repository / deep 分開記錄。

上游 component 成本上限不涵蓋 planning 與 matching；`cost_limit_semantics` 記錄此限制。
wrapper 的剩餘預算追蹤不構成實際扣款的硬上限。
