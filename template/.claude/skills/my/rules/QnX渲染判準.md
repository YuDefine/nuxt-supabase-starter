
# Rule 1 - 渲染直接用 `flow pending` 的輸出，順序與分類 NEVER 改

- Level: `MUST`
- 渲染的唯一來源是 Phase 1 **最後一次** `flow pending` 的輸出（推進過新題就是 `ask` 之後重跑的那一次）；題目的順序、分桶與編號照它，**NEVER** 重排、併桶或改分類。
- 需要補上下文時**加在該題底下**，不要重排。
- **NEVER** 只讀 `HANDOFF.md` 就作答——它與 state 檔會漂，這正是 `flow pending` 存在的理由。
- 結尾的現況量測照用 `flow pending` 最後那一行（當下實跑，格式如 `clade: dirty 2 / worktree 3　<consumer-id>: dirty 3`，全乾淨時是 `全 roster 乾淨：…`）。**NEVER** 引用 `HANDOFF.md` 裡寫死的量測數字——過期的 dirty 數與新鮮的長得一模一樣。

## Good Example

- 這個例子是好的，因為題目順序與分桶照 `flow pending`，補充的上下文掛在該題底下，量測用當下那一行。

```md
要我拍板（2）

Q1  [<consumer-id>] 舊 sync 腳本要刪還是包相容層？  3.2h
      A. 包相容層（推薦）
      B. 直接刪
      補充：兩台客戶機的 cron 還指著舊檔
Q2  …

clade: worktree 2　<consumer-id>: dirty 3 / stash 1
```

## Bad Example

- 這個例子是壞的，因為它依自己的判斷重排成「重要的先講」，並抄了 HANDOFF 裡寫死的量測數字。

```md
最重要的先講：
Q1 （原本的 Q2）…
Q2 （原本的 Q1）…

現況（取自 HANDOFF.md）：<consumer-id> dirty 12
```

# Rule 2 - Phase 1 第 4 步新推進的題 MUST 在該題後面標 `[本輪從對話撈出]`

- Level: `MUST`
- 本輪從對話推進佇列的題，與早就登記在檔案裡的題，在 `flow pending` 的輸出裡長得一模一樣（推進去的那一刻就都是「已登記」了）。
- Charles 需要知道哪幾條是他從沒看過的，所以以 Phase 1 第 4 步記下的新 span 逐一比對，命中的題 MUST 在題目那一行後面加 `[本輪從對話撈出]`。
- 標記只加在新推進的那幾題，**NEVER** 加在原本就在佇列上的題。

## Good Example

- 這個例子是好的，因為只有 span 對得上本輪新推進那一條的題被標記。

```md
Q1  [clade] stale worktree 要現在收嗎？  0m  [本輪從對話撈出]
      A. 現在回收（推薦）
      B. 留到下一輪
      span 9d2f…41
```

## Bad Example

- 這個例子是壞的，因為新推進的題沒有標記，Charles 分不出哪一題是這輪才冒出來的。

```md
Q1  [clade] stale worktree 要現在收嗎？  0m
      A. 現在回收（推薦）
      B. 留到下一輪
```

# Rule 3 - 只有 `ruling` 與 `review` 編 `Qn`，兩組連續編號

- Level: `MUST`
- 編號依 §QnX 協定（使用者的全域指令檔；Claude 走 `~/.claude/CLAUDE.md`，其他 runtime 走各自的常駐指令檔）：只有**可回答的兩類**編 `Qn`——`ruling`（要我拍板）與 `review`（要我驗收）。
- 兩者的編號**連續**跑過去：`要我驗收` 那組接著 `要我拍板` 的最後一號往下編，**NEVER** 在第二組重新從 `Q1` 起算——「回 `Q1A Q2通過`」才是一個平坦的命名空間。
- 其餘狀態類一律 bullet，**NEVER** 編號：`要我動手`（`human-action`，含舊 `irreversible`）、`不在本 repo`、`loop 結構性推不動`，以及 `未分類`、`卡住、等人動手`。
- `flow pending` 已經照這條渲染——**NEVER** 自己替狀態類加號碼。

## Good Example

- 這個例子是好的，因為兩組可回答的題連續編號，狀態類全是 bullet。

```md
要我拍板（2）
Q1  …
Q2  …

要我驗收（1）
Q3  …

要我動手（1）
  - [<consumer-id>] NAS 的 USB 備份碟要換新的  登記於 2.0h 前
```

## Bad Example

- 這個例子是壞的，因為 `要我驗收` 從 Q1 重新起算，`要我動手` 也被編了號。

```md
要我拍板（2）
Q1  …
Q2  …

要我驗收（1）
Q1  …

要我動手（1）
Q4  NAS 的 USB 備份碟要換新的
```

# Rule 4 - `review` MUST 進 `Qn`，NEVER 因為不是選擇題就降成 bullet

