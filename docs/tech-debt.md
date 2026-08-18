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
| TD-003 | Scaffolder dist 在非 TTY (Claude Code Bash / CI) 必經 `script` wrapper | low      | done   | 2026-05-10         | —     |
| TD-004 | Spectra roadmap drift check 在 CI 永遠 false positive | mid      | in-progress | 2026-05-10 v0.31.0 | —     |
| TD-005 | meta-monorepo 下 pre-push 7 道 check 全部靜默 no-op | high     | open   | 2026-08-19         | —     |
| TD-006 | 在本 repo 跑 install 會讓 clade bootstrap 把 starter 自己當 consumer 投影 | high     | done   | 2026-08-19         | —     |
| TD-007 | scaffolder 測試套件並行不安全；`detectMonorepoRoot` 讀 `PWD` 而非 cwd | mid      | done   | 2026-08-19         | —     |
| TD-008 | `template/scripts/validate-starter.mjs` 是維護者工具卻會被 scaffold 帶走 | mid      | open   | 2026-08-19         | —     |

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
**Related**: 鏡像在 <consumer-c> `docs/tech-debt.md TD-069`（<consumer-c> 既有專案手動切完 NuxtHub 但忘了跑 migrations:create，consumer-side 後置）；本條是 **scaffolder 全新 scaffold 流程**的根本性 gap

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
  - auth 換成 better-auth + D1 driver（<consumer-c> 走的路）
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
- 對應 <consumer-c> 這種「既有 NuxtHub 專案，要套 evlog T3」場景仍有用

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
- Phase 4：<consumer-c> TD-069 retroactive fix（手動 4 命令，user 跑）

---

## TD-003 — Scaffolder dist 在非 TTY 環境必經 `script` wrapper 才能跑

**Status**: done（2026-08-19 驗證）
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

### Resolution（2026-08-19）

`cli.ts:542` 現已用 `if (!args.yes)` 包住 `confirmScaffold()`，`--yes` 完全不觸及 prompt API。實測 acceptance 條件 1 通過：

```
node dist/cli.js test-app-baseline --yes --evlog-preset baseline < /dev/null   # exit 0，無 script wrapper
```

修在哪一次 commit 未追（TD 登記時的 code path 已不存在）；驗證方式如上，複發時重跑同一條指令即可證偽。

---

## TD-004 — Spectra roadmap drift check 在 CI 永遠 false positive

**Status**: in-progress（2026-08-19 起 CI 診斷觀察中）
**Priority**: mid
**Discovered**: 2026-05-10 — v0.31.0 release 後 Template CI 反覆撞 stale
**Location**: `template/scripts/spectra-advanced/roadmap-sync.ts`、`.github/workflows/template-ci.yml`

### Problem

`Template CI` workflow 跑 `vp run spectra:roadmap --check` 永遠回 stale，即使 local 已先跑 `pnpm spectra:roadmap` sync 並 commit ROADMAP.md。CI 環境（ubuntu runner）跟 local（macOS）跑出的 sync 結果有 structural diff，導致 `--check` 報 stale。

排除過的點：
- `_last synced: <ISO>_` 已被 `normaliseTimestamp()` 過濾。
- Spectra CLI 不在 PATH（CI ENOENT）→ source = 'unavailable' → caller 已加 `skipParkedReplace`，不重寫 parked block。Local 模擬同樣環境跑 `--check` 是 PASS。
- `.spectra/claims/` 在 CI 不存在 → `collectClaims` 返回空，跟 local 一致。
- MANUAL drift detection 純看檔案內容 + openspec/changes/archive、docs/tech-debt.md、package.json，CI / local 一致。

剩下未明確的差異點未追到：可能是 active changes 區塊的 progress 計算、parallelism block 的 mutex 排序，或某個 render path 對「empty input」與「missing input」的輸出細節。

### Workaround

`.github/workflows/template-ci.yml` 已暫時把 `Spectra roadmap drift check` step 拿掉（v0.31.0 後續 commit）。Local hook 仍會跑 sync 維持 ROADMAP 鮮度，pre-commit 也在改 spectra artifact 時觸發。

### Fix approach

1. 在 CI 加一個 debug step 印 `vp run spectra:roadmap --json` 與 disk ROADMAP.md 的 diff，定位真正 structural difference 來源
2. 視原因修 sync 對齊（多半在 collectParkedChanges / renderParallelismBlock / renderActiveBlock 對 missing CLI / empty input 的處理上）
3. 修完之後恢復 `Spectra roadmap drift check` step

