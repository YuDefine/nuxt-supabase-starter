---
name: review-screenshot
description: '統一截圖入口。Use when 使用者要求截圖驗證 UI 畫面，或要跑 UI 檢查清單。NOT for 把既有截圖 sweep 進 _archive/（走 screenshots-archive），NOT for Lighthouse 稽核或 performance trace 拆解（走 chrome-devtools-mcp）。'
metadata:
  clade:
    permission_tier: read-only
---


# 截圖（統一入口）

所有四個模式（`[verify:ui]`、archive 前 QA、commit 0-B、ad-hoc）由主持者直派 **Pi Gemini 3.8 Flash**，具名列 `screenshot-review-verify`，effort `high`。截圖與 item 要求的符合性 gate 另交 **Claude Opus 5 · medium**，具名列 `screenshot-match-analysis`。

## Runtime 分流

Gemini 經 `pi-dispatch.ts` 的 `google-gemini-cli` provider 執行；brief 指向本 skill 的 [evidence contract](references/evidence-contract.md)，並提供當次可用 browser 工具、明確 URL 與允許的操作。工具未提供、登入／fixture／provider 阻塞時回報實際 blocker，保留未完成項。

Opus 5 使用 Claude Code 原生模型或已驗證的 Herdr bounded carrier。Cursor Task 的 `claude-*` catalog 不代替 Claude Code。

兩階段各有自己的 brief 與回報。Gemini 不再轉派、不代簽符合性 gate；Opus 必須讀每張指定圖片與完整 item。主 session 消費結構化結果；符合性判定者使用未參與實作的新上下文，並實際讀圖。Opus 5 無法執行時記錄實際原因，沿 `screenshot-match-analysis` 原列交 GPT-5.6 Sol（effort: high）讀圖判定。Gemini 或 Sol 不可用時保留 blocker，**NEVER** 沿 generic fallback 換成其他模型。

## Brief 注意事項

- 逐項列完整 item、exact screenshot output path、URL、ready signal 與允許操作；Approved Tools、hard budget、checkpoint、fail-fast 與 progress.json 依 evidence contract。
- 認證值不進 brief；登入前置仍依既有 dev-auth 契約，從 routing 移除取得 session 的列不改該功能。

## 觸發時機

- 「截圖」「看畫面」「幫我看 UI」「看一下頁面」
- 「review screenshot」「跑檢查清單」「截圖檢查」
- UI 實作後確認、除錯截圖
- 工作完成後視覺驗收

## 派遣方式

1. 把 Setup／Items／Output format 與 Approved Tools 寫入 brief，指定本 skill 的 evidence contract。
2. 主持者直接派出取證 worker：

```bash
node <clade-vendor>/scripts/pi-dispatch.ts \
  --brief <absolute-brief.md> --cwd <consumer-root> --label <descriptive-label> \
  --model gemini --effort high --route routing-table \
  --tier-basis table-row --table-row screenshot-review-verify --workspace-access mutation
```

3. 依 agent-routing 的 Pi watch 收割 completion 與 evidence manifest。需要符合性 gate 時，把每張實際圖片路徑與 item 交給獨立 Opus 5 dispatch；保留收集者與判定者的 requested／observed model 證據。
4. `verify:ui` 收集後由主持者依 watch protocol 呼叫 `verify-ui-receipt.ts`，寫入失敗時保持 UNCERTAIN。

下面三段是 brief 的 prompt 本體素材。

### Ad-hoc 截圖

```
prompt: |
  截圖驗證以下頁面：
  1. /path/to/page — 頁面描述
  2. /path/to/page2 — 頁面描述
  Dev server port: <port>（若已知）
```

### Review 截圖（人工檢查）

```
prompt: |
  針對 change `<change-name>` 的人工檢查清單逐項截圖驗證：

  ## 人工檢查
  - [ ] #1 實際操作功能，確認 happy path 正常運作
  - [ ] #2 測試 edge case...

  Dev server port: <port>（若已知）
```

### 除錯截圖

```
prompt: |
  除錯截圖：頁面 /path 出現 [問題描述]，需要截圖確認目前狀態。
  Dev server port: <port>（若已知）
```

## 結果處理

Agent 回傳後，主 session 應：

1. 向使用者展示摘要表格（通過/需確認/有問題）
2. 列出需要人工確認的項目及截圖路徑
3. 報告檔位置：`screenshots/<env>/<語義>/review.md`（路徑規則見 rule）

### 可採性判準（把任何一張圖當證據之前，逐張套）

任一條成立即標 **NON-EVIDENCE**，**NEVER** 列入驗收證據：

1. 畫面為空資料狀態，而被驗行為不是「空狀態分支本身」
2. 被驗行為就是空狀態分支，但拿不出同頁、同 session 產出的**非空對照圖**（證明「空」不是該身分下的預設長相）
3. 依 brief / baseline 可知改動**前**同條件下畫面相同
4. 畫面資料列數低於該 entity 的 seed plan 最小列數
5. 圖中實際渲染的分支與被驗行為不同

agent 交回的 manifest 已含 `discriminating` 欄，但**主線 MUST 自行覆核**——2026-08-19 實測失敗的正是這一段：agent 誠實揭露了「不能當驗收證據」「403 完全截不到」，主線在壓縮成拍板選項時把但書丟了，據零鑑別力的圖 land。

**Hard rule**：任何一項被標 NON-EVIDENCE 或 UNREACHABLE 時，主線**在同一段訊息內** MUST 把該標記與理由講給使用者，**NEVER** 只呈報通過項就請人拍板。UNREACHABLE 的「不可達」本身是 finding，要一起報。

通則見 `rules/core/agent-self-verification.md` § 證據鑑別力；實證見 [[pitfall-empty-state-screenshot-has-no-discriminating-power]]。

## 注意事項

- 四個 screenshot review 模式同走 Gemini 3.8 Flash；item 符合性 gate 另走 Opus 5。
- 取證 worker 的 PASS 只描述收集結果；item 由 Opus 5 或已符合 fallback 條件的 GPT-5.6 Sol reviewer 判定後才標為符合。
- 主持者保留 scope、真實 evidence、NON-EVIDENCE／UNREACHABLE 揭露與 receipt 責任。


## Runtime 執行 — Cursor

Cursor 主線在 launcher、workspace、label、identity 與 transport correlation preflight 通過後，使用 Herdr create-only `--launcher cc`／`ccw`，把 brief 交給已合格的 Claude Code `Agent`、`subagent_type: screenshot-review` carrier；brief 必須落成 durable handoff file。

完成 receipt 由派出後的子 session 回傳；在此之前不得宣稱 review 完成。**NEVER** 改用 Cursor Task 的 `model=claude-*`、generic executor、Pi、GPT/Luna 或 quota waiver，也 **NEVER** 讓執行體再轉派。
