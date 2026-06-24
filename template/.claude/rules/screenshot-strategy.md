---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 agent-browser 或 Playwright CLI
paths: ['screenshots/**', 'tests/e2e/**', 'packages/*/tests/e2e/**', 'template/tests/e2e/**', 'openspec/changes/**/design-review.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/screenshot-strategy.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Screenshot Strategy

繁體中文 | [English](./screenshot-strategy.en.md)

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 工具選擇

| 工具 | 何時優先使用 | 特性 |
| --- | --- | --- |
| `agent-browser`（自管 persistent-profile Chromium，CDP） | 一次性驗收、探索、debug、人工檢查 | 快、互動成本低、persistent profile 繼承登入 cookie、平行 `--session` 原生隔離、CLI + MCP 雙模 |
| Playwright CLI / spec | 響應式、多 viewport、跨瀏覽器、多分頁、CI 回歸 | 可重現、可沉澱 |

## Browser automation 工具路由（三條線別混）

「截圖 / 瀏覽器自動化」有三條獨立的線，**MUST** 先確定自己在哪條，再往下走細部決策（見「決策樹」）。混淆會導致拿 measurement 工具做日常互動、或把表層 vitals 數字當成 performance breakdown。

| 線 | 是什麼 | 角色 | 注意 |
| --- | --- | --- | --- |
| **① `agent-browser`** | 自管 persistent-profile Chromium（不 CDP-attach 既有 Chrome，從根本無 remote-debugging popup），CLI + MCP 雙模 | **primary** — screenshot-review / verify / design review 預設走這條 | 連線/profile/session 設定見 `screenshot-review` agent §0；本檔下方所有 agent-browser 規範都指這條 |
| **② `chrome-devtools-mcp`** | 純量測 MCP：`lighthouse_audit` / `performance_start_trace` + `performance_analyze_insight`（LCP/CLS/INP breakdown + culprit）/ `take_heapsnapshot` | **measurement only** | **NEVER** 拿來做日常截圖 / 互動 — 那是線 ①；agent-browser `vitals` 只給表層數字，要 breakdown / culprit 才走這條（見 `modern-web-mcp` § 實測閉環） |
| **③ Playwright CLI / spec** | 可重現、可沉澱的 spec | responsive / 多 viewport / 跨瀏覽器 / 多分頁 / CI 回歸 | 見下方「決策樹」「場景對照」 |

- **Codex runtime 自帶的 `browser-use@openai-bundled` plugin 與本框架無關** — 派 Codex 做 screenshot-review 時用 **agent-browser CLI**（已全域安裝、在 PATH），**NEVER** 依賴 Codex bundled plugin、也 **NEVER** 拿它的行為推論 agent-browser 行為。
- workflow-use / `terminal` / `desktop` / `browsercode` / `qa-use` / `vibetest-use` 等上層 runtime / app / QA 平台**都不採用**（會與 Claude Code + Codex runtime 競爭）；採用 agent-browser 取代 browser-use/harness 的決策紀錄見 `docs/discussions/2026-06-24-agent-browser-adoption.md`。

## Cloud / clean-browser fallback（disabled-by-default）

本機 agent-browser（線 ①）掛掉、或目標本質需要 clean browser / anti-bot / CAPTCHA / proxy / 並發多 browser 時，可走 agent-browser 的遠端 provider（`-p browserbase` / `-p kernel` / `-p browseruse`）或 `--proxy` 作 **opt-in fallback**。預設關閉，agent 啟用前 **MUST** 先回報 user。

### 啟用條件（全部滿足才走）

- local 線 ① 確實不可用（`agent-browser doctor` 報 fail 且 `--fix` 無效），**或** 目標明確需要 provider 專屬能力（anti-bot / CAPTCHA / proxy / clean profile / 並發）
- 目標是 public URL（暴露 localhost 用 `cloudflared tunnel --url http://localhost:<port>` 直用，不再走 browser-use tunnel）
- **不需要**使用者私有登入狀態（遠端 provider browser 不繼承本機 profile cookie）

### Hard rule

- **NEVER** 把本機 profile cookie / private state 上傳遠端 provider — 這是隱私 / 安全決策，只在 user 明確 opt-in 才做
- **NEVER** 把遠端 provider 的截圖當成「使用者已登入本機」的 review evidence — 兩者不等價
- **NEVER** 把 provider API key（`BROWSERBASE_API_KEY` / `KERNEL_API_KEY` / `BROWSER_USE_API_KEY` 等）寫進 repo / clade source — 留 user-level env
- **MUST** 啟用前回報 user「本機 agent-browser 不可用，建議改走遠端 provider fallback（限非私有登入頁）」，等 user 同意才繼續

## 決策樹

1. 需要多 viewport / responsive？→ Playwright
2. 需要跨瀏覽器？→ Playwright
3. 需要多分頁 / 多 session？→ 平行獨立作業用 agent-browser `--session <name>`（原生隔離，各 session 自己的 tab，互不搶）；需要可重現回歸才升 Playwright
4. 這組截圖之後還要重拍？→ Playwright
5. 其他一次性檢查 → `agent-browser`

## 場景對照

| 場景 | 建議工具 |
| --- | --- |
| 人工檢查逐項驗收 | `agent-browser` |
| Design Review 視覺 QA | `agent-browser` 起步，必要時升級 Playwright |
| Mobile / tablet / desktop 對照 | Playwright |
| Safari / Firefox 驗證 | Playwright |
| 重複第 3 次以上的截圖回歸 | Playwright spec |

## 存放方式

```text
screenshots/<environment>/<topic>/
```

- `<environment>`：`local` / `staging` / `production`
- `<topic>`：依用途分兩類，**MUST** 嚴格區分（見下節）
- 評估報告可放 `review.md`

### 兩類截圖必分清楚

| 類別 | 用途 | `<topic>` 約束 | 檔名約束 | review GUI 自動載入 |
| --- | --- | --- | --- | --- |
| **A. 人工檢查截圖** | 對應 spectra change tasks.md `## 人工檢查` 各 item | **MUST** = `<change-name>`（一字不差等於 `openspec/changes/<change-name>/` 目錄名） | **MUST** `#<item-id>[<variant>]-<descriptor>.<ext>`（見下節「檔名強制規範」） | ✅ 是 |
| **B. Ad-hoc / debug 截圖** | 探索、debug、screenshot review 視覺 QA、polish 過程觀察 | 自由語義（`debug-clock-overlap`、`live-preview-design-token`、`exploration-typography` 等） | 自由命名 | ❌ 否（資料夾名與 active change 不 match） |

**禁止把兩類混在同一資料夾** — review GUI 用資料夾名 + 檔名 id 配對 item，A 類資料夾混入 B 類 ad-hoc 檔會造成「對應 0 張」誤導。

### 驗收截圖 vs 探索截圖

人工檢查資料夾 `screenshots/<env>/<change-name>/` 是 review pipeline，只能放「使用者可據此勾 OK / issue」的最終驗收證據。截圖應呈現 item 要求的最終狀態，例如 submit/save 後 toast 可見、數值已更新、modal 已關閉且列表刷新、readonly / disabled / unauthorized 狀態明確呈現，或 item 明確要求的 error / empty / conflict final state。

每個 `#N` / `#N.M` 預設 1 張驗收截圖；需要 light / dark、viewport、角色或同一驗收點的必要 variant 時，最多 4 張。若超過 4 張，必須做其中一種整理：

- 拆成多個人工檢查 item，讓每張圖有明確驗收目標。
- 只保留 1–4 張 final-state variant，其餘移到 `_exploration/`。
- 若此 item 本質不能用截圖證明 round-trip，改在 tasks.md 行尾標 `@no-screenshot`。

驗收截圖 descriptor 應使用 final-state 詞彙，例如 `saved`、`success`、`final`、`updated`、`readonly`、`disabled`、`unauthorized`、`empty-state`、`conflict`。禁止把 `attempt`、`after-click`、`500-detail`、`error-detail`、`debug`、`exploration`、`try`、`probe` 等探索字眼留在 review topic 根目錄。

探索截圖是 agent 找路、debug、確認 DOM/route/state 的過程證據，必須放在：

```text
screenshots/<env>/<change-name>/_exploration/
```

`_exploration/` 不被 review GUI / screenshot quality audit 當成驗收證據；裡面的檔名可自由命名，但不能拿來要求使用者在 `pnpm review:ui` 裡判斷 OK。

## 路徑強制規範（hard rule）

凡是給人工檢查、design review、debug 給 user 看的截圖：

- **MUST** 用 explicit path 落在 `screenshots/<env>/<topic>/` 下：`agent-browser screenshot screenshots/<env>/<topic>/#N-....png`
- **NEVER** 讓 `agent-browser screenshot` 不帶 path 參數 — 預設落點 user 找不到
- `/tmp` 只允許 agent 內部 sanity check（拍完當場 `Read` 自己看，不交付給 user）

換句話說：任何要交付給 user 的截圖路徑必須是 `screenshots/<env>/<topic>/...`，不能漂走。

## 檔名強制規範（hard rule）

人工檢查截圖**MUST** 與 `## 人工檢查` 的 item id 一一對應，讓 `pnpm review:ui` 自動把
截圖配到正確的 item，使用者不需要手動挑選清單（review GUI 也設計成只顯示對應該 item 的截圖）。

### 命名格式

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

- `<item-id>`：對應 tasks.md `## 人工檢查` 的 canonical id（`#1` parent / `#3.1` scoped）。
  **MUST** 與 `manual-review.md` 規範的 `#N` / `#N.M` 完全一致。
- `<variant>`：選填的單一小寫英文字母（`a`–`z`），用於同一 item 的多角度截圖（例如 light/dark
  mode、不同 viewport、不同子流程節點）。例：`#1a-`、`#3.1b-`。
- `<descriptor>`：kebab-case 描述，至少含頁面或場景關鍵字。例：`clock-light`、`leave-quotas-mobile`。

### 範例

```text
✅ #1-clock-light.png             ← item #1，唯一一張
✅ #1a-clock-light.png            ← item #1，第 a 個變體（明亮模式）
✅ #1b-clock-dark.png             ← item #1，第 b 個變體（暗色模式）
✅ #3.1-mobile-petition-list.png  ← scoped item #3.1
✅ #8.2-salary-positive-negative.png ← parent item #8.2 之外，等於主流程那張

❌ 8.1-home.png                   ← legacy section.item 命名，缺 `#`，請改成 `#1-home.png`
❌ clock-light.png                ← 沒有 id，review GUI 無法配對
❌ #1_clock-light.png             ← 用 `_` 而非 `-`，pattern 不認
❌ #1-Clock_Light.PNG             ← 大小寫混用、底線、kebab 走樣
```

### review GUI 配對邏輯（補充說明）

`pnpm review:ui` 用 regex `^#?(\d+(?:\.\d+)?)[a-z]?(?=[-._])` 從檔名擷取 id token。
直接 match item id；對 legacy `<section>.<item>` 命名（例 `8.1-`）會自動 fallback
配到 parent item id（例 item `#1`），但這只是過渡期 fallback，**新拍截圖一律走
canonical 格式**。命名漂走的副作用是 review GUI 顯示「對應 0 / N 張」，使用者
看不到截圖、無法逐項確認。

### 與 manual-review.md 的契約

manual-review.md 規定 item id 一律 `#N` / `#N.M`；本檔規定截圖檔名首段 token
與該 id 嚴格相等（含 `#` 前綴）。兩條規則一起成立，review GUI 才能真正自動配對。

### 違反時

```
[Screenshot Naming] 檔名與 item id 不對應

問題：screenshots/<env>/<topic>/<file> 不符合 #<item-id>[<variant>]-<descriptor>.<ext>

修正：
  - 將檔名首段改成 #<item-id> 或 #<item-id><variant>（單一英文字母）
  - 同 item 多角度截圖用 a/b/c... 變體後綴，descriptor 區分情境
```

## 截圖落檔（agent-browser）

`agent-browser screenshot <path>` 是 CLI，直接把 PNG 寫到 `<path>` 並印出確認字串（不回傳 base64、不需要任何後處理）。

- **MUST** 顯式傳 path：`agent-browser screenshot screenshots/<env>/<topic>/#N-....png`
- **NEVER** 對 CLI 印出的確認字串做任何 decode / re-write — 檔案已經寫好了
- 全頁截圖 `--full`；JPEG 品質 `--screenshot-quality <n>`；vision model 標號版 `--annotate`
- 預設輸出目錄可用 `--screenshot-dir <path>` 或 `AGENT_BROWSER_SCREENSHOT_DIR` 固定

### Review evidence：`safe-screenshot.mjs`（非破壞性，review/verify:ui 推薦入口）

`screenshots/local/**` 是 **gitignored、無 git 歷史 / 無備份**。直接 `agent-browser screenshot <canonical>` 若拍出 blank / 錯頁，會**覆蓋掉**先前有效截圖且**永久遺失**（2026-06-24 <consumer-a> ehr-salary：一張空白 re-capture 砍掉有效 `#2` admin-list，無從還原）。加上 agent-browser daemon 會被 agent harness 在 tool-call 之間 reap → 跨 call 的 capture 各自 spawn 競爭 Chromium、撞 profile `SingletonLock` → Chrome abort → 整頁 blank。

因此 **review / verify:ui 的 canonical 截圖 MUST 走 `scripts/safe-screenshot.mjs`（clade source `vendor/scripts/safe-screenshot.mjs`），NEVER 對 canonical 路徑裸跑 `agent-browser screenshot`**：

```bash
node scripts/safe-screenshot.mjs \
  --url "http://localhost:3040/admin/salary" \
  --out "screenshots/local/<change>/#2-admin-list-final.png" \
  --login-url "http://localhost:3040/auth/_dev-login?email=<admin>" \
  --expect-text "<必出現於頁面的字串>"
```

它保證：(1) 啟動前清 stale `Singleton*` lock；(2) 全程在單一 process 內（daemon 不被跨-call reap）；(3) 拍到 **temp** 檔、驗證 `--expect-text` 真的在頁面 + size ≥ `--min-bytes`（預設 8000，擋 blank）**才** atomic 取代 canonical；(4) 取代前把舊檔備份成 `<name>.prev`；(5) 任一驗證失敗 → canonical **原封不動** + exit≠0。拍壞不再致命。

- 裸 `agent-browser screenshot <path>` 仍可用於**探索 / 一次性**截圖（非 canonical evidence、可隨意覆蓋）
- `--expect-text` 是擋 blank 的關鍵 anti-pattern guard，review evidence capture **SHOULD** 帶

## 平行 session 隔離（agent-browser）

agent-browser 的 `--session <name>` 是**原生**隔離——每個 session 各自的 daemon + 各自的 tab，互不搶（已實證：兩條平行 session 各守自己的 URL）。這跟舊 browser-harness「local 模式單一 target_id 綁定、BU_NAME 只在 cloud 有效」的模型完全不同，不再需要手動 `switch_tab(target_id)` 重綁。

### 隔離規則

- **MUST** 平行 sub-agent / 多分頁作業各給不同 `--session <name>`（如 `--session bh-<task>`）；同一 session 內的命令共用同一 tab
- **MUST** 任何會改變頁面的動作（click 導航、submit、SPA re-render）後**重新 `snapshot -i`** — `@eN` ref 在頁面變動後即 stale
- agent-browser 用**自管 profile Chromium**，不碰 user 的 daily Chrome tab，所以不存在「誤切到 user 業務 tab」的問題；user 並行業務不受干擾
- 操作前要確認當前頁面用 `agent-browser --session <name> get url`

### 診斷與救援

- 拍出來不是預期頁面 → `agent-browser --session <name> get url` + `snapshot -i` 對比；多半是漏了 re-snapshot 用了 stale ref
- session 壞掉：`agent-browser --session <name> close` 後重開
- **整頁 blank + log 出現 `Failed to create ... SingletonLock: File exists` / `ProcessSingleton ... Aborting`** → daemon 被 harness reap 後留下 orphan profile lock，新 launch 撞鎖 abort。救援：`agent-browser close --all` → `rm -f ~/.agent-browser/profile-default/Singleton*` → 重試。`doctor --fix` **不**清這些 orphan lock（已實證）；review evidence 走 `safe-screenshot.mjs` 內建此清理，免手動
- 整體診斷：`agent-browser doctor`（`--fix` 自動清 stale daemon / socket，但**不**含 profile `Singleton*` orphan lock）

## 歸檔機制

`screenshots/<env>/` 預設只放「目前 pending 人工檢查」的 topic；已收錄到 `docs/manual-review-archive.md` 的 change，對應截圖資料夾搬到 `screenshots/<env>/_archive/YYYY-MM/<topic>/`。

```text
screenshots/local/
├── change-pending-A/        # ← 仍在 review
├── change-pending-B/
└── _archive/
    ├── 2026-04/
    │   └── change-old-1/
    └── 2026-05/
        └── change-old-2/
```

- 歸檔由 `/review-archive` 與 `/spectra-archive` 完成時**自動觸發**（指定 change 模式，無需 user 介入）；獨立呼叫 `/screenshots-archive` 用於補救 pending sweep 或跨 change 一次掃乾淨
- 對齊條件：未指定範圍模式（Mode A）只 sweep `docs/manual-review-archive.md` 已收錄的 change，避免誤搬 pending；指定 change 模式（Mode B）信任 caller，但找不到對應 topic 時會 prompt user 列候選
- `--no-sweep` 例外旗標：user 在觸發 `/review-archive` 或 `/spectra-archive` 時若明確說「不要 sweep 截圖」，自動 sweep 步驟跳過（仍可事後手動跑 `/screenshots-archive`）
- 目的：`ls screenshots/<env>/`（排除 `_archive/`）= 目前 pending review 清單

## 沉澱規則

同一組截圖被重複拍第 3 次，**SHOULD** 轉成 Playwright spec，避免每次重述操作步驟。

## round-trip-only manual-review item

有些 `## 人工檢查` 項目只能由使用者親自操作驗收，截圖無法證明功能 round-trip 已通過。這類 item 不需要截圖，**MUST** 在 tasks.md 對應 checkbox line 行尾加上 `@no-screenshot` marker，讓 `pnpm review:ui` 顯示 round-trip-only UI，而不是提示補截圖或複製 handoff prompt。

典型 round-trip-only 情境：

- form submit 真的送到 server，並確認 response / DB / list refetch。
- API 行為需要觀察 request → response → state update。
- status transition 需要送出後確認狀態實際轉移。
- 樂觀鎖 409 / conflict path 需要真實觸發並檢查 copy 與保留輸入。
- 權限拒絕 path 需要真實使用低權限角色操作並確認拒絕結果。

`@no-screenshot` 是 manual-review schema 的一部分，不是截圖檔名規則。完整語法、parent / scoped item 範例，以及 `@followup[TD-NNN] @no-screenshot` canonical ordering，見 `manual-review.md` 的「`@no-screenshot` Marker（hard rule）」。

## Empty Data Handling

截圖時遇到空狀態 = 無效 review。處理走兩段策略：

### 1. Propose 階段預防（治本）

詳見 `ux-completeness.md` 的「必填 Fixtures / Seed Plan」段落。凡 `Affected Entity Matrix` 任一 entity 的 `Surfaces` 欄非空，`tasks.md` **MUST** 包含 `## N. Fixtures / Seed Plan` section（每個 entity 一條 task 列出最少筆數 + 寫入哪個 seed 檔，或明確 `**Existing seed sufficient**` 宣告 + 一行理由）。

`post-propose-check.sh` 的 Check 6 會自動偵測，沒 Fixtures Plan 會被 FINDING flagged。

### 2. Review 階段兜底

`screenshot-review` agent 拍前 **MUST** 跑 emptiness heuristic（DOM empty-state 文字 / list row 計數 / main innerText 長度）。命中時依 host 分支：

| Host | 行為 |
| --- | --- |
| dev (`localhost*` / 含 `dev`) | 先檢查 `tasks.md` 有無 Fixtures Plan：有 → 回報「fixtures 未執行，請回 apply」；無 → 主動補進專案 seed 檔（`supabase/seed.sql` / `db/seed.sql` / `prisma/seed.ts` / `drizzle/seed.ts`）+ 跑 reset 命令 + retry |
| staging（含 `staging`） | **MUST** 停下回報主 session 詢問授權，**NEVER** 直接寫 staging DB |
| production / 真實 host | 拒絕，回報應改用 dev |

完整流程見 `screenshot-review` agent 的「拍前 Emptiness Preflight」與「空資料解決流程」段落。

## 禁止事項

- **NEVER** 在需要多 viewport / 跨瀏覽器時硬用一次性工具
- **NEVER** 把「有截圖」誤當成「已完成人工檢查」
- **NEVER** 把截圖散落在 repo 各處，不留語義化路徑
- **NEVER** 把探索 / debug / attempt 截圖留在 `screenshots/<env>/<change-name>/` review pipeline 根目錄；一律移到 `_exploration/`
- **NEVER** 讓同一個人工檢查 item 在 review pipeline 中累積超過 4 張 final-state variant
- **NEVER** `agent-browser screenshot` 不帶 path 用於人工檢查交付（路徑強制規範）
- **NEVER** 對 `agent-browser screenshot` 印出的確認字串做 decode / re-write — 檔案已寫好（截圖落檔）
- **NEVER** 把已歸檔 change 的截圖資料夾留在 `screenshots/<env>/` 頂層 — sweep 到 `_archive/YYYY-MM/` 才算完整收尾
- **NEVER** 對偵測到空狀態的頁面硬拍交付 — 走 Empty Data Handling 流程
- **NEVER** 改 component 加 fallback 假資料來填空 UI — 治標不治本
- **NEVER** 在 dev 用 ad-hoc UI / API 補資料而不沉澱進 seed 檔 — 不持久化
- **NEVER** 在 staging 未授權前自動寫資料
- **NEVER** 平行作業共用同一 `--session` — 各給不同 `--session <name>` 才有原生隔離（平行 session 隔離）
- **NEVER** 頁面變動後沿用舊 `@eN` ref — 必須重新 `snapshot -i`
- **NEVER** 拿 `agent-browser vitals` 表層數字當 performance breakdown — LCP/CLS/INP 下鑽 culprit 走 chrome-devtools-mcp（線 ②）
