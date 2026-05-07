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
- `<topic>`：`review/` / `debug/` / `<change-name>/`
- 評估報告可放 `review.md`

## 路徑強制規範（hard rule）

凡是給人工檢查、design review、debug 給 user 看的截圖：

- **MUST** 用 explicit path 落在 `screenshots/<env>/<topic>/` 下
- **NEVER** 讓 `browser-harness` 的 `capture_screenshot()` 不帶 path 參數 — 預設會落 `/tmp/shot.png`，user 找不到
- `/tmp` 只允許 agent 內部 sanity check（拍完當場 `Read` 自己看，不交付給 user）

換句話說：任何要交付給 user 的截圖路徑必須是 `screenshots/<env>/<topic>/...`，不能漂走。

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
- **NEVER** 把已歸檔 change 的截圖資料夾留在 `screenshots/<env>/` 頂層 — sweep 到 `_archive/YYYY-MM/` 才算完整收尾
- **NEVER** 對偵測到空狀態的頁面硬拍交付 — 走 Empty Data Handling 流程
- **NEVER** 改 component 加 fallback 假資料來填空 UI — 治標不治本
- **NEVER** 在 dev 用 ad-hoc UI / API 補資料而不沉澱進 seed 檔 — 不持久化
- **NEVER** 在 staging 未授權前自動寫資料