- Level: `MUST`
- `review` 進 `Qn` 是因為它符合 QnX 的准入判準——回一則短訊（`通過`，或 `退回` ＋ 一句理由）就結案。
- **NEVER** 因為「它不是選擇題」把它降回 bullet：當成狀態列時，做完的工作會躺著沒人驗收。
- 題目下若出現 `⚠ 沒附「改了什麼 / 證據 / 退回會怎樣」` 或 `✎` 評語，照原樣保留在該題底下，讓 Charles 知道這題現在驗不了的原因。

## Good Example

- 這個例子是好的，因為驗收題照樣編號，回一個「通過」或「退回＋理由」就能結。

```md
要我驗收（1）

Q3  [<consumer-id>] 打卡頁改成先選班別再打卡  5.1h
      A. 通過
      B. 退回
      答案落到：HANDOFF.md
      span 1b77…0c
```

## Bad Example

- 這個例子是壞的，因為驗收題被降成狀態列，沒有可回的編號，做完的工作沒人驗收。

```md
其他狀態：
  - [<consumer-id>] 打卡頁改成先選班別再打卡（已完成，等你看）
```

# Rule 5 - QnX 三條細則以本 Rule 為唯一正本

- Level: `MUST`
- 全域指令檔的 §QnX 協定只留綁定條件與准入判準；下列三條細則以本 Rule 為唯一正本，**NEVER** 在其他檔另抄一份：
  1. `Qn` 從 `Q1` 起算。
  2. 可回覆條目與不可回覆條目 **NEVER** 混排連號——跨類連號會讓狀態列讀起來也像可回答的題。
  3. 寫了「回 `Q1A Q2A` 即可結案」這句話，就 MUST 保證每個 `Qn` 真的能這樣回：每個 `Qn` 都有選項（推薦排第一並標「（推薦）」），或明說「這題要給值」並列出要填什麼。
- `flow pending` 對「沒給選項也沒說要填什麼」的題會印 `⚠ 沒給選項也沒說要填什麼——這題現在答不了` 與 `ask-options` 指令；這種題照樣保留編號與警示，**NEVER** 在對話裡替它補一組自己猜的選項。

## Good Example

- 這個例子是好的，因為結尾那句承諾與每一題的實際可回性一致；答不了的題保留警示，不宣稱可一字結案。

```md
Q1  … A. 包相容層（推薦） B. 直接刪
Q2  … ⚠ 沒給選項也沒說要填什麼——這題現在答不了
      要選項：node vendor/scripts/flow/flow.ts ask-options 3e0a…9f

回 Q1A 即可結案；Q2 需先補選項。
```

## Bad Example

- 這個例子是壞的，因為 Q2 沒有選項卻宣稱「回 Q1A Q2A 即可結案」，且 bullet 與 Qn 混排連號。

```md
Q1  … A. 包相容層（推薦） B. 直接刪
Q2  …（沒有選項）
Q3  [<consumer-id>] NAS 的 USB 備份碟要換新的（要我動手）

回 Q1A Q2A 即可結案。
```

# Rule 6 - `要我動手` 桶帶選項的列只印 `可回：X／Y` 與 span，NEVER 加字母

- Level: `MUST`
- 「要我動手」桶裡帶選項的列，`flow pending` 在 bullet 下印 `可回：X／Y` 與 `span <id>`（**不加字母**）；渲染時照原樣保留。
- **NEVER** 替它加 A／B 字母或 `Qn` 編號——字母讀起來就是一題 `Qn`，而這一桶仍是 bullet。
- Charles 回了其中一個字，照 Phase 3 對那個 span 跑 `flow answer`（`--answer` 帶他回的那個字）。

## Good Example

- 這個例子是好的，因為動手列保持 bullet，只印可回的字與 span。

```md
要我動手（1）

  - [<consumer-id>] <consumer-id> 跑 dep batch：範圍？  登記於 1.0h 前
    → Charles 在 <consumer-id> 親自打 /version-upgrade → Outdated mode
    可回：只跑 patch／patch＋minor／這輪不跑
    span 5a90…e3
```

## Bad Example

- 這個例子是壞的，因為動手列被加了字母與編號，讀起來像一題拍板題。

```md
Q4  <consumer-id> 跑 dep batch：範圍？
      A. 只跑 patch
      B. patch＋minor
      C. 這輪不跑
```

# Rule 7 - 佇列全空就一句話講完，NEVER 硬湊

- Level: `MUST`
- `flow pending` exit 2（印 `佇列是空的。`）且 Phase 1 第 3 步沒有從對話撈出任何待決策點時，用一句話回覆佇列為空，並附上現況量測那一行。
- **NEVER** 為了「看起來有東西」把 agent 自己做得掉的事、已執行的事或進度回報湊成題目或 bullet。

## Good Example

- 這個例子是好的，因為空佇列一句話講完。

```md
佇列是空的，對話裡也沒有待你決定的事。（全 roster 乾淨：無 dirty、無 worktree、無 stash、無 lock）
```

## Bad Example

- 這個例子是壞的，因為佇列是空的卻硬湊出幾條進度與 agent 自己做得掉的事。

```md
目前沒有拍板題，不過以下供你參考：
Q1 要不要我順手跑一次 lint？ A. 要 B. 不要
  - 今天完成了 3 個 TD
```
