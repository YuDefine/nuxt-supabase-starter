---
name: review-archive
description: '將已完成的人工檢查項目從 tasks artifact 遷移到 docs/manual-review-archive.md，保留追溯資訊。'
---

# 人工檢查歸檔（Review Archive）

將已完成（`[x]`）的人工檢查項目從 tasks artifact 遷移到歸檔檔案。

## 觸發時機

- 使用者說「歸檔檢查」「archive review」「#1~#3 做完了」
- Spectra change 歸檔前，整理人工檢查結果

## 輸入

- 可指定範圍：`/review-archive #1~#5` 或 `/review-archive all`
- 未指定範圍時，遷移所有 `[x]` 項目

## 流程

### Step 1: 定位 tasks artifact

```bash
spectra list --json
```

讀取目前 change 的 tasks artifact，找到 `## 人工檢查` 區塊。

### Step 2: 識別要歸檔的項目

- 如果使用者指定範圍（如 `#1~#3`）→ 取該範圍的項目
- 如果使用者說 `all` → 取所有項目
- 未指定 → 只取 `[x]` 已完成的項目
- 如果指定的項目尚未勾選 `[x]`，用 request_user_input 確認是否要標記完成並歸檔

### Step 3: 寫入歸檔

讀取 `docs/manual-review-archive.md`，在 `---` 分隔線後插入新區塊（最新的在最上面）：

```markdown
## YYYY-MM-DD — `<change-name>`

> Specs: `<spec-1>`, `<spec-2>`

- [x] #1 實際操作功能，確認 happy path 正常運作
- [x] #2 測試 edge case — ⚠️ 空資料時缺少提示（已修）
- [x] #3 確認手機/平板響應式顯示正常
```

- 保留每個項目的 `#N` 編號
- 如果項目有附註（如截圖報告中的觀察），一併帶入
- 截圖檔案路徑不寫入歸檔（截圖在 screenshots/local/ 可能被清除）

### Step 4: 更新 tasks artifact

已歸檔的項目在 tasks artifact 中保持 `[x]`，不刪除。
如果所有項目都歸檔了，在區塊末尾加一行：

```markdown
> ✅ 全部歸檔於 YYYY-MM-DD → docs/manual-review-archive.md
```

### Step 5: 回報

```
已歸檔 N 項人工檢查到 docs/manual-review-archive.md：
- #1 實際操作功能 ✅
- #2 edge case ✅
- #3 響應式 ✅
```

### Step 6: 提示截圖歸檔

歸檔完成後 prompt 使用者：

> 已歸檔 N 項人工檢查。要不要順手把對應截圖資料夾 sweep 到 `screenshots/<env>/_archive/`？
> 執行 `/screenshots-archive change <change-name>` 即可。

**目的**：讓 `screenshots/<env>/` 頂層只剩 current pending review，user 一眼能找到「現在要做人工檢查的是哪個」。

## Guardrails

- **NEVER** 刪除 tasks artifact 中的人工檢查項目 — 只標記 `[x]` 和加歸檔註記
- **NEVER** 歸檔未確認的項目 — 除非使用者明確同意
- **ALWAYS** 保留 `#N` 編號和來源追溯資訊
- **ALWAYS** 在歸檔前確認 `docs/manual-review-archive.md` 存在
