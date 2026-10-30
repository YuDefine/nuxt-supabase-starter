---
name: my
description: Charles 送出 `/my` 或問「有哪些要我拍板」時用：列出球在他手上的待拍板題、收他的回答。NOT for `/nx`（判收工與下一步）、交接盤點（用 handoff）、改 flow 工具本身的程式碼。
license: MIT
metadata:
  author: clade
  version: "3.0"
  clade:
    permission_tier: draft
---


# `/my` — 待拍板佇列的 chat 互動版本

`/my` 等同「列出只有我做得了的待辦，並陪我快速、詳細地消化」：Charles 回到電腦時問「我不在的期間，累積了哪些**球在我手上**的事」。佇列只從 `flow pending` 讀，對話裡的待決策點要先推進佇列；呈現時先分組給 Charles 挑，再一組一組帶著討論；回答要經 `flow answer` 落到 carrier 才算結案。

# SOP

## Phase 1 -- 收齊待拍板佇列

1. THINK 若 `CLADE_DISPATCH_ID` 非空、且派工 brief 沒有指派本 pane 陪 Charles 消化待拍板佇列，本 session 是被派出的 worker：**NEVER** 跑 `flow ask`、**NEVER** 出 `Qn`、**NEVER** 把題目寫進 final response 問 principal；讀取 `rules/待拍板條目寫法.md` Rule 12，把本 pane 的待決策點以 `--complete blocked --decision-for coordinator`（只有 Charles 答得了才 `charles`）回報後待命，本 skill 到此結束。
2. DELEGATE 執行 `flow pending`（指令讀 `flow指令.md` § pending），取得佇列輸出；exit 4 代表佇列為空（`FLOW_CLI_CONTRACT=2`）。
3. THINK 讀取 `rules/待拍板條目寫法.md`，掃描本 session 對話中只存在於對話裡的待決策點，逐條決定題型、選項、推薦、所屬 repo 與 carrier。
4. DELEGATE 對每一條在**該題所屬 repo 的 checkout** 執行 `flow ask`（參數讀 `flow指令.md` § ask），把它推進佇列，記下新 span；推進過任何一題就重跑一次 `flow pending`，以新輸出取代第 2 步的輸出。

## Phase 2 -- 分組並給 Charles 挑先談哪組

1. THINK 讀取 `rules/分組討論判準.md`，以 Phase 1 最後一次 `flow pending` 的輸出為準，先查證各題與各條動手列的前提（PR 是否已合入、同一件事是否兩題、是否已在別處答過、帶 `⏳ 疑似過時` 的題、`要我動手` 的事是否早已做完），再依該檔的分組軸與排序把 `flow pending` 每一桶的每一列分進恰好一組（含「要我動手」與其餘狀態桶），並記下 `Qn` ↔ span ↔ repo 的對照。
2. WRITE 先讀取 `rules/QnX渲染判準.md`、`templates/my-render.md` 與 `templates/my-render.example.md`，依骨架的〈分組總覽〉段複製結構、參考範例改寫填位，渲染分組總覽：每組一句話說在決定什麼與建議答法、每題一行附推薦、建議先談哪一組；Phase 1 第 4 步新推進的題加 `[本輪從對話撈出]`；佇列全空時只輸出一句話並結束本 skill。
3. READ 讀取 Charles 挑的組；他直接作答就跳到 Phase 3，說他已在別處答了一部分就回 Phase 1 第 2 步重跑 `flow pending` 再重出總覽。

## Phase 3 -- 逐組討論、逐題落答

1. THINK 對 Charles 挑的那一組，先依 `rules/分組討論判準.md` 實查每題的現況（PR、CI、plan、spine 上的舊答案）；沒選項的題先跑 `flow ask-options`（`flow指令.md` § ask-options；別 repo 的題帶 `--repo`）向出題者要選項，**NEVER** 替題目自己猜答案。
2. WRITE 依 `templates/my-render.md` 的〈單組討論〉段渲染這一組：每題附現況、選項與各自後果、推薦與理由，結尾給一次回完的範例；一次只出一組。
3. READ 讀取 Charles 的回覆，逐題對應到 Phase 2 第 1 步記下的 span 與該題的 `repo` 欄位；他插問題外話時先查證回答，再回到這一組。
4. DELEGATE 對每一題執行 `flow answer`（參數讀 `flow指令.md` § answer；寫入要帶 `--apply`，不帶就只預演寫入內容）；Charles 同意寫掉的重複或過時題以 `flow dismiss`（`flow指令.md` § dismiss；同樣要帶 `--apply`）寫掉。
5. THINK 讀取 `rules/回答落檔判準.md`，依回傳的 `ok`、`reason`、`landed`、`td_status`、`published` 與鎖種類判斷下一步。
6. READ 依 `rules/回答落檔判準.md` Rule 7 實查：`published.state` 是 `pushed`／`pr-opened` 時確認 carrier 工作區乾淨且 block 在 origin（或 PR branch）上；其餘情況確認該 repo 的 `git status --porcelain` 新增的差異只有 carrier 那一個檔，並以 `grep -n '<span_id>' <carrier>` 確認 block 已落地。
7. THINK 重跑 `flow pending` 確認答過的題已離開佇列，向 Charles 報這組落了哪幾題、剩幾題，以及答案帶出的後續工作交給誰（依 `rules/分組討論判準.md`）；還有組沒談且 Charles 沒說結束，就回本 Phase 第 1 步帶下一組，否則列出已答與未答清單後結束。

## Additional Resources

- `flow指令.md`：`flow pending`／`flow ask`／`flow answer`／`flow revise`／`flow publish-answers` 與 `flow ask-options`／`flow dismiss` 的指令、參數與回傳欄位（Phase 1 第 2、4 步與 Phase 3 第 1、4 步分節讀；改答案時讀 § revise；回傳 `published.state` 是 `unpublished` 時讀 § publish-answers）
