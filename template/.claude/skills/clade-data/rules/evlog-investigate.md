---
description: prod runtime 問題用 evlog wide event 調查的協定（消費側；先查 evlog 再從 code 對因）
moment: 使用者描述 prod／staging 的 runtime 症狀（5xx、錯誤 toast、變慢、間歇、特定 user 異常）、要開始查原因時，在 grep code／查 codebase／派 Explore 之前
paths:
  - 'server/**'
  - 'packages/**/server/**'
  - 'clients/**/server/**'
  - 'layers/**/server/**'
  - 'server/plugins/evlog-*.ts'
  - 'packages/*/server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'packages/*/app/plugins/evlog-*.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/evlog-investigate.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# evlog Investigate（prod 問題的調查反射）

evlog 採用治理（**寫入側**）見 [[evlog-adoption]] / [[logging]] / [[evlog-stream-extend]]；canonical audit 模型見 `docs/d-pattern-master-plan.md`。本 rule 是**消費側**對應：prod / staging runtime 出問題時，怎麼用已寫入的 evlog wide event 查 root cause。

**觸發**：訊息描述的是 prod / staging 的 **runtime 症狀**（壞了、5xx、Toast error、變慢、間歇、特定 user 異常）而不是「改 code / 加 feature」時，第一個證據動作 **MUST** 是查 evlog wide event，先於 grep code / codebase-memory-mcp / 派 Explore。本 rule 是它的完整協定。

agent 的預設反射是 code-first（grep / codebase-memory-mcp），對 runtime 症狀方向是反的；evlog wide event 是實際發生了什麼的 ground truth，常直接推翻 code 推測。

## Step 0：先問這是不是自己人做的（症狀是「環境變了」時 MUST 先跑）

**觸發 predicate**：查出來的是**環境本身變了**（容器被重建、服務被重啟、config 內容或 mtime 變了、port 被佔、DB 被 reset、branch / working tree 被動過、排程或 daemon 狀態變了），而不是程式回錯答案。命中就先跑本節三步，全部沒結果才進主機層鑑識——多 session 並行下「另一個自己人剛做的」是最大的一塊。

1. **列並行 session**：`ListAgents`（per-session provision，不保證存在；沒有就跳第 2 步，**NEVER** 因此把「有沒有其他 session」當成無法回答）
2. **看被改物件自己的 mtime 與旁邊的備份檔**：`ls -la --time-style=full-iso <目錄>/`，mtime 落在事件前數十秒、或旁邊有 `.bak-<日期>` / `.orig` / `~` 鄰居 → 幾乎確定是人為修改，`diff -u <config>.bak-* <config>` 讀出改了什麼（檔案回答意圖，daemon log 只回答動作）
3. **問 user**：「這台機器上剛才是不是你（或你的另一個 session）做了 X？」

**NEVER** 把本節讀成「先問 user 再調查」（前兩步 agent 自己做完，第三步才問人，[[agent-self-verification]]）。**NEVER** 因為主機層答不出「誰做的」就繼續加深鑑識——`/var/log/auth.log` 可能不存在、Portainer CE 不記 audit log，該退回本節換更便宜的問題（`docs/pitfalls/2026-08-08-infra-change-attribution-skips-concurrent-session-check.md`）。

## Investigation-first 協定（每一個 prod runtime 症狀都適用）

訊息是 prod / staging runtime 症狀（非「改 code / 加 feature」）→ **MUST** 依序：

1. **界定查詢軸**：把症狀對應到可查詢的維度 —— `request.id` / `trace.id` / `user.id` / `path` / `status` / 時間窗 / `error.code` / `duration_ms`。
2. **撈 evlog wide event**：用對應 backend 的 query（見 cookbook）拿**實際執行事實** —— 哪些 request、status 分布、慢在哪、`error_json` 內容、是否真的「全部失敗」還是局部。
3. **用事實 narrow 假設**：拿 evlog 證據縮小可能原因，**主動準備推翻初始直覺**（「全部失敗」常常 evlog 一查就破）。
4. **才回 code 對因**：帶著「實際發生什麼」回 code 找「為什麼會這樣」，這時 codebase-memory-mcp / grep 才用對地方。

**NEVER**：

- ❌ 在沒撈 evlog 前就從 code 向 user 宣稱 prod root cause（從 code 推的結論在 evlog 驗證前一律是**未證實推測**）
- ❌ 把「查 prod log」當成等 user 開口才做 —— runtime 症狀進來時它就是第一步，不是 fallback
- ❌ 對 prod 症狀先派 Explore agent 讀 code 推測 root cause，把 evlog 排到後面

## evlog = ground truth 的邊界（何時要回 DB canonical）

evlog wide event 對「ops / 行為 / 效能 / 錯誤現場」是 ground truth，足以定位**絕大多數** runtime 症狀。但對 **audit / 合規 / 帳務正確性**問題，canonical 真相在 DB（per `docs/d-pattern-master-plan.md`：「任何 audit 問題先查 DB row，evlog 是衍生視圖；evlog miss 是 monitoring 缺口，不改變 canonical audit truth」）。

判斷：

- 「為什麼這個 request 壞了 / 慢了 / 報什麼錯」→ evlog 定案
- 「這筆 audit / 金額 / 證據鏈對不對、有沒有少寫」→ 回 DB canonical row，evlog 只當交叉驗證

## Per-backend 查詢入口（recipe 在 cookbook）

backend 因 consumer 而異（見 `docs/d-pattern-master-plan.md` per-consumer 對應，不在此重抄）。對照表：

| Drain backend | 查詢入口 | Recipe |
| --- | --- | --- |
| Supabase Postgres drain（evlog 寫進 `evlog_events` 等表） | prod-supabase MCP `execute_sql` 或 SQL client | `evlog-investigate/supabase-drain-query.md` |
| Sentry / Axiom / OTLP（SaaS） | 後端自帶 query / search UI 或 query API | `evlog-investigate/sentry-axiom-query.md` |
| Stream（dev / 內部 admin debug） | `evlog-stream-extend` 的單 request/user event chain 重放（prod 必 token-gate） | `evlog-investigate/stream-replay.md` |

Cookbook 絕對路徑：`~/offline/clade/vendor/snippets/evlog-investigate/`。

## Prod 可查詢 drain 是這條協定的前提

prod 沒有可查詢的 durable drain（只有 `createFsDrain`——Workers VFS 不 durable；或根本沒 drain）時這條協定**無法執行**。`evlog-adoption-audit.ts` 的 investigation-readiness 欄位會標 ⛔ red；補強屬 consumer 自治區，clade 主線稽核 + 出表 + **把 findings relay 給該 consumer 的 session**（[[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay），不替 consumer 接 drain。

## 與寫入側 rule 的分工

| 主題 | 走哪 |
| --- | --- |
| useLogger / drain pipeline / sampling / redaction / catalogs 怎麼**寫** | [[evlog-adoption]] / [[logging]] |
| stream server / FS reader / enricher 怎麼**設定** | [[evlog-stream-extend]] |
| audit canonical 模型（DB outbox + hash） | `docs/d-pattern-master-plan.md` |
| prod 出事**怎麼用 evlog 查** | 本 rule + `evlog-investigate/` cookbook |
