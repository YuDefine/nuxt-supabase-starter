---
name: my
description: Charles 送出 `\my`（backslash，非 slash）或問「有哪些要我拍板」時用：列出球在他手上的待拍板題、收他的回答。收到 `\my` MUST 立刻載入本 skill 再開工。NOT for `\nx`（判收工與下一步）、交接盤點（用 handoff）、改 flow 工具本身的程式碼。
license: MIT
metadata:
  author: clade
  version: "2.0"
  clade:
    permission_tier: draft
---

<!-- clade-skill-scope: both -->

# `\my` — 待拍板佇列的 chat 互動版本

`\my` 等同「列出只有我做得了的待辦」：Charles 回到電腦時問「我不在的期間，累積了哪些**球在我手上**的事」。佇列只從 `flow pending` 讀，對話裡的待決策點要先推進佇列再渲染，回答要經 `flow answer` 落到 carrier 才算結案。

# SOP

## Phase 1 -- 收齊待拍板佇列

1. THINK 若 `CLADE_DISPATCH_ID` 非空，本 session 是被派出的 worker：**NEVER** 跑 `flow ask`、**NEVER** 出 `Qn`、**NEVER** 把題目寫進 final response 問 principal；讀取 `rules/待拍板條目寫法.md` Rule 12，把本 pane 的待決策點以 `--complete blocked --decision-for coordinator`（只有 Charles 答得了才 `charles`）回報後待命，本 skill 到此結束。
2. DELEGATE 執行 `flow pending`（指令讀 `flow指令.md` § pending），取得佇列輸出；exit 2 代表佇列為空。
3. THINK 讀取 `rules/待拍板條目寫法.md`，掃描本 session 對話中只存在於對話裡的待決策點，逐條決定題型、選項、推薦、所屬 repo 與 carrier。
4. DELEGATE 對每一條在**該題所屬 repo 的 checkout** 執行 `flow ask`（參數讀 `flow指令.md` § ask），把它推進佇列，記下新 span；推進過任何一題就重跑一次 `flow pending`，以新輸出取代第 2 步的輸出。

## Phase 2 -- 渲染成可回覆的題目

1. WRITE 先讀取 `rules/QnX渲染判準.md`、`templates/my-render.md` 與 `templates/my-render.example.md`，依骨架複製結構、參考範例改寫填位，照 Phase 1 最後一次 `flow pending` 輸出的順序與分類渲染出可回覆的題目，並為 Phase 1 第 4 步新推進的題目加上 `[本輪從對話撈出]`。

## Phase 3 -- 回答落檔

1. READ 讀取 Charles 的回覆，逐題對應到 span 與該題的 `repo` 欄位。
2. DELEGATE 對每一題執行 `flow answer`（參數讀 `flow指令.md` § answer；要先看寫入內容時加 `--dry-run`）。
3. THINK 讀取 `rules/回答落檔判準.md`，依回傳的 `ok`、`reason`、`landed`、`td_status`、`published` 與鎖種類判斷下一步。
4. READ 依 `rules/回答落檔判準.md` Rule 7 實查：`published.state` 是 `pushed`／`pr-opened` 時確認 carrier 工作區乾淨且 block 在 origin（或 PR branch）上；其餘情況確認該 repo 的 `git status --porcelain` 新增的差異只有 carrier 那一個檔，並以 `grep -n '<span_id>' <carrier>` 確認 block 已落地。

## Additional Resources

- `flow指令.md`：`flow pending`／`flow ask`／`flow answer`／`flow revise`／`flow publish-answers` 的指令、參數與回傳欄位（Phase 1 第 2、4 步與 Phase 3 第 2 步分節讀；改答案時讀 § revise；回傳 `published.state` 是 `unpublished` 時讀 § publish-answers）
