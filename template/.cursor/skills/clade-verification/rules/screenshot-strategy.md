---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI
paths: ['screenshots/**', 'tests/e2e/**', 'packages/*/tests/e2e/**', 'openspec/changes/**/design-review.md']
---
<!-- Clade native rule; source: rules/core/screenshot-strategy.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# Screenshot Strategy

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 決策樹（工具選擇）

1. 需要多 viewport / responsive、跨瀏覽器、多分頁或可重拍回歸？→ target adapter 的 reproducible browser runner
2. 需要一次性互動或人工驗收？→ target adapter 的 interactive browser carrier
3. 純 performance（LCP/CLS/INP）/ heap measurement？→ target adapter 的 measurement-only surface

不需要的上層 runtime / QA 平台 MUST NOT 取代已批准的 target carrier。

## Cloud / clean-browser fallback

遠端 provider、proxy、clean profile 與 CAPTCHA 能力都是 opt-in target capability。只有本機 carrier 確實不可用、目標允許公開資料且不需要私有登入態時，才可依 target adapter 的 consent flow 啟用；provider credential NEVER 寫入 repo。

## 給 user 開瀏覽器看頁面

agent 自驗、user 可見 headed navigation 與 measurement 是三種不同用途，必須使用 target adapter 明確聲明的 surface。任何 unavailable surface 都保持 blocked；NEVER 用 uncontrolled default browser 代替。

## 存放方式

```text
screenshots/<environment>/<topic>/
```

- `<environment>`：`local` / `staging` / `production`
- `<topic>`：依用途分兩類，**MUST** 嚴格區分（見下節）
- 評估報告可放 `review.md`

### 兩類截圖必分清楚

| 類別 | 用途 | `<topic>` 約束 | 檔名約束 | 算驗收證據 |
| --- | --- | --- | --- | --- |
| **A. 人工檢查截圖** | 對應 spectra change tasks.md `## 人工檢查` 各 item | **MUST** = `<change-name>`（一字不差等於 `openspec/changes/<change-name>/` 目錄名） | **MUST** `#<item-id>[<variant>]-<descriptor>.<ext>`（見下節「檔名強制規範」） | ✅ 是 |
| **B. Ad-hoc / debug 截圖** | 探索、debug、screenshot review 視覺 QA、polish 過程觀察 | 自由語義（`debug-clock-overlap`、`live-preview-design-token`、`exploration-typography` 等） | 自由命名 | ❌ 否（資料夾名與 active change 不 match） |

**禁止把兩類混在同一資料夾**（驗收讀端用資料夾名 + 檔名 id 配對 item）。

### 驗收截圖 vs 探索截圖

人工檢查資料夾 `screenshots/<env>/<change-name>/` 只放「使用者可據此勾 OK / issue」的 final-state 驗收證據（toast 可見、數值已更新、modal 關閉且列表刷新、readonly / unauthorized 明確呈現等）。

每個 `#N` / `#N.M` 預設 1 張驗收截圖；需要 light / dark、viewport、角色或同一驗收點的必要 variant 時，最多 4 張。若超過 4 張，必須做其中一種整理：

- 拆成多個人工檢查 item，讓每張圖有明確驗收目標。
- 只保留 1–4 張 final-state variant，其餘移到 `_exploration/`。
- 若此 item 本質不能用截圖證明 round-trip，改在 tasks.md 行尾標 `@no-screenshot`。

驗收截圖 descriptor 應使用 final-state 詞彙，例如 `saved`、`success`、`final`、`updated`、`readonly`、`disabled`、`unauthorized`、`empty-state`、`conflict`。禁止把 `attempt`、`after-click`、`500-detail`、`error-detail`、`debug`、`exploration`、`try`、`probe` 等探索字眼留在 review topic 根目錄。

探索截圖是 agent 找路、debug、確認 DOM/route/state 的過程證據，必須放在：

```text
screenshots/<env>/<change-name>/_exploration/
```

`_exploration/` 不被當成驗收證據（staleness audit 也不看它）；裡面的檔名可自由命名，但不能拿來要求人判 OK。

## 路徑強制規範（hard rule）

凡是給人工檢查、design review、debug 給 user 看的截圖，**MUST** 以 target adapter 的 capture command 寫入 explicit path `screenshots/<env>/<topic>/#N-....png`；**NEVER** 省略 path、把 temporary capture 當 canonical evidence，或在驗證前覆蓋既有 canonical 檔。`/tmp` 只允許 agent 內部 sanity check。

