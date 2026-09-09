<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/technical-research/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-owned: not mirrored from upstream; see vendor/snippets/specformula/README.md -->

# `/technical-research` on a clade consumer

本檔只覆蓋一件事：`rules/AIxBDD必問問題與起始專案介面澄清判準.md` 那三題必問，在 clade fleet 的 Nuxt 4 + Supabase consumer 上**預設答案是什麼**。三題仍然 MUST 全部拍板才可寫 `research.md` 或 `techstack.md` —— 本檔不解除那條，它只是讓 `/clarify` 的問題變成「確認一下對不對」而不是開放題。

## 三題的 fleet 預設

| 必問題 | clade consumer 的預設 | 什麼時候不適用 |
| --- | --- | --- |
| **各端的 BDD techstack** | 後端 API：**SpecFormula TS ＋ Cucumber**（`@specformula/cucumber`，`pnpm test:bdd`）。前端 webapp：**Playwright** | consumer 的 `.claude/hub.json` 沒宣告 `capabilities: ["specformula"]` |
| **測試策略** | 兩端都 E2E。後端 E2E 用 SpecFormula 打真 HTTP 端點與 Postgres 權威狀態，**不是**只打領域函式 | 使用者本輪明確改判某一端先不要 E2E |
| **系統有哪些端** | 前端 webapp（Nuxt 4 pages）＋ 後端 API（Nitro `server/`）。DB 是 Supabase PostgreSQL | 該 consumer 是 library / tooling profile，沒有 web 端 |

## MUST

1. 上表是**預設答案，不是已回答**。三題仍 MUST 走 `/clarify` 確認 —— 上游 Rule 2 逐字寫著只有「使用者本輪原話 / 本輪 clarify 的答案 / 既有 `techstack.md` 已寫明且本輪沒改判」才算已拍板，**agent 從別處推論出來的不算，本檔也不算**。本檔的作用是讓那三個問題附上具體選項，不是替使用者回答。
2. 寫進 `specs/truth/techstack.md` 的 `測試與驗證` 段 MUST **按端分列 runner**，不可寫成「全專案用同一套」。至少兩列：後端 SpecFormula、前端 Playwright。
3. 選定 SpecFormula 時，`techstack.md` MUST 同時記下這兩個當前限制，否則下一個讀它的人會踩到：
   - packages 未發佈 npm，從原始碼消費（`vendor/specformula-ts/`，`tsx` runtime 轉譯，無 build 步驟）
   - **hosted Supabase 接不上** —— `JdbcDataSourceConfig` 沒有 `ssl` 也沒有 `connectionString`，BDD 的 DB 只能是本機 `supabase start` 的 `127.0.0.1:54322`
4. 前端選 Playwright 而後端選 SpecFormula 時，`research.md` MUST 明寫兩者**不共用** step definition 或 fixture —— 前端走 playwright-bdd 自己的 step，後端由 `isa.yml` 動態註冊。把它們寫成同一套的決策會在 `/tasks` 拆到一半才發現。

## NEVER

- **NEVER** 因為「fleet 已經有預設」就跳過 `/clarify`。那正是上游 Rule 2 Bad Example 的形狀（把範例堆疊當成已拍板）。
- **NEVER** 把後端測試策略收成單元測。上游 Rule 4 的預設是 E2E，而 SpecFormula 的 `entity_validate` 本來就要求驗到 DB 權威狀態，收成單元測會讓那半邊契約整個消失。

規約全文：`.cursor/rules/specformula.mdc`、`.cursor/rules/aixbdd-workflow.mdc`。
