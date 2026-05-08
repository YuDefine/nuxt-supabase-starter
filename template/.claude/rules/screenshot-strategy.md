<!--
🔒 LOCKED — managed by clade
Source: rules/core/screenshot-strategy.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 browser-harness 或 Playwright CLI
globs: ['screenshots/**', 'tests/e2e/**', 'openspec/changes/**/design-review.md']
---

# Screenshot Strategy

繁體中文 | [English](./screenshot-strategy.en.md)

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 工具選擇

| 工具 | 何時優先使用 | 特性 |
| --- | --- | --- |
| `browser-harness`（CDP 連使用者 Chrome） | 一次性驗收、探索、debug、人工檢查 | 快、互動成本低、繼承使用者登入 cookie |
| Playwright CLI / spec | 響應式、多 viewport、跨瀏覽器、多分頁、CI 回歸 | 可重現、可沉澱 |

## 決策樹

1. 需要多 viewport / responsive？→ Playwright
2. 需要跨瀏覽器？→ Playwright
3. 需要多分頁 / 多 session？→ Playwright（browser-harness 多 session 走 `BU_NAME` 可行但偏 ad-hoc）
4. 這組截圖之後還要重拍？→ Playwright
5. 其他一次性檢查 → `browser-harness`

## 場景對照

| 場景 | 建議工具 |
| --- | --- |
| 人工檢查逐項驗收 | `browser-harness` |
| Design Review 視覺 QA | `browser-harness` 起步，必要時升級 Playwright |
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

## 路徑強制規範（hard rule）

凡是給人工檢查、design review、debug 給 user 看的截圖：

- **MUST** 用 explicit path 落在 `screenshots/<env>/<topic>/` 下
- **NEVER** 讓 `browser-harness` 的 `capture_screenshot()` 不帶 path 參數 — 預設會落 `/tmp/shot.png`，user 找不到
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

## 回傳值陷阱（browser-harness）

`capture_screenshot(path)` 已經把有效 PNG 寫到 `path` 並**回傳 path 字串**（不是 base64 data）。

- **NEVER** 對回傳值做 `base64.b64decode()` — Python 預設 `validate=False`，會默默吞掉路徑裡的 `.` `/` 等非 base64 字元，把 `/tmp/shot.png` 這種輸入解出 9 byte 垃圾並覆蓋掉原本正確的檔案；呼叫**不會 raise**，症狀是 Preview 報「檔案可能已損毀」
- **NEVER** 拿回傳值再 `open(path, "wb").write(...)` — helper 已經寫好了，再寫一次只是覆蓋
- 要存自訂檔名 → 直接傳 path 當第一個參數：`capture_screenshot("/tmp/foo.png", max_dim=1800)`
- 要拿原始 base64（極少用，例如要 inline 進 IPC payload）→ 走 raw CDP：`cdp("Page.captureScreenshot", format="png")["data"]`

正確 vs 錯誤對照：

```python
# ✅ 正確
capture_screenshot("/tmp/x2-01.png", max_dim=1800)

# ❌ 錯誤（Sonnet 實測踩過：21 個檔案全變 9 byte 垃圾）
shot = capture_screenshot()
with open("/tmp/x2-01.png", "wb") as f:
    f.write(base64.b64decode(shot))   # decode path 字串！
```

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
- **NEVER** `capture_screenshot()` 不帶 path 用於人工檢查交付（路徑強制規範）
- **NEVER** `base64.b64decode(capture_screenshot(...))` — 回傳的是 path 字串，不是 base64；解碼會默默吐 9 byte 垃圾覆蓋檔案（回傳值陷阱）
- **NEVER** 把已歸檔 change 的截圖資料夾留在 `screenshots/<env>/` 頂層 — sweep 到 `_archive/YYYY-MM/` 才算完整收尾
- **NEVER** 對偵測到空狀態的頁面硬拍交付 — 走 Empty Data Handling 流程
- **NEVER** 改 component 加 fallback 假資料來填空 UI — 治標不治本
- **NEVER** 在 dev 用 ad-hoc UI / API 補資料而不沉澱進 seed 檔 — 不持久化
- **NEVER** 在 staging 未授權前自動寫資料
