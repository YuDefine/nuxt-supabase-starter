---
description: evlog adoption depth 自評與 evlog map coverage gate 全文（depth 1-6 自評表、MUST/MUST NOT、四條 false green、strict gate 兩道、ratchet 退場條件）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「評估 consumer evlog 覆蓋率、看 evlog map 分數、或判定 entry point gate 之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
paths:
  - 'evlog.map.json'
  - 'packages/**/evlog.map.json'
  - 'specs/plans/**'
  - '.github/**'
  - 'server/**'
  - 'packages/**/server/**'
  - 'app/pages/**'
  - 'packages/**/app/pages/**'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/evlog-adoption.depth-gate.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# evlog Adoption — Depth 自評與 coverage gate（全文）

> 本檔是 [[evlog-adoption]] 的下推全文之一。本檔管「裝到哪個 depth、map 覆蓋率怎麼判」：depth 自評表、`evlog map` 維度、分數的 false green、strict gate。

## Adoption depth 1-6 自評表

每個 consumer 對照下表自評：

| Depth | 條件 | 對應 |
| --- | --- | --- |
| **1** | `evlog/nuxt` 套件裝、`useLogger(event)` 在 server endpoint 採用 | — |
| **2** | 1 + 自家 Sentry drain（無 pipeline） | — |
| **3** | 2 + drain pipeline（batch + retry） | — |
| **4** | 3 + 5 件套 enricher | — |
| **5** | 4 + sampling + redaction policy + structured errors | T1 完成後 |
| **6** | 5 + client transport + typed fields + source location | T2 完成後 |
| **6+O1** | 6 + D-pattern audit + evlog signed chain + auditDiff | T2+O1 完成後 |
| **AI variant** | 1 + AI SDK + MCP/SSE child logger（與 6 並行軸） | T3 拉到 NuxtHub D1 完整版 |

review 時 grep marker：depth 1 `useLogger(event)`；depth 3 `createPipeline(` / `pipeline.wrap`；depth 4 五個 `*Enricher(`；depth 5 `sampling: { rates` 與 `redact:`；depth 6 `transport: { enabled: true` 與 `interface *EvlogFields`；O1 `signed({` / `auditEnricher(` / `auditOnly(`。

## Coverage 維度（evlog map）

Depth 表量**裝了什麼**，`evlog map` 量**每個 entry point 用了沒有**，兩者都要看（depth 6 但多數 handler 從沒呼叫 `useLogger` 是常見狀態）。工具是 `@evlog/cli`，AST-based 靜態掃描，六個 check：`wide-event` / `context` / `structured-errors` / `audit` / `error-handling` / `page-error-handling`。安裝、check 滿足方式、CI 接法見 `vendor/snippets/evlog-map/`。

### MUST

- **每一個**新增或修改的 entry point（`server/{api,routes,middleware,tasks}/`、pages、Next route handler）都 MUST 通過 map 的全部 check。**不是**「entry point 應該要有 log」——是本次 diff 動到的每一個都要滿分
- `evlog.map.json` MUST track 進 git，且 MUST 與 code 在同一個 commit 內更新（`npx evlog map` 重新產生，**NEVER** 手改數字）。它是**產生物**：已排除在 formatter 之外（`vendor/oxc-shared/preset.ts`），**NEVER** 把它加回任何 format run
- 查看報告 MUST 帶 `--no-write`。**NEVER** 用不帶 flag 的 `evlog map --all` / `evlog map <file>` 當 read-only 指令 —— 它們會改寫 tracked 檔
- 無法插樁的 entry point MUST 留 `// evlog-map-disable-next-line <check> — <理由>`，理由 MUST 寫「為什麼這個 entry point 不可插樁」。收斂到 strict 之後 **零豁免**——strict 判定拒絕任何 `suppressedChecks > 0`
- catalog 的 `why` MUST 寫**技術根因**，`fix` MUST 寫**呼叫端能執行的動作**。**NEVER** 把 `why` 寫成 message 的複述（「文件查詢在後端失敗」）或把 `fix` 寫成泛化的「稍後重試」——那是用文案換分數，而分數本來就不檢查 catalog 內容
- 實作細節（table 名 / 查詢函式 / provider code / runbook）MUST 走 `internal:`，**NEVER** 放進 `why` / `fix`（這兩欄會經 h3 `sendError` 送到瀏覽器；`internal` 不會，但會進 drain，仍受 PII / 保存期限規範）
- catalog call site MUST 帶 `cause: error`，否則原始 stack 在轉拋時遺失
- money / auth / PII 路由 MUST 通過 `audit` check（`log.audit({ action, actor, target })`）—— 這類路由在 map 的計分權重加倍

### MUST NOT