### Acceptance

- 連續 5 次 main push CI 跑 `vp run spectra:roadmap --check` 都綠
- ROADMAP drift gate 在 CI 重新 enabled 且不再 false positive

### 複測（2026-08-19）

本機把三個已知 CI 差異逐一模擬，`--check` 全數 PASS，重現不出來：

| 模擬條件 | 結果 |
| --- | --- |
| 現有 working tree 直接跑 | `✓ check passed` |
| `git clone --depth 1` fresh shallow clone（無 `.spectra/`） | `✓ check passed` |
| fresh clone + node 24 + `spectra` CLI 不在 PATH | `✓ check passed` |

**Status 改為 in-progress**：已依 §Fix approach 第 1 步，在
`.github/workflows/template-ci.yml` 放回 `Spectra roadmap drift check`，
但帶 `continue-on-error: true`（診斷用，不擋 CI），stale 時 dump
「committed vs CI-synced」的 unified diff。

下一步依 CI 實際輸出分流：

- 連續數輪 `check passed` → 問題已隨其他改動消失，拿掉 `continue-on-error`
  改回真 gate，本條結案
- 報 stale → diff 即是待查的 structural difference 來源，接 §Fix approach 第 2 步

---

## TD-005 — meta-monorepo 下 pre-push 7 道 check 全部靜默 no-op

**Status**: open
**Priority**: high
**Discovered**: 2026-08-19 — clade convention 對齊掃描（bp 庫比對）
**Location**: `template/scripts/pre-push/runner.sh`（clade vendor script，投影副本勿直接改）、`template/scripts/pre-push/checks/*.sh`

### Problem

`runner.sh` 與每支 check 都用 `PROJECT_ROOT="$(git rev-parse --show-toplevel)"` 決定工作目錄。
在 scaffold 出去的專案裡這是對的（`template/` 內容就是 repo root），但在本 meta-monorepo
裡 git toplevel 是 `nuxt-supabase-starter/`，而 `nuxt.config.ts` 在 `template/`。

七支 check 全部走 auto-detect「偵測 nuxt.config.* 才跑」，於是**全部判定不適用、全部
exit 0、全部零輸出**。實測 `bash template/scripts/pre-push/runner.sh` 的 stdout 是空的、
exit code 0：

| check | 本 repo 實際行為 |
| --- | --- |
| nuxt-typecheck / native-picker-ban / data-perf-check / mutation-loading / review-rules-ratchet / nuxt-ui-mixed-slot / utable-slots | 全部 no-op |

這層防護在本 repo 從來沒有跑過，而它的失效是靜默的——沒有 warning，只有「pre-push 很快就過了」。

（本次已另外補上 `template/.vite-hooks/pre-push`，讓 hook 至少會被 git 呼叫到；
在 scaffold 出去的專案裡那條修正就完整生效。本 entry 只剩 meta-monorepo 這一半。）

### Fix approach

1. 讓 check 的 project root 可覆寫（例如認 `CLADE_PROJECT_ROOT`，未設時 fallback 回
   `git rev-parse --show-toplevel`），由 `template/.vite-hooks/pre-push` 帶入 `template/`。
2. 改動落點是 clade `vendor/scripts/pre-push/`，**NEVER** 直接編輯本 repo 的投影副本；
   改完走 publish + propagate。
3. 順帶檢查同型：`template/.husky/pre-commit` / `pre-push` 在 `core.hooksPath` 指向
   `.vite-hooks/_` 之後是否已成為死檔，若是就移除，避免兩份看起來都生效的 hook。

### Acceptance

- 在本 repo 對 `template/**` 動一個會被 review-rules-ratchet 抓到的違規，`git push` 被擋下
- `bash template/scripts/pre-push/runner.sh` 有實際輸出，七項逐項印出結果

---

## TD-006 — 在本 repo 跑 install 會讓 clade bootstrap 把 starter 自己當 consumer 投影

**Status**: done（2026-08-19）
**Priority**: high — 污染會直接進 `template/` seed，而 seed 是要公開發佈的
**Discovered**: 2026-08-19 — 在 `template/packages/create-nuxt-starter/` 跑 `npx vitest`（npx 需先安裝 vitest）時實際發生
**Location**: `template/package.json` 的 `postinstall`（呼叫 clade `scripts/bootstrap-hub.ts`）

### Problem

