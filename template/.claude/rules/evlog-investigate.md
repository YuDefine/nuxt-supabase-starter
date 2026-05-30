---
description: prod runtime 問題用 evlog wide event 調查的協定（消費側；先查 evlog 再從 code 對因）
paths:
  - 'server/**'
  - 'packages/**/server/**'
  - 'clients/**/server/**'
  - 'layers/**/server/**'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-investigate.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# evlog Investigate（prod 問題的調查反射）

evlog 採用治理（**寫入側**）見 [[evlog-adoption]] / [[logging]] / [[evlog-stream-extend]]；canonical audit 模型見 `docs/d-pattern-master-plan.md`。本 rule 是**消費側**對應：prod / staging runtime 出問題時，怎麼用已寫入的 evlog wide event 查 root cause。

always-on 觸發反射寫在 CLAUDE.md 注入段（`claude-md/core-snippets/evlog-prod-triage.md`）；本 rule 是其詳細真相層。

## 為什麼這條 rule 存在

實證（<consumer-b> prod incident）：agent 拿到 prod bug（「報工 NFC 全部失敗」「刀位 PATCH 503」）後，第一反射是 grep code + 派 Explore agent 推測，自評「root cause 多為推測」；evlog 是 **user nudge「查 prod log」之後**才查的。一旦查了 evlog，立刻拿到決定性證據並**推翻** code 推測（NFC 其實 prod 當天仍回 23,105 次 200；真兇是 21.6 秒慢查詢）。

根因：agent 的 standing「第一反射」是 code-first（codebase-memory-mcp / grep），對 prod **runtime** 症狀方向是反的。evlog wide event 是「實際發生了什麼」的 ground truth，但沒有規約把它擺到調查的第一步，於是缺的調查本能要 user 人工補。

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

Cookbook 絕對路徑：`~/offline/clade/vendor/snippets/evlog-investigate/`（per consumer 端 agent 解 relative path 會失敗）。

## Prod 可查詢 drain 是這條協定的前提

若 consumer 的 prod **沒有可查詢的 durable drain**（只有 `createFsDrain` —— Workers VFS 不 durable、FS reader 在 Workers 也讀不到；或根本沒 drain），這條調查協定**無法執行** —— 寫再多 wide event 也撈不出來。

- 這是**前提失敗**，不是 nicety：`evlog-adoption-audit.mjs` 的 investigation-readiness 欄位會把這類 consumer 標 ⛔ red。
- 補強（接 Sentry / Axiom / OTLP / Postgres durable drain）屬 consumer 自治區，走 `docs/d-pattern-master-plan.md` 各 consumer 的 prod-drain plan + `evlog-adoption` rule 的 drain pipeline 規範。clade 主線只稽核 + 出表，不替 consumer 接 drain。

## 與寫入側 rule 的分工

| 主題 | 走哪 |
| --- | --- |
| useLogger / drain pipeline / sampling / redaction / catalogs 怎麼**寫** | [[evlog-adoption]] / [[logging]] |
| stream server / FS reader / enricher 怎麼**設定** | [[evlog-stream-extend]] |
| audit canonical 模型（DB outbox + hash） | `docs/d-pattern-master-plan.md` |
| prod 出事**怎麼用 evlog 查** | 本 rule + `evlog-investigate/` cookbook |
