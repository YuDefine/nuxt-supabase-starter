---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI
paths: ['screenshots/**', 'tests/e2e/**', 'packages/*/tests/e2e/**', 'openspec/changes/**/design-review.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/screenshot-strategy.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# Screenshot Strategy

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 工具選擇

先判斷一次性探索、人工驗收、可重現回歸、多 viewport、跨瀏覽器與量測需求，再由 target adapter 選擇已驗證的 browser carrier、reproducible runner 或 measurement surface。共通判準如下：

| 需求 | 共通選擇規則 |
| --- | --- |
| 一次性互動與人工驗收 | target adapter 的 interactive browser carrier |
| 多 viewport、跨瀏覽器、多分頁或需重拍的回歸 | target adapter 的 reproducible browser runner |
| LCP/CLS/INP breakdown 或 heap measurement | target adapter 的 measurement-only surface |
| 不需要的上層 runtime / QA 平台 | MUST NOT 取代已批准的 target carrier |

## Cloud / clean-browser fallback

遠端 provider、proxy、clean profile 與 CAPTCHA 能力都是 opt-in target capability。只有本機 carrier 確實不可用、目標允許公開資料且不需要私有登入態時，才可依 target adapter 的 consent flow 啟用；provider credential NEVER 寫入 repo。

## 給 user 開瀏覽器看頁面

agent 自驗、user 可見 headed navigation 與 measurement 是三種不同用途，必須使用 target adapter 明確聲明的 surface。任何 unavailable surface 都保持 blocked；NEVER 用 uncontrolled default browser 代替。

## 決策樹

1. 需要多 viewport / responsive？→ reproducible browser runner
2. 需要跨瀏覽器或可重拍回歸？→ reproducible browser runner
3. 需要一次性互動？→ target adapter 的 interactive browser carrier
4. 純 performance / heap measurement？→ target adapter 的 measurement-only surface

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

- **MUST** 用 explicit path 落在 `screenshots/<env>/<topic>/` 下：`<target-capture> screenshots/<env>/<topic>/#N-....png`
- **NEVER** 讓 `<target-capture>` 不帶 path 參數 — 預設落點 user 找不到
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

## 截圖落檔（target adapter operation）

MUST 以 target adapter 宣告的 capture command 寫入 explicit path `screenshots/<env>/<topic>/#N-....png`。NEVER 省略 path、把 temporary capture 當 canonical evidence，或在驗證前覆蓋既有 canonical 檔。

### Review evidence：`safe-screenshot.ts`（非破壞性，review/verify:ui 推薦入口）

Canonical review evidence MUST use `vendor/scripts/safe-screenshot.ts` or the equivalent atomic helper declared by the target adapter. The helper MUST capture to a temporary path, verify expected content and artifact size, preserve the previous canonical file on failure, and replace it only after all checks pass. A raw carrier confirmation string is never evidence by itself.

### Before／after ad-hoc comparison

比較兩個已知 URL 的單次視覺差異時，用 pair helper 一次產生同 viewport 的 `before.png`、`after.png`、`manifest.json` 與並排 `review.md`；每一側仍委派給 `safe-screenshot.ts`，保留上述非破壞性保證：

```bash
node scripts/before-after-screenshot.ts \
  --name "settings-density" \
  --before-url "https://production.example.com/settings" \
  --after-url "http://localhost:3000/settings" \
  --viewport 1440x900 \
  --expect-text "Settings"
```

預設落在 `screenshots/local/ad-hoc/before-after/<name>-<timestamp>/` 且 `publication=local-only`。只有 manifest `status=complete` 的輸出才是有效 comparison；`failed` / `partial` 的 `review.md` 不產生雙欄表，避免把單邊成功誤讀成完整比較。

這個 helper 是 ad-hoc comparison，不會寫 `(verified-ui:)` 或 evidence sidecar。要納入正式 review-gui 驗收，仍依 item／sub-item 分別走 `vendor/snippets/verify-channels/annotation-cheatsheet.md` 的 `evidence-store.ts` 寫入契約；多 viewport、跨瀏覽器或重複 regression 仍走本檔決策樹指定的 target adapter runner。

## 平行 session 隔離（target adapter operation）

平行 agent / 多分頁作業 MUST 使用 target adapter 宣告的原生 session isolation。任何會改變頁面的 action 後 MUST 重新取得 snapshot/ref；無法證明隔離時保持 blocked。

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

同一組截圖被重複拍第 3 次，**SHOULD** 轉成 reproducible runner spec，避免每次重述操作步驟。

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

**沒有機器替你偵測這一條**——原本的 `post-propose-check.sh` Check 6 隨 spectra 生命週期退場（2026-09-07）。交付前自檢 `## N. Fixtures / Seed Plan` 在不在，**NEVER** 把「沒有 gate 擋我」讀成這條不必做。

### 2. Review 階段兜底

target visual verifier 拍前 **MUST** 跑 emptiness heuristic（DOM empty-state 文字 / list row 計數 / main innerText 長度）。命中時依 host 分支：

| Host | 行為 |
| --- | --- |
| dev (`localhost*` / 含 `dev`) | 先檢查 `tasks.md` 有無 Fixtures Plan：有 → 回報「fixtures 未執行，請回 apply」；無 → 主動補進專案 seed 檔（`supabase/seed.sql` / `db/seed.sql` / `prisma/seed.ts` / `drizzle/seed.ts`）+ 跑 reset 命令 + retry |
| staging（含 `staging`） | **MUST** 停下回報主 session 詢問授權，**NEVER** 直接寫 staging DB |
| production / 真實 host | 拒絕，回報應改用 dev |

完整流程見 target visual verifier 的「拍前 Emptiness Preflight」與「空資料解決流程」段落。

**NEVER 改 component 加 fallback 假資料來填空 UI** — 空狀態的成因是資料沒進 seed，改 component 讓畫面看起來有東西是把 review 的判斷依據換成假的。三條解法都在上面：dev 補 seed 檔、staging 停下問授權、production 改用 dev。