`template/package.json` 的 `postinstall` 對 scaffold 出去的專案是正確的——新專案就該從 clade 拉
rules / skills / hooks。但在**本 repo 內**，最近的 `package.json` 就是 `template/package.json`，
於是任何觸發 install 的動作（`npx <未安裝的套件>`、`pnpm install`、某些 test runner 啟動）
都會讓 clade bootstrap 把 **starter 自己**當成 consumer 做投影。

實測一次觸發造成 97 個檔變更：

- `template/.claude/` 81 個檔被 clade **未去識別化**版本覆蓋——202 行寫入真實 consumer 名稱
  （去識別化 placeholder 被真名取代），`<!-- starter:strip-begin -->` 段落被寫回
- golden-path 注入：`app/app.vue` 加 `NuxtLoadingIndicator`、`.env.example` 加 `NUXT_APP_ENV`、
  `nuxt.config.ts` / Sentry 相關檔
- 新增 `.claude/rules/drag-interaction.md`

（原本本節還列了 `NuxtLoadingIndicator`、`NUXT_APP_ENV`、`evlog-postgres-drain.ts`、
`*_create_evlog_events.sql`、`.vite-hooks/pre-push`、`evlog` 版本 bump——那些其實是
並行 session 的 clade convention 對齊工作（commit 75b8f03），不是 bootstrap 產物。
當時兩者的變更同時出現在 working tree 才被歸成一筆。）
- 連帶重生成 clade 端 `registry/consumers-meta.json`

沒有任何 gate 擋住它，且 `git status` 之外沒有訊號——不主動比對就會被下一次 commit 帶走。

**2026-08-19 已實際發生一次**：commit `eae5091` 就是這個入口的產物，帶進 221 行真實
consumer 名稱與 11 處 `starter:strip` marker，已由 `a351053` revert。這條的 Priority
是 high 不是理論值。

### Fix approach

1. `postinstall` 加 self-detection：偵測到 cwd 落在 starter 維護倉內（例如上層有
   `scripts/create-clean.sh` + `template/`，即 `assemble.ts:isMonorepoRoot()` 的同一判準）
   就 skip bootstrap 並印一行說明
2. 或改由 `CLADE_HOME` 之外再要求一個 opt-in env，本 repo 的 `.npmrc` 明確關掉
3. 補一道 audit / pre-commit check：`template/.claude/` 出現真實 consumer 名稱即 block
   （對應 `.claude/rules/starter-hygiene.md` 的 `real-tenant-identifier`）

第 3 條與 `starter-public-hygiene-commands` / `clade-starter-sanitization` 同屬一個問題域，
但那兩條處理的是**存量**去識別化，本條處理的是**再污染入口**——存量清乾淨後這個入口仍在。

### Acceptance

- 在 `template/` 或其子目錄跑 `pnpm install`，`git status` 對 `template/.claude/` 零變更
- 刻意在 `template/.claude/rules/` 寫入一個真實 consumer 名稱，pre-commit 或 audit 擋下

### 驗收輸出（2026-08-19）

**1. postinstall self-detection** — `template/` 跑 `pnpm install`：

```text
. postinstall: [clade] starter maintainer repo detected — skip bootstrap. 在本 repo 內跑 bootstrap
會把 starter 自己當 consumer 投影，寫入未去識別化內容（見 starter repo 的 docs/tech-debt.md TD-006）。
要手動投影請自行跑 pnpm hub:bootstrap。
Done in 5s using pnpm v10.28.1

$ git status --porcelain -- template/.claude/ | wc -l
0
```

**2. pre-commit ratchet** — 在 `template/.claude/rules/` 放 probe 檔並 stage：

```text
$ bash .husky/pre-commit; echo $?
[Starter Hygiene] real-tenant-identifier 不通過
問題: clade 投影面含真實 consumer 名，代表投影未去識別化（多半是 bootstrap 在本 repo 內跑過）。
證據: template/.claude/rules/_td006-probe.md + real consumer identifier category
1

# 負向控制（<consumer-a> + _notion-<consumer-b>-board）
$ bash .husky/pre-commit; echo $?
0
```

**3. fixture test / full audit**：

```text
$ bash scripts/audit-template-hygiene.test.sh; echo $?
... 8 個 ok ...
All 8 audit-template-hygiene fixture cases passed.
0

$ bash scripts/audit-template-hygiene.sh >/dev/null 2>&1; echo $?
0
```

### 覆蓋邊界（重要，別誤讀成 full audit 也擋）

