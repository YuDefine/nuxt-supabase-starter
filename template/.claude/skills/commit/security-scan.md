<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 0-S Codex Security — 放行條件與額度配置

`gates.md` § 0-S 的延伸檔。準備 Tier 3 掃描、選定提交批次或判讀掃描失敗時讀取。
退出碼與 `failure_class` 維持既有放行契約；`failure_reason` 與 `failure_phase` 提供診斷，沒有新增自動放行路徑。

## 工具故障放行（僅 `tool-failure-no-artifacts` / `tool-timeout`）

工具故障時，未掃描放行是人的決定。MUST 用 `AskUserQuestion` 二選一，**NEVER** 自行決定放行：

- **`[1] 停下修工具`**（推薦）：釋放 commit-lock，回報 failure_class、failure_reason、failure_phase、output_dir，本批不 commit。
- **`[2] 授權未掃描落地`**：user 明確承擔風險。放行時 **MUST 同時**做到兩件事，缺一不可：
  1. `HANDOFF.md` 追加 `0-S UNSCANNED` 條目：日期、failure_class、診斷原因、output_dir，以及本批命中 Tier 3 的**每一個 path**。
  2. 本批**每一個** commit message 帶 trailer `Security-Scan: unscanned (<failure_class>)`。

HANDOFF 承載補掃範圍；commit trailer 承載歷史 parent/head 的對帳入口。

- **NEVER** 把 `[2]` 讀成掃過；完成報告寫 `0-S 未執行（<failure_class>）`。
- **NEVER** 把使用者沒有回應讀成 `[2]`，也不得沿用上一批的工具故障授權。
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

| failure_reason | 當次處置 |
| --- | --- |
| `quota-exhausted` | 停止該帳號的後續掃描；保留額度訊息與重設時間原文，不提高美元停止線重試 |
| `auth-failure` | 修復既有認證；不自動切 API 計費或購買 credits |
| `output-dir-not-empty` | 使用新的私有 output directory；不刪既有證據 |
| `cost-limit-reached` | 記錄已完成單位、模型估算成本與剩餘範圍，再決定新一輪停止線 |
| 其他或 `unknown` | 依 failure_phase、stderr 與 artifacts 查證；不從缺產物推定成本原因 |

scanner stderr 在 `<output_dir>.stderr.log`，與 output directory 同層；scanner 起跑前 output directory 保持空白。
`--workflow-id` 的續跑相容性依固定 scanner 版本契約判定，不承諾不同 scope、base/head 或安全上下文可重用。

## 提交內容與歷史覆蓋

日常 0-S 使用 `working-tree --paths-file <批次清單>`：固定 HEAD 後在私有 Git 快照加入選定內容，
原 repo index、WIP 與未追蹤檔保持原樣。清單是一行一個 repo-relative 檔案；rename 列出兩端。
同一檔混有其他工作的變更時，使用精確 patch 選定本批 hunks；**NEVER** 擅自把整檔納入本批。
掃描後、commit 前重新比對批次內容；內容變了即重掃，不能把舊快照結果套到新內容。

歷史補掃使用 `diff --base <parent> --head <commit>`。wrapper 解析完整 SHA，再於固定 head 的
私有快照執行。每個未掃 commit 保留 parent/head；只有 diff 與安全上下文完全相同才可去重。
當前 baseline 不覆蓋已被後續 commit 覆寫的歷史內容。

ledger 記錄兩端 SHA、snapshot digest、scanner 版本及 `security_md_sha`，成本值附來源；
缺成本資料以 null / unknown 表示，不寫成零或實際扣款。舊 row 缺新增欄位時視為未知。
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
