---
description: evlog catalogs 採用全文（defineErrorCatalog/defineAuditCatalog、命名規約、結構原則、動態訊息與 internal 合併、sharding 路徑、反模式、review grep；evlog floor ^2.17.0 SoT）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「新增 catalog、把 ad-hoc createError 遷進 catalog、或寫 catalog 測試之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
paths:
  - 'server/**'
  - 'packages/**/server/**'
  - 'specs/plans/*evlog*/**'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/evlog-adoption.catalogs.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# evlog Adoption — Catalogs（全文）

> 本檔是 [[evlog-adoption]] 的下推全文之一。本檔管 catalog 採用（evlog 2.17+）與 evlog 版本 floor SoT。

## Catalogs 採用（evlog 2.17+）

`defineErrorCatalog` / `defineAuditCatalog` / `defineError` / `defineAuditAction` 把散落的 ad-hoc error code + audit action 集中宣告，配 `declare module 'evlog'` augment `ErrorCode` / `AuditAction` 聯合型別。詳見 `docs/evlog-master-plan.md` § 15 + `vendor/snippets/evlog-catalogs/` cookbook 範本 + 官方文件 <https://www.evlog.dev/learn/catalogs>。

### 命名規約（block-level）

- **MUST** Key 用 `UPPER_SNAKE_CASE`（`PAYMENT_DECLINED` / `INVOICE_REFUND` / `USER_LOGIN`）— audit script `catalog.keyNotUpperSnake` 偵測違反
- **MUST** Prefix 用 `lower.dot.case`（`billing` / `billing.payment` / `billing.subscription`）— audit script `catalog.prefixNotLowerDot` 偵測違反
- **MUST** Wire format 是 `${prefix}.${KEY}`（例：`billing.PAYMENT_DECLINED`、`auth.SESSION_EXPIRED`）— 此即 `code` 欄位、HTTP response code、Sentry 聚合 key 三合一

### 結構原則

- **MUST** **One catalog = one bounded context = one prefix = one file**：`billing` 是一個 bounded context，對應一個檔案 `server/utils/catalogs/billing.ts`，內部只用 prefix `billing`；跨 context 拆檔（`auth.ts` / `machines.ts`），不混
- **MUST** `defineErrorCatalog` / `defineAuditCatalog`（bundle）vs `defineError` / `defineAuditAction`（單例）的選擇：同 bounded context 內 2+ 點 → 用 catalog；真正 one-off 跨 context 共用 error（例如「`featureFlagDisabled`」這種 cross-cutting）→ 用 standalone `defineError`，prefix 仍須 `lower.dot.case`
- **MUST** 單一 prefix 跨檔禁止：`billing.ts` 跟 `billing-extra.ts` 都 `defineErrorCatalog('billing', ...)` → augment 互蓋丟失 KEY；要拆就拆 sub-prefix（`billing` + `billing.payment`）

### 動態訊息與 internal 合併

- **MUST** Message 可以是 string 或 templated function：`message: ({ field }: { field: string }) => \`欄位 ${field} 必填\``。函式簽章成為 typed params，呼叫端 `throw authErrors.FIELD_REQUIRED({ field: 'email' })` 會型別檢查
- **MUST** Catalog 在 KEY 預宣告的 `internal` 與呼叫端 `throw catalog.X({ internal: {...} })` 採 **shallow merge，call-site 同 key 勝出**。要疊深層欄位手動展開：`throw catalog.X({ internal: { ...catalog.X.internal, ...callSiteInternal } })`

### MUST

- **MUST** evlog floor 為 `^2.17.0`（catalogs API 在 2.17 才 export；2.16 沒有）
- **MUST** 新增 `server/api/` endpoint 的錯誤若會重複出現、或 client 會依 `code` 分支處理（錯誤契約），走 catalog factory（`throw billingErrors.PAYMENT_DECLINED({ ... })`），查不到對應 catalog 就先補 KEY。一次性錯誤與帶 custom `data` 的錯誤留在 `createError`（判準同 [[evlog-adoption.depth-gate]] § MUST NOT）
- **MUST** prefix 採 module-level（`auth` / `billing` / `machines` / `ai` / `mcp` 等），不加 consumer namespace
- **MUST** 每個 catalog 檔案配對 `declare module 'evlog'` 區塊（同檔末尾或統一 `index.ts` 的 `interface RegisteredErrorCatalogs { <prefix>: typeof <catalog> }`），否則 `ErrorCode` / `AuditAction` 聯合漏掉這些 code
- **MUST** audit catalog KEY 對齊 D-pattern `audit_logs.action_name` 字串（有 D-pattern consumer 適用）；遷移前先 `SELECT DISTINCT action_name FROM audit_logs` 拿 canonical 列表
- **MUST** 既存 ad-hoc createError 走 plan package 批次遷移（不強制立即全改；新增 endpoint 依上面第二條判準決定走不走 catalog）
- **MUST** Tests 比較 `factory.code` 而非字串字面值：`expect(err.code).toBe(billingErrors.PAYMENT_DECLINED.code)` — KEY rename 時測試會 TS 報錯，hard-code 字串會靜默失準

### MUST NOT

- **MUST NOT** 在 catalog prefix 加 consumer namespace（**禁止** `<consumer>.auth.X` / `<consumer>.billing.X`）— 破壞 cross-consumer 聚合語意
- **MUST NOT** 在測試檔 hard-code error code 字串（用 `errors.X.code` 或 `catalog.X.code`，否則 catalog 改名測試漏網）
- **MUST NOT** 在 `declare module 'evlog'` 寫進 `*.test.ts` / `*.spec.ts`（測試檔的 augmentation 不會散播到 production type space，反而誤導 IDE）
- **MUST NOT** 在 enricher 內 `throw billingErrors.X()`（enricher 失敗會破整個 wide event；catalog error 限 endpoint handler 層）
- **MUST NOT** 跨 npm 套件用同 prefix（兩份 catalog augment 互蓋 → TypeScript 拿後 import 的版本）
- **MUST NOT** 在 call site override `code`（**禁止** `throw billingErrors.X({ code: 'billing.OTHER' })`）— catalog factory 才是 code 的身份來源；override 會讓 Sentry 聚合錯位、type augment 偏離真實；audit script `catalog.codeOverrideAtCallSite` 偵測

### Sharding 路徑（規模演化 4 階段）

1 single file（< 30 點，`src/errors.ts`）→ 2 folder per domain（30–250 點，`src/errors/{billing,auth}.ts` + `index.ts` 統一 `declare module`）→ 3 sub-prefixes（單一 context 50+ KEY，`billing` + `billing.payment`）→ 4 npm package per context（monorepo，各自 `declare module 'evlog'`，經 published `.d.ts` 帶出 augment）。

### Review 檢查

audit signal 在 `scripts/evlog-adoption-audit.ts`：`catalog.errorCatalogs` / `catalog.auditCatalogs` / `catalog.declareModuleBlocks` / `catalog.adhocServerErrors`（warn）/ `catalog.testHardcodedCode`（block）/ `catalog.consumerNamespacedPrefix`（block）/ `catalog.missingDeclareModule`（warn）/ `catalog.keyNotUpperSnake`（block）/ `catalog.prefixNotLowerDot`（block）/ `catalog.codeOverrideAtCallSite`（block）。