full-tree audit 的 `find ... -prune` 清單本來就排除 `template/.claude` / `.agents` / `.codex`，
所以新檢查對這三個目錄的載體是 **pre-commit ratchet**（hook 走 `git diff --cached -- template`，
沒有 prune），full audit 維持綠。另兩個投影面 `template/AGENTS.md` / `template/CLAUDE.md` 不在
prune 清單裡，full audit 會照掃，目前是綠的。

既有污染仍歸 `starter-public-hygiene-commands` / `clade-starter-sanitization`——本條只擋**再污染**。
2026-08-19 重測基線：`template/.claude` 13 / 895、`template/.agents` 17 / 821、`template/.codex` 0 / 9。

---

## TD-007 — scaffolder 測試套件並行不安全；`detectMonorepoRoot` 讀 `PWD` 而非 cwd

**Status**: done（2026-08-19）
**Priority**: mid
**Discovered**: 2026-08-19 — 新增 `test/cli-evlog-preset.e2e.test.ts` 時撞到
**Location**: `template/packages/create-nuxt-starter/test/`、`src/cli.ts` `detectMonorepoRoot()`

### Problem

兩個獨立但會互相放大的問題：

1. **測試套件並行不安全**：`npx vitest run` 預設並行跑 file，`scaffold-audit-regression.test.ts`
   會失敗；同一套測試加 `--no-file-parallelism` 則 92 passed 全綠。多個測試檔同時 scaffold
   到相鄰目錄，彼此干擾。
2. **`detectMonorepoRoot()` 讀 `process.env.PWD`**（`cli.ts:48`）而非實際 cwd。`spawnSync` 給的
   `cwd` 選項不會改寫 `PWD`——子程序繼承呼叫者 shell 的值。所以任何從 repo 內用工具呼叫
   `dist/cli.js` 的情境，CLI 都會判定「在 starter monorepo 裡」並把專案改建到 repo root，
   而不是呼叫者指定的目錄。這不只是測試斷言失敗，是**真的把檔案寫到別的地方**。

新測試已用 `mkdtempSync(tmpdir())` + 顯式覆寫 `PWD` / `INIT_CWD` 迴避第 2 點，但那是測試端的
繞道，CLI 本身的行為沒改。

### Fix approach

1. `vitest.config.ts` 設 `fileParallelism: false`，或讓每個測試檔的 TEST_DIR 落在
   `mkdtempSync(tmpdir())` 而非 `test/.tmp-*`（後者較好，順帶讓測試不寫進 repo）
2. `detectMonorepoRoot()` 改以 `process.cwd()` 為主、`PWD` 僅作 fallback；
   或明確只在 `INIT_CWD` 存在時（真正的 npm/pnpm 呼叫路徑）才採用環境變數

### Acceptance

- `npx vitest run`（不加 `--no-file-parallelism`）全綠
- 從 repo 內任一目錄 `spawnSync(node, [cli, name, '--yes'], {cwd: X})`，專案建在 `X/name`

### 驗收輸出（2026-08-19）

**1. 修前重現**（`PWD` = starter 套件目錄、`spawnSync` cwd = tmpdir、不給 `INIT_CWD`）：

```text
expected at: /tmp/td007-C5zwl7/probe-app false
leaked to repo root: <home>/offline/nuxt-supabase-starter/probe-app true
```

專案真的被寫到 repo root，且 post-scaffold 的 cd 提示印成 `cd ../../../probe-app`。

**2. 修後同一探測**：

```text
expected at: /tmp/td007-Rx2CSB/probe-app true
leaked to repo root: <home>/offline/nuxt-supabase-starter/probe-app false
cd 提示：cd probe-app
```

**3. 兩個 runner 都全綠（皆未加 `--no-file-parallelism`）**：

```text
$ npx vitest run            # 上游 vitest 4.1.11
Test Files  11 passed | 1 skipped (12)
     Tests  93 passed | 1 skipped (94)

$ pnpm vp test run          # workspace 的 @voidzero-dev/vite-plus-test
Test Files  11 passed | 1 skipped (12)
     Tests  93 passed | 1 skipped (94)

$ pnpm run check            # template 全域 lint + typecheck
exit 0（0 errors / 5 既有 no-underscore-dangle warnings）
```

### 修法紀錄