## 檔名強制規範（hard rule）

人工檢查截圖**MUST** 與 `## 人工檢查` 的 item id 一一對應。

### 命名格式

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

- `<item-id>`：對應 tasks.md `## 人工檢查` 的 canonical id（`#1` parent / `#3.1` scoped）。
  **MUST** 與 `manual-review.md` 規範的 `#N` / `#N.M` 完全一致。
- `<variant>`：選填的單一小寫英文字母（`a`–`z`），用於同一 item 的多角度截圖。例：`#1a-`、`#3.1b-`。
- `<descriptor>`：kebab-case 描述，至少含頁面或場景關鍵字。例：`clock-light`、`leave-quotas-mobile`。

### 範例

```text
✅ #1-clock-light.png  #1b-clock-dark.png  #3.1-mobile-petition-list.png
❌ 8.1-home.png（缺 `#`）  clock-light.png（沒有 id）  #1_clock-light.png（`_` 不認）
```

檔名首段 token 由 `^#?(\d+(?:\.\d+)?)[a-z]?(?=[-._])` 擷取；沒有讀端替 legacy 命名兜底，`audit-screenshot-staleness.ts` 把缺 `#N` 前綴的檔標成 LEGACY。

## 截圖落檔（target adapter operation）

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

預設落在 `screenshots/local/ad-hoc/before-after/<name>-<timestamp>/`；只有 manifest `status=complete` 才是有效 comparison。它不寫 evidence，正式驗收仍走 `evidence-store.ts` 寫入契約（`vendor/snippets/verify-channels/annotation-cheatsheet.md`）。

## 平行 session 隔離（target adapter operation）

平行 agent / 多分頁作業 MUST 使用 target adapter 宣告的原生 session isolation。任何會改變頁面的 action 後 MUST 重新取得 snapshot/ref；無法證明隔離時保持 blocked。

## 歸檔機制（不 rotate）

完成的截圖留在 `screenshots/<env>/<topic>/`，不搬進 `screenshots/<env>/_archive/YYYY-MM/`。`/review archive` 與 `/review screenshots` **MUST NOT** 自動或手動搬 `_archive/`。既有 `_archive/` 目錄可讀。

pending 與否看 work package 的人工檢查狀態，不靠 `ls screenshots/<env>/` 排除 `_archive/` 當現行清單。

## 沉澱規則

同一組截圖被重複拍第 3 次，**SHOULD** 轉成 reproducible runner spec，避免每次重述操作步驟。

## round-trip-only manual-review item

截圖無法證明 round-trip 的 `## 人工檢查` 項目（form submit 到 server、status transition、409 conflict、權限拒絕等），**MUST** 在 tasks.md 對應 checkbox 行尾加 `@no-screenshot`。完整語法見 [[manual-review.evidence]] § `@no-screenshot` Marker（hard rule）。

## Empty Data Handling

截圖時遇到空狀態 = 無效 review。

### 1. Propose 階段預防（治本）

詳見 `ux-completeness.md` 的「必填 Fixtures / Seed Plan」段落。凡 `Affected Entity Matrix` 任一 entity 的 `Surfaces` 欄非空，`tasks.md` **MUST** 包含 `## N. Fixtures / Seed Plan` section（每個 entity 一條 task 列出最少筆數 + 寫入哪個 seed 檔，或明確 `**Existing seed sufficient**` 宣告 + 一行理由）。

**沒有機器替你偵測這一條**：交付前自檢 `## N. Fixtures / Seed Plan` 在不在，**NEVER** 把「沒有 gate 擋我」讀成這條不必做。

### 2. Review 階段兜底

target visual verifier 拍前 **MUST** 跑 emptiness heuristic（DOM empty-state 文字 / list row 計數 / main innerText 長度）。命中時依 host 分支：

| Host | 行為 |
| --- | --- |
| dev (`localhost*` / 含 `dev`) | 先檢查 `tasks.md` 有無 Fixtures Plan：有 → 回報「fixtures 未執行，請回 apply」；無 → 主動補進專案 seed 檔（`supabase/seed.sql` / `db/seed.sql` / `prisma/seed.ts` / `drizzle/seed.ts`）+ 跑 reset 命令 + retry |
| staging（含 `staging`） | **MUST** 停下回報主 session 詢問授權，**NEVER** 直接寫 staging DB |
| production / 真實 host | 拒絕，回報應改用 dev |

**NEVER 改 component 加 fallback 假資料來填空 UI**——那是把 review 的判斷依據換成假的。