- **NEVER** 用 disable 註解讓 gate 轉綠而不寫理由（disabled check 從分母移除）
- **NEVER** 以「這個 gap 是既有的、非本次 diff 引入」跳過 —— gate 只在你動到的檔上要求滿分，動了就要補
- **NEVER** 把 map 分數當成 depth 表的替代品 —— map 100 分的專案仍可能沒有 durable drain，撈不出 wide event
- **NEVER** 把帶 custom `data` 的 `createError` 遷移到 catalog——`EvlogError.data` 是固定形狀 `{ code, why, fix, link }`，傳進去的 custom data 會被**靜默丟棄**（不報錯、不警告、typecheck 也過），依賴 `error.data.<field>` 分支的 client 就此壞在 runtime。遷移前先跑 `grep -rn -A6 "createError({" server/ | grep "data: {"` 列出不遷移清單（見 [[pitfall-evlog-catalog-silently-drops-custom-data]]）
- **NEVER** 為了拿分而把所有 `createError` 轉成 catalog：catalog 只給穩定、重複、值得成為公開錯誤契約的 domain error（`code` 等於公共 API），一次性的錯誤留在 `createError`，新舊站點都一樣
- **NEVER** 用機械方式滿足 `audit` check（map 只確認 AST 裡有 `log.audit()`，不驗 actor / target / outcome / 拒絕路徑），這條 MUST 人工分類
- **NEVER** 在 map 回報 `0 個 entry point` 卻 score 100 時視為滿分 —— 那是掃不到，不是全覆蓋（見 `vendor/snippets/evlog-map/monorepo-layers.md`）

### 分數不是品質證明

`evlog map` 的分數有四條已驗證的 false green，**NEVER** 把「100 分」當成「覆蓋率正確」的證據：

| False green | 實測 | 後果 |
| --- | --- | --- |
| **catalog 不受內容檢查** | 建一個**沒有** why/fix 的 `defineErrorCatalog` → 該 entry point **100/100**，CLI 還印「✓ errors carry why and fix」 | `structured-errors` 只檢查直接 `createError()` 的 object keys；`throw someErrors.X()` 被歸為 `other` 不檢查。**全面 catalog 化是最有效的洗分手段** |
| **分數會四捨五入** | 201 個 route（200 滿分 + 1 個 80 分）→ CLI 回報 **score 100** | 分數是 `Math.round(加權平均)`。大 repo 裡新增失敗完全反映不到整數分上 |
| **suppression 不扣分** | 把 check 全部 `disable` 掉 → **score 100** / suppressed 2 | disabled check 轉成 `n/a`，從分母移除 |
| **check 不驗欄位有沒有到達 runtime** | 大量 `createError({ …, why, fix })` 全部滿分，但呼叫點解析到的是 **h3 的 `createError`**，它根本不讀這兩個欄位 → 欄位寫了就被丟掉 | `structured-errors` 是 AST 原始碼比對，不解析 callee 實際 resolve 到誰。**route 級零失敗也擋不住這一種**——它連 runtime 都沒碰到 |

因此 gate 的判定 **MUST** 用 **route 級零失敗 + 零 suppression**，**NEVER** 用全域分數當 boolean（`vendor/actions/evlog-map-gate/gate.ts` 的 `strict` 模式；`--mode min-score` 是它的別名）。第四條連 route 級判定都擋不住：**gate 全綠不證明欄位到達過任何地方**，要實跑斷言 response 與 NDJSON，見 [[evlog-error-exposure]] § 完成證明。

### Gate（兩道，都走 strict）

**判定是整個 repo 的每一個 entry point 零失敗 check、零 suppression**，不是只看本次 diff 觸及的那幾個。既有 gap 一律要補。

| 位置 | 實作 | 時機 |
| --- | --- | --- |
| commit | `/commit` 0-E gate | 補一行 `log.set` 是 5 秒 |
| CI | `.github/actions/evlog-map-gate` | push 後被擋是一輪來回 |

CI 那個 job 在 gate 之前另跑上游的 `evloghq/action`，把結果放上 PR（check run、job summary、comment），並擋既有 entry point 的 check 由 pass 變 fail。它是報告，不是第三道 gate：它比的是 PR base 與全域分數，新增的 entry point 帶缺口、`fail` 改成 disable 註解都不擋，所以 PR comment 顯示滿分時上表的 CI gate 仍可能紅，以 gate 為準。接法與版本對齊見 `vendor/snippets/evlog-map/README.md` § PR 報告（evloghq/action）。

CI 那一道另有本機入口 `.github/actions/evlog-map-gate/local.ts`：照 CI workflow 的 mode／cwd 跑 CI 同一支 `run.sh`，work-route 在 task 標 done 前、pre-push 在推出去前各跑一次（見 `vendor/snippets/evlog-map/README.md` § Gate）。它與 CI 同判定，CI 還在 ratchet 的 repo 本機也是 ratchet —— 推向 strict 仍照下一段。

`ratchet`（分數只進不退 + 觸及的 entry point 滿分）**只剩過渡用途**，掛上時 **MUST** 同時登記推到 strict 的 TD，**NEVER** 當長期狀態。

### Review 檢查

**判 conformance 之前 MUST 先讀 `~/offline/clade/docs/conventions/evlog-stack.md`**：`variant`（接了哪幾層）與覆蓋率（`map.score`）是兩個正交的軸，**NEVER 用其中一軸推斷另一軸**。

```bash
npx evlog map --all --no-write | head -30
node -e "const j=require('./evlog.map.json');console.log('score',j.map.score,'routes',j.map.routes.length,'suppressed',j.summary.suppressedChecks)"

# 豁免登記是否帶理由（每一條命中都要能答出「為什麼不可插樁」）
rg -n "evlog-map-disable-next-line" server app | rg -v "—|--"
```
