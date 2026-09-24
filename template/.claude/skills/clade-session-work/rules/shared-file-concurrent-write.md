---
description: 多個 session 同時寫同一個拆不開的登記簿檔（HANDOFF / tech-debt / pitfalls / ROADMAP）時的寫入紀律——什麼時候可以寫、寫之前要探測什麼、寫完要驗什麼
paths: ['HANDOFF.md', 'ROADMAP.md', 'docs/tech-debt.md', 'docs/pitfalls/**', 'packages/*/HANDOFF.md', 'packages/*/ROADMAP.md', 'packages/*/docs/tech-debt.md', 'packages/*/docs/pitfalls/**']
---
<!-- Clade native rule; source: rules/core/shared-file-concurrent-write.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# 共享單檔的並行寫入

[[session-tasks]] 用「一 session 一檔」解 lost update，那對 `tasks/` 有效。本檔管它解不掉的另一半：
**本質共享、拆不開的登記簿**——`HANDOFF.md`、`ROADMAP.md`、`docs/tech-debt.md`、`docs/pitfalls/**`。
它們的價值來自「所有人讀同一份」，分檔等於取消這個檔存在的理由。

**這條對每一個 consumer、每一個上列檔案生效**，不是只有 clade、也不是只有你手上那一個檔。

## 為什麼既有的 commit verify 接不住

`git` 對「另一個 session 用整檔覆寫，把你的段落沖掉」**零訊號**。沒有衝突、沒有警告、
`git status` 看起來完全正常，因為對 git 而言那就是一次普通的檔案內容變更。

[[commit]] § Verify hard rule 的三層驗證全部發生在 **commit 之後**，而覆寫發生在 commit **之前**：
你 Read 進來的那份、和你 Write 回去時 working tree 上的那份，中間隔了多久，就是窗口有多大。
第 3 層（`git show HEAD:<f> | grep -c`）只在你已經 commit 了才告訴你內容不見——那時對方的
覆寫早已落在 working tree 上，你的段落連 unstaged 狀態都不存在。

2026-08-27 實測：一個 session 在 <consumer-b> `HANDOFF.md` 寫入三節，另一個 session 之後重寫整檔，
三節整段消失，靠人眼比對才發現。

## 寫之前：兩條可觀察 predicate

| predicate | 動作 |
| --- | --- |
| `git status --porcelain <該檔>` **回空** | 沒有別人的未 commit 內容，照常 Read → 改 → **立刻** `git commit --only -- <該檔>` |
| `git status --porcelain <該檔>` **非空** | 有人正在寫。**NEVER 現在就把自己的段落寫進去**——先看下一節 |

第二條是本規約的重點。探測指令全 fleet 都跑得動，不依賴任何 clade 資產。
`flow who` 給得出 owner verdict（`mine` / `orphan` / `unknown`），比 `git status` 準，
但它只散到 improvement-loop 開啟的 consumer（`.clade/vendor/scripts/flow/`），
**NEVER 假設它到處都在**——判不出來時退回 `git status`。

## 檔案已被別人佔住時

**MUST 把自己的 read→write 窗口壓到最短：先談，等對方給信號，收到信號的當下才 apply、apply 完
立刻 commit。NEVER 為了「先卡位」把自己的段落預先寫進去等對方。**

預先寫進去看起來像在推進工作，實際是把兩份 in-memory 版本放進同一個檔的競賽：誰後 Write 誰贏，
而輸的那一方沒有任何機制會被告知。窗口從「幾秒」變成「對方還要多久」。

談的內容是四項，逐項都有答案才算談完：這個檔現在是誰的、對方還要多久 commit、
你這筆要不要請對方一起帶出去、對方不在時誰有權代為落地。探測與協商的逐字範本在
`vendor/snippets/concurrent-session-probe/README.md`。

代對方 commit 有前置條件，見 [[commit]] 與各 repo 自家的 ad-hoc commit 紀律——
**NEVER** 因為對方沒回應就直接把它的未完成內容 commit 進 history。

## 廣播是最終手段：准入與檢討報告（MUST）

「廣播」＝對一組候選 session 同發同一則「這是誰的」。它的成本是 N 個 session 各被中斷一次，
命中率卻可以是 0：2026-08-28 clade home 對同一組 dirty 檔廣播 4 次、19 人次，一次都沒指認出持有者。

**准入**——廣播前兩件 MUST 都成立：

1. 已跑 `flow who`（沒有 flow 的 repo 跑 cookbook 第 0 步的 transcript 歸屬查詢）
2. 它**有鑑別力**：journal 非空，且 verdict 不是全部同值（全 `unknown`／全 `orphan`）

沒有鑑別力時改做**指名探測**（只問第 0 步命中的那一個 session）或修探測層的接線，**NEVER** 直接廣播——
一個回答不了問題的探測層，不會因為問更多人就回答得出來。

**事後**——**每一次**廣播後都 MUST 出一份檢討報告（寫在該 session 的收尾輸出或 task 檔），
逐字回答「**是哪一層失效導致必須廣播**」，並把那一層的缺口登記成 TD 或 pitfall、附上編號。
**NEVER** 用「大家都回了、問題解決了」結案——廣播成功不代表失效的那一層不用修，不修就是下一次再付一次 N 人次。
檢討報告範本在 `vendor/snippets/concurrent-session-probe/README.md`。

## 寫之後

`git commit --only -- <該檔>`，然後照 [[commit]] § Verify hard rule 驗三層。
第 2 層對本檔特別重要：`git show HEAD:<該檔> | grep -c '<你剛寫的獨特字串>'` 回 0，
代表你 commit 的是別人的版本、自己的內容已被覆寫。

## Red Flags

發現自己在想這些，就是上面那條 NEVER 正要被違反：

- 「先寫進去，等一下他 commit 的時候會一起帶出去」
- 「我的段落在檔尾 append，他的在中段，不會撞」——撞的不是行，是整檔覆寫
- 「我先寫好放著，免得等一下忘記」
- 「反正我等一下就會 commit」——「等一下」的長度不由你決定

## REQUIRED 欄位

| 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `git status --porcelain <該檔>` 非空 = 有別人的未 commit 內容。**warn-only，不 block**——它是你要自己跑的探測，沒有 gate 會擋你 |
| 消費端 | 正要寫上列任一檔案的 agent（本檔，由 `paths:` 在 Read / Edit 該檔當下載入） |
| 載入路徑 | 本檔的 `paths:` gating；clade home 另有 pointer（clade 不自動載入 `rules/core/`） |

**「有沒有把 apply 延到最後一刻」不可事後量測，本條沒有 audit signal，也 NEVER 標成「已建立稽核」。**
唯一的機械訊號是上表那條探測指令，而它要靠你自己跑。