- `cli.ts` `detectMonorepoRoot()` / `getInvocationCwd()` 與 `post-scaffold.ts` 的 `userCwd`
  全部改以 `process.cwd()` 為判準，`INIT_CWD`（真正的 npm / pnpm 呼叫路徑）保留為優先來源，
  `process.env.PWD` 三處全部移除。
- 10 個測試檔的 `TEST_DIR` 從 `test/.tmp-*` 改為 `mkdtempSync(tmpdir())`，測試不再寫進 repo。
- 新增回歸測試 `cli-evlog-preset.e2e.test.ts` >「落點只看實際 cwd」：刻意把 `PWD` 指到 starter
  套件目錄並清掉 `INIT_CWD`，斷言專案落在 spawn cwd、repo root 沒有殘留。把 `cli.ts` 改回讀
  `PWD` 該測試即轉紅（已實測）。

**原記錄的「並行才失敗」在本次無法重現**：`npx vitest run` 在修改前後都是全綠。真正會造成
損害的是 `PWD` 那條——它不需要並行就會把檔案寫到錯的地方，測試端原本是靠顯式覆寫 `PWD` /
`INIT_CWD` 繞過。TEST_DIR 遷出 repo 一併消掉了測試檔互相干擾的結構性條件。

---

## TD-008 — `template/scripts/validate-starter.mjs` 是維護者工具卻會被 scaffold 帶走

**Status**: open
**Priority**: mid
**Discovered**: 2026-08-19 — 做 `starter-public-hygiene-commands` 的 L3 commands 審查時發現
**Location**: `template/scripts/validate-starter.mjs`、`template/package.json` (`validate:starter`)、`template/presets/_base/strip-manifest.json`

### Problem

`validate-starter` 的 slash command 已經 relocate 到 root（`starter-public-hygiene-commands`），
但它背後的實作 `template/scripts/validate-starter.mjs` 還留在會被 scaffold 帶走的 `template/`。

該 script 的性質是 starter 維護者專用：

- `resolve(TEMPLATE_ROOT, '..')` 取 `REPO_ROOT`，再往上找 `scripts/vendor/evlog-adoption-audit.mjs`
- 對 `packages/create-nuxt-starter` 跑 scaffold simulation
- 把 fixture 落在 `template/temp/validate-starter/`

scaffold 出去的使用者專案沒有 `packages/create-nuxt-starter`，也沒有上一層的 `REPO_ROOT` —
這支 script 在使用者專案裡跑必然失敗。`template/package.json` 的 `validate:starter` script 同樣
會被帶走，變成一個註定壞掉的指令。

依 `.claude/rules/starter-hygiene.md` 的 Pollution 類型表，這是 `maintenance-script-misplacement`。

### 為什麼現有 gate 沒擋下

`scripts/audit-template-hygiene.sh` 的 `maintenance-script-misplacement` 檢查沒有涵蓋
`validate-starter.mjs` 這個檔名；`template/presets/_base/strip-manifest.json` 也沒有對應 entry，
所以 create-clean 與 scaffolder 都不會把它剝掉。

### Fix approach

兩條路，擇一（不要兩條都做）：

- **A. 移到 root** — `template/scripts/validate-starter.mjs` → `scripts/validate-starter-scaffold.mjs`，
  同步改 `.github/workflows/validate-starter.yml`（目前 `working-directory: template` 跑
  `vp run validate:starter`）與 `template/package.json`。缺點：script 依賴 `template/node_modules`
  的 dev 依賴，移到 root 要另外解決執行環境
- **B. 留在 `template/` 但加進 strip manifest** — 在 `presets/_base/strip-manifest.json` 加
  `template/scripts/validate-starter.mjs` 與 `package.json` 的 `validate:starter` script rewrite，
  consumers 設 `["create-clean", "scaffolder"]`。缺點：`package.json` 的 script 剝除需要
  create-clean 的 output rewriting 支援，要確認現有機制做不做得到

B 較貼近既有機制（strip manifest 本來就是為這種「留在 template 但不外流」的東西設計的），
但需要先確認 create-clean 能不能改寫 `package.json` 的 scripts 段。

### Acceptance

1. scaffold 出去的專案內不存在 `scripts/validate-starter.mjs`，且 `package.json` 沒有指向它的
   `validate:starter` script
2. `.github/workflows/validate-starter.yml` 仍能跑完整的 preset scaffold simulation
3. `scripts/audit-template-hygiene.sh` 的 `maintenance-script-misplacement` 檢查補上對應 pattern，
   fixture 測試涵蓋（避免同類檔案再次漏網）
