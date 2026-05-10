# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），**不會**被 scaffold 帶到新建專案。
>
> 給新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`（frontmatter `applies-to: post-scaffold`）。
>
> 兩者不要混。

---

## Index

| ID     | Title                                                   | Priority | Status | Discovered         | Owner |
| ------ | ------------------------------------------------------- | -------- | ------ | ------------------ | ----- |
| TD-001 | Template E2E 跑超過 15 min（root cause = retry 放大）   | mid      | done   | 2026-05-07 v0.30.9 | —     |
| TD-002 | Scaffolder `nuxthub-ai` preset 不自動生 D1 evlog_events migration | high     | done | 2026-05-10         | —     |
| TD-003 | Scaffolder dist 在非 TTY (Claude Code Bash / CI) 必經 `script` wrapper | low      | open   | 2026-05-10         | —     |

---

## TD-001 — Template E2E 跑超過 15 min（root cause = retry 放大）

**Status**: done（2026-05-07，v0.30.11 後）
**Priority**: mid
**Discovered**: 2026-05-07 — v0.30.9 修完 cloudflare:sockets 後 e2e 仍在 15 min job timeout 被 cancel
**Location**: `template/playwright.config.ts`、`template/e2e/**/*.spec.ts`、`.github/workflows/template-e2e.yml`

### Problem

CI Template E2E 在 v0.30.9 與 v0.30.10 持續撞 timeout，原以為是 `@nuxt/test-utils` 的 `setup({...})` 對每個 spec 重新 spawn Nuxt instance + 重 build。**實際調查後此假設不成立**：`@nuxt/test-utils/playwright` 的 `_nuxtHooks` fixture 是 `scope: "worker"`（見 `node_modules/@nuxt/test-utils/dist/playwright.mjs:24-33`），加上 CI 設 `workers: 1`，所有 spec 本來就共用同一個 Nuxt instance，沒有 per-spec rebuild。

**真正 root cause**：`auth.spec.ts` 的 login selector / a11y 與實際頁面對不齊，test 失敗後 Playwright `retries: 2` 從頭重跑，wall-clock 被放大 3x（單次 ~4 min × 3 ≈ 12 min），加上前面 Supabase 啟動 / build 撐爆 15 min job cap。

### Resolution

`de5227d` 修正 login page selector / a11y 對齊 e2e spec → e2e step 從 retry 連環失敗變成 ~1m 52s 一次跑完。最近兩次 v0.30.11 run（`25485436035`、`25486587955`）穩定在 6 min wall-clock，遠在 acceptance「≤ 10 min」之內。

收尾動作：

- `template-e2e.yml` `timeout-minutes` 30 → 15（done）
- 移除 `template-e2e.yml` 內指向 TD-001 的註解（done）
- 本 entry Status 改 done，修正 Problem 描述記錄真 root cause（done）

### Lesson

下次 CI timeout 先看實際 step timing（`gh run view <id> --json jobs`）找瓶頸落在哪一 step，不要只憑直覺猜「per-spec rebuild」之類的 fixture-level 假設 — 這次猜錯多寫了 30 min 的 cap 跟一條治本路徑。Playwright 的 `retries` 在 CI 預設啟用，flaky test 會把單一 step 時間放大 N+1 倍，是常見而容易被忽略的時間放大器。

---

## TD-002 — Scaffolder `nuxthub-ai` preset 與 NuxtHub D1 stack **整體未對齊**（不只是缺 migration，是 DB stack 沒切換）

**Status**: done（2026-05-10 archived as `2026-05-10-nuxthub-d1-stack-as-first-class-scaffold`，scaffolder-nuxthub-d1-stack capability 上線：8 added requirements、overlay 機制 + db-nuxthub-d1 templates + scaffolder integration + e2e/audit regression tests / 41 passed）
**Priority**: high — 用 `--evlog-preset nuxthub-ai` scaffold 出來的新專案**從根本上不會跑成功**：scaffolder 預設 Supabase stack，nuxthub-ai preset 只 wire evlog 上層，沒切 DB 底層
**Discovered**: 2026-05-10 — clade HANDOFF §2.1 C 群 + 後續 TD-002 fix attempt 挖開更深 gap
**Design doc**: `decisions/2026-05-10-nuxthub-d1-stack-as-first-class-scaffold.md`（含架構選擇、phase 切分、acceptance）
**Location**: `template/packages/create-nuxt-starter/src/`（scaffolder）、`template/presets/evlog-nuxthub-ai/`（preset）、`template/template/server/db/`（base 模板）
**Related**: 鏡像在 agentic-rag `docs/tech-debt.md TD-069`（agentic-rag 既有專案手動切完 NuxtHub 但忘了跑 migrations:create，consumer-side 後置）；本條是 **scaffolder 全新 scaffold 流程**的根本性 gap

### Problem（修正版）

挖深後發現問題比初登記範圍**大很多**：

scaffolder 預設生成的 base 模板假設 **Supabase 軌道**：
- `server/db/schema/index.ts`（不是 `server/database/schema/`）
- drizzle.config.ts 指向 Supabase
- package.json scripts: `db:drizzle:pull`（Supabase pull pattern）、**無** `hub:db:migrations:create`
- 沒 `server/database/migrations/` 目錄（@nuxthub/core drizzle 期待的位置）
- nuxt.config 預設 modules 不含 `@nuxthub/core`

`--evlog-preset nuxthub-ai` 套用 preset 時，只 cp 7 個 evlog 檔（`server/plugins/evlog-enrich.ts`、`server/utils/ai-logger.ts` 等）+ 改 nuxt.config modules array 的 `evlog/nuxt` → `@evlog/nuxthub`。但**底層 DB stack 完全沒從 Supabase 切到 NuxtHub D1**。

→ scaffold 出來的「nuxthub-ai 專案」其實是個 **Supabase 專案 + 一些 evlog NuxtHub 上層 wiring**，互相不對齊：
- `@evlog/nuxthub` 模組在 nuxt.config 載入但找不到 NuxtHub D1 binding
- 沒 `server/database/migrations/` → drizzle pipeline 拿不到 evlog_events schema
- user 即使知道跑 `pnpm hub:db:migrations:create`，script 不存在
- 即使 user 手動把所有東西切到 NuxtHub D1，base 模板的 auth/users 等其他 schema 也得搬 → 工程量爆炸

### Impact

- **每個用 nuxthub-ai preset 的 user 第一次 scaffold 都會撞**到底層 mismatch
- audit script signal 看起來健康（`nuxthub.moduleInstalled=1 / enrichers.installed=5 / blocked=0`）→ false-positive 訊號，掩蓋真實 gap
- workaround 是 user 自己手動把 Supabase stack 整套換成 NuxtHub D1 stack（auth migration、schema relocate、scripts 重建、wrangler.jsonc 加 d1_databases binding 等）— 工程量遠超「scaffold 完就能跑」的預期
- 若不修：nuxthub-ai preset 等於只是「evlog 部分 file 的便捷 cp 工具」，不是真實意義上的「scaffold 出能跑的 NuxtHub AI 專案」

### Fix approach

兩條根本方向（**需 user 設計討論決定**）：

**方向 A — nuxthub-ai 升級為「整套 stack 切換」preset**
- scaffolder 偵測 `--evlog-preset nuxthub-ai` 時：
  - 跳過 Supabase migration / drizzle pull setup
  - 改用 NuxtHub D1 base：`server/database/schema/` + drizzle-kit generate pattern
  - auth 換成 better-auth + D1 driver（agentic-rag 走的路）
  - package.json scripts 換成 `hub:db:migrations:create` / `hub:db:migrations:apply`
  - nuxt.config modules 加 `@nuxthub/core` + `@evlog/nuxthub` + `better-auth/nuxt`
  - wrangler.jsonc 加 d1_databases binding template
  - 預生 evlog_events migration 進 `server/database/migrations/0001_evlog_events_d1.sql`
- 工程量大（涉及 base 模板的 conditional split），但解決根本問題
- 風險：scaffolder 維護兩條 base 模板 trail（Supabase / NuxtHub D1），長期成本高

**方向 B — nuxthub-ai 降級為「上層 wiring only，明示前置條件」**
- PRESET.md 改成：「本 preset **要求**已切換到 NuxtHub D1 + better-auth + drizzle 之後使用；新專案請用 starter 的 NuxtHub 變體（若存在）或自己先切 stack」
- scaffolder 偵測 preset = nuxthub-ai 但 base 還是 Supabase → 印 warning 拒絕跑（或要 `--force`）
- 工程量小，但**等於放棄 nuxthub-ai 作為「快速 scaffold 」preset 的價值** → user 還是要自己搞 stack 切換
- 對應 agentic-rag 這種「既有 NuxtHub 專案，要套 evlog T3」場景仍有用

**推薦**：**user 決定 starter 是否要支援 NuxtHub D1 軌作為 first-class scaffold 路線**。
- 是 → 走 A（規模大，但落實了 T3 stack 的 starter scaffold 體驗）
- 否 → 走 B（明示限制，nuxthub-ai 只 serve 既有 NuxtHub 專案的 retrofit 場景）

### Acceptance（待方向決定後填入）

方向 A：
- `pnpm create nuxt-supabase-starter test-ai --evlog-preset nuxthub-ai --yes` 出來的專案 modules 含 `@nuxthub/core`、`server/database/migrations/0001_evlog_events_d1.sql` 存在
- scaffolded test-ai 跑 `npx wrangler d1 execute <db> --local --command "SELECT count(*) FROM evlog_events"` 不報 `no such table`
- 觸發任一 endpoint 後該表有 row

方向 B：
- nuxthub-ai preset PRESET.md 開頭明示前置條件
- scaffolder 對 base = Supabase + nuxthub-ai preset 組合印 warning 或 reject
- 標記 nuxthub-ai 為「retrofit only」非「fresh scaffold」

### Decision（2026-05-10）

User 拍板走方向 A — nuxthub-ai 升級為 first-class fresh-scaffold。設計 doc + phase 切分見 `decisions/2026-05-10-nuxthub-d1-stack-as-first-class-scaffold.md`。

**架構選擇**：single base + 條件 overlay 機制（不雙 base），scaffolder 加 `db: { supabase | nuxthub-d1 }` 維度。

**實作 phase**（下個 session 動）：
- Phase 1：overlay 機制 + 預生 migration（半天）
- Phase 2：scaffolder integration（半天）
- Phase 3：文件 + 測試（半天）
- Phase 4：agentic-rag TD-069 retroactive fix（手動 4 命令，user 跑）

---

## TD-003 — Scaffolder dist 在非 TTY 環境必經 `script` wrapper 才能跑

**Status**: open
**Priority**: low — 一般 user 互動 terminal 沒問題；只在 CI / Claude Code Bash tool / Docker non-tty 環境會撞
**Discovered**: 2026-05-10 — clade HANDOFF §2.1 C 群 session 用 Claude Code Bash tool 跑 `node dist/cli.js test-app-baseline --yes ...` 報 `TTY initialization failed: uv_tty_init returned EINVAL`，必改 `script -q /dev/null sh -c "cd ... && node $CLI ..."` 才過
**Location**: `template/packages/create-nuxt-starter/src/cli.ts confirmScaffold()` 函式（dist line ~1724）

### Problem

scaffolder 即使帶 `--yes` 跳過互動 prompt，仍在 `confirmScaffold` 階段呼叫 consola/prompts API 觸發 `process.stdin.setRawMode()` / `uv_tty_init`。非 TTY stdin（Claude Code Bash tool / `< /dev/null` redirection / Docker `-i` 但無 `-t`）會拋 `EINVAL`。

`--yes` 應該完全跳過 prompts.ts 與 confirmScaffold 的 prompt 呼叫，但目前 code path 仍會走到某個 `consola.prompt` / `process.stdin` 操作。

### Impact

- CI workflow 跑 e2e scaffolder smoke 時必踩
- Claude Code Bash tool（agent-driven scaffold smoke）必踩
- workaround：`script -q /dev/null sh -c "cd <dir> && node $CLI ..."`（macOS BSD `script(1)` 介面；Linux `script -qec "..."`）

### Fix approach

audit `cli.ts` 跟 `prompts.ts`，定位仍呼叫 prompt API 的那條 code path（即使在 `--yes` 模式），改成完全 skip：

```ts
if (selections.useYes) return // skip confirm entirely
```

或檢查 `process.stdin.isTTY === false` 時自動視為 confirm。

### Acceptance

- `node dist/cli.js test-app-X --yes --evlog-preset baseline ... < /dev/null` 直接成功，不需 `script` wrapper
- e2e workflow `template-e2e.yml` scaffold step 不需特殊 wrapper
