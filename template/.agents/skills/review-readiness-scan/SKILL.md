---
name: review-readiness-scan
description: 掃描 openspec/changes/ 各 change 的 manual-review 區塊，判斷哪些已 ready for 人工檢查、哪些被 Pre-Review Data Readiness pattern 命中（alert）尚未 ready，並把結果登記到 HANDOFF.md。Use when 使用者說「掃 review readiness」「review:ui 哪些 ready」「scan manual review alerts」「批次人工檢查前先看哪些 ready」「找出 review:ui 的 alert」。不適用於單一 change 內逐項 review（那走 `pnpm review:ui` GUI）。
license: MIT
metadata:
  author: clade
  version: "1.0"
---

# review-readiness-scan

主動掃描 consumer 端所有 active change 的 `## 人工檢查` 區塊，把「已 ready / 尚未 ready」分組寫入 `HANDOFF.md`，讓使用者能在合適時機**批次**跑 `pnpm review:ui`，而不是每條 change 個別開 GUI 才知道沒準備好。

**前置**：consumer 必須已從 clade 散播到 `scripts/review-gui.mts`（5 consumer 預設都有；若沒有，跑 `pnpm hub:check` 確認）。

## Step 1 — 跑 headless scan

```bash
pnpm exec tsx scripts/review-gui.mts --scan
```

輸出 JSON（schema: `review-readiness-scan/v1`）到 stdout，結構：

```jsonc
{
  "schema": "review-readiness-scan/v1",
  "generatedAt": "<ISO8601>",
  "repoRoot": "<abs>",
  "counts": { "ready": N, "notReady": M },
  "ready":    [ { "name": "<change>", "pending": N, "issued": N, "total": N } ],
  "notReady": [ { "name": "<change>", "pending": N, "issued": N, "total": N,
                  "readinessHits": N, "malformed": N,
                  "hitsByCode": { "UI_ITEM_NO_URL": 2, "REVIEW_UI_BACKEND_ROUNDTRIP": 1 } } ]
}
```

> Tsx / hono 沒裝 → script 會先報 missing dep。讓 user 跑 `pnpm add -D tsx hono`，不要自動安裝。

## Step 2 — Patch HANDOFF.md 固定 section

HANDOFF.md 用 marker 包夾，每次重跑**覆蓋同一段**（不累積垃圾，不留時戳 entries）：

```markdown
<!-- BEGIN: review-readiness-scan -->
## Manual Review Readiness（auto-scan）

> 最後掃描：<generatedAt>　|　ready: N　not-ready: M

### ✅ Ready for review（N changes）

可批次跑 `pnpm review:ui` 處理：

- `<change>` — pending N/total
- ...

### ⚠ Not yet ready — needs data fix（M changes）

下列 change 含 Pre-Review Data Readiness alert，**先補資料再 review**（patterns 詳見 `vendor/snippets/manual-review-enforcement/patterns.json`）：

- `<change>` — pending N · ⚠ N hits: UI_ITEM_NO_URL ×2, REVIEW_UI_BACKEND_ROUNDTRIP ×1
- ...
<!-- END: review-readiness-scan -->
```

### 寫入規則

1. **HANDOFF.md 不存在**：建立 HANDOFF.md 並把 section 放在檔尾
2. **HANDOFF.md 存在、有舊 marker**：用 BEGIN/END 之間整段覆寫，**保留** marker 外的所有內容
3. **HANDOFF.md 存在、無 marker**：append 到檔尾（前面空一行）
4. **ready 與 notReady 都為 0**：仍寫入 section，但內容改成 `> 目前無含人工檢查區塊的 active change。`，讓 user 看到 skill 跑過、不是漏跑

### 不該做

- ❌ 不要刪 HANDOFF.md 其他段落（即使看起來過時）
- ❌ 不要在 ready 段落 append 額外備註、推測 user 接下來該做什麼 — section 是純資料，主線判讀
- ❌ 不要因為 hitsByCode 命中某個 code 就**自動修 tasks.md**（修法走 `/spectra-ingest`，由 user 拍板）

## Step 3 — 主線報告

寫完 HANDOFF.md 後，給 user 一段精簡 summary：

```
Scanned at <generatedAt>:
  ✅ Ready  (N): change-a, change-b
  ⚠  Need fix (M): change-c (3 hits), change-d (1 hit)

HANDOFF.md updated（section: Manual Review Readiness）。
建議：對 ready 那群跑 `pnpm review:ui` 批次處理；需要 fix 的先看 hitsByCode 補資料再 rescan。
```

**不要**主動跑 `/spectra-ingest`、不要主動修 tasks.md、不要推薦 schedule。User 拍板下一步。

## 何時 NOT 觸發

- 使用者只想跑單一 change 的人工檢查 → 直接 `pnpm review:ui`，不需要 scan
- 使用者問「現在有哪些 active change」這類純列表 → 用 `spectra list`，scan 是 readiness 評估不是 change 列表
- consumer 沒有 `openspec/changes/` 目錄（非 spectra 專案）→ scan 會輸出空，回 user 「此專案沒有 openspec/changes/，跳過」

## 邊界與已知限制

- Scan 只看 `openspec/changes/<name>/tasks.md` 的 `## 人工檢查` section，**不**讀 parked changes（spectra parked 那群會被排除）— 因為 parked 通常是暫存不在動的，readiness 評估無意義
- hitsByCode 用的 pattern 規格存在 `vendor/snippets/manual-review-enforcement/patterns.json`，與 review-gui banner、`post-propose-manual-review-check.sh` 共用同一份 source-of-truth
- 截圖資料夾數（screenshotTopicCount）**不**影響 readiness 判斷 — 截圖缺失屬於 GUI 內 banner（red verify-channel evidence-missing），不在 Pre-Review Data Readiness 範疇
