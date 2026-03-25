---
name: review-screenshot
description: '針對人工檢查清單的 todo 項目逐一截圖附註，輔助人工驗收。搭配 /spectra workflow 的 ## 人工檢查 區塊使用。'
---

# 人工檢查截圖（Review Screenshot）

針對 Spectra tasks artifact 中 `## 人工檢查` 的 todo 項目，逐一截圖並附註，產出可視覺對照的驗收報告。

## 觸發時機

- 使用者說「幫我截圖檢查」「review screenshot」「跑一下檢查清單」
- Spectra workflow 完成後，使用者想要視覺驗收
- 使用者指定特定 todo 項目要截圖（如「截圖 #3」）

## 前置條件（引用 browser-use-screenshot skill）

此 skill 的截圖能力建立在 `browser-use-screenshot` skill 之上。執行截圖前，**MUST** 先完成以下步驟（詳見 `browser-use-screenshot` skill）：

1. **找到 dev server port** — `ps aux | grep -E 'nuxt-supabase-starter.*nuxt' | grep -v grep`，不要假設 port
2. **登入測試帳號** — 依專案 auth 設定登入
3. **截圖指令** — `browser-use screenshot <path>`
4. **互動操作** — `browser-use state` → `browser-use click <index>` → `browser-use screenshot`
5. **結束清理** — `browser-use close`

若同一 conversation 已完成前置檢查，跳過直接截圖。

## 流程

### Step 1: 定位人工檢查清單

找到目前的 change 和對應的 tasks artifact：

```bash
spectra list --json
```

讀取 tasks artifact，找到 `## 人工檢查` 區塊，解析所有帶有 `#N` 流水號的 todo 項目。

如果使用者指定特定項目（如 `#3` 或 `#1~#5`），只處理指定範圍。

### Step 2: 逐項截圖

對每個可截圖的 todo 項目：

1. **判斷截圖目標** — 根據 todo 描述推斷需要截圖的頁面/狀態
   - 如 `確認 happy path 正常運作` → 截圖主要功能頁面
   - 如 `確認 loading 狀態` → 截圖 loading 中的畫面
   - 如 `確認手機響應式` → 調整視窗大小後截圖
   - 非 UI 項目（如 `vp check 通過`）→ 跳過截圖，標註「非 UI 項目」

2. **執行截圖** — 使用 browser-use CLI

```bash
# 命名規則：<change-name>-#<N>-<brief-desc>.png
browser-use screenshot temp/review/<change-name>-#<N>-<brief-desc>.png
```

3. **讀取截圖** — 用 Read tool 查看截圖內容

4. **記錄結果** — 在報告中附註觀察

### Step 3: 產出截圖報告

在 `temp/review/` 建立報告檔案 `<change-name>-review.md`：

```markdown
# 人工檢查截圖報告

> 來源：`<change-name>` | Specs: `<spec-1>`, `<spec-2>`
> 日期：YYYY-MM-DD

## 截圖結果

### #1 實際操作功能，確認 happy path 正常運作

- 狀態：✅ 通過 / ⚠️ 需確認 / ❌ 有問題
- 截圖：`temp/review/<change-name>-#1-happy-path.png`
- 附註：（觀察到的畫面描述）

### #5 vp check 全部通過

- 狀態：✅ 通過（非 UI 項目，透過 CLI 驗證）
- 驗證指令：`vp check`

## 摘要

- 通過：N 項
- 需確認：N 項
- 有問題：N 項
```

### Step 4: 回報使用者

展示報告摘要。使用者可以用「#3 的截圖有問題」這種方式溝通。

## 截圖存放規則

```
temp/review/
├── <change-name>-#1-happy-path.png
├── <change-name>-#2-edge-case-empty.png
└── <change-name>-review.md
```

- 全部存在 `temp/review/`（`temp/` 已在 `.gitignore`）
- 檔名含流水號 `#N`，方便對照

## Guardrails

- **NEVER** 對非 UI 項目強行截圖 — 用 CLI 驗證即可
- **ALWAYS** 讀取截圖後再判斷狀態，不要未看先判
- **ALWAYS** 保留截圖檔案，不要自動清除
- 截圖失敗時標註失敗原因，不要跳過
