---
description: 寫一條「要 Charles 拍板」的登記簿條目時，那條 bullet 要長成什麼形狀——四種區段 heading 的語義、拍板題的選項寫法、🟡/✅ 標記；編輯 HANDOFF.md / docs/tech-debt.md / work-loop state 時 path-scoped 載入
paths:
  - 'HANDOFF.md'
  - 'packages/*/HANDOFF.md'
  - 'docs/tech-debt.md'
  - 'packages/*/docs/tech-debt.md'
  - '.clade/work-loop/state.json'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/decision-authoring.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# 待拍板條目的寫法

**這一份是寫的人讀的。** 讀的人那一份是 [[review-gui-surface]] § `\my` 的四個檔案來源——
它規範掃描器與頁面，本檔規範**被掃的那條 bullet**。選項的 canonical 形狀以本檔為準，
[[review-gui-surface]] MUST 4 指過來。

你寫進 `HANDOFF.md` / `docs/tech-debt.md` 的一條待拍板 bullet，60 秒內會被
`vendor/scripts/flow/decision-sources.ts` 掃進 spine，出現在 `https://review-gui.<maintainer-domain>/decisions`
和 `\my` 兩個畫面上。Charles 多半在手機上讀它。**寫的人與答的人不是同一個人，中間隔著一個
解析器**——本檔存在的唯一理由是讓這三方對同一條 bullet 的理解一致。

## 拍板題的形狀（正向契約）

一條要 Charles 拍板的 bullet **是**這四個部件，照這個順序：

```markdown
- 🔴 **一句話問句** —— 為什麼需要你拍板（一句）
  - **A（推薦）第一案** —— 這樣做會怎樣
  - **B 第二案** —— 這樣做會怎樣
  - **C 第三案** —— 這樣做會怎樣
```

| 部件 | 契約 |
| --- | --- |
| 問句 | 第一段 `**粗體**`。`source_id` 由它導出，所以**改寫它 = 換一題**（見下方 § 改寫與重問） |
| 選項 | 2–4 條，**MUST 從 A 起連續**，推薦的排第一並標「（推薦）」 |
| 每條選項 | 一句「這樣做會怎樣」，不是名詞短語 |
| 縮排 | 選項是問句的 sibling bullets，彼此相鄰、同縮排 |

**沒有選項的拍板題 MUST 改寫成「這題要給值」並逐項列出要填什麼**，兩者都不成立就不要放進
待拍板區段。三者皆非的條目會以一個空白輸入框出現在手機上，看起來像可以回答，實際上不能。

### 選項行的兩種粗體寫法都可以

```markdown
  - **A**（推薦）—— 收進 rules/core/     ← 粗體只包字母
  - **A（推薦）收進 rules/core/**        ← 粗體包整段
```

兩種都解析得到。2026-08-27 之前只認第一種，而 fleet 幾乎只寫第二種——這是**解析器**遷就
寫法，不是寫法遷就解析器。

**這不代表「怎麼寫都行」**。以下每一種都解析不到，靜默退化成自由填答：

| 寫法 | 為什麼收不到 |
| --- | --- |
| `或者可以 X，也可以 Y` | 散文。**NEVER** 從散文猜選項——猜錯的選項被點下去就是一個沒人想要的答案被落檔 |
| `- **A 這樣做**` / `- **D 那樣做**` | 字母不連續。整組丟棄，**不會**只收兩條——兩條未知 N 的選項是沒人被問過的選擇題 |
| `- **A 只有這條**` | 一條不是選擇題 |
| A 在段落開頭、B 在六段之後 | 選項是相鄰的 sibling bullets，隔太遠的兩個粗體字母是散文 |
| `- **A 方案已採用**` / `- **B 案已否決**` | 在敘述已經決定的事。待拍板區段裡 **NEVER** 放已拍板的紀錄 |

## 四種區段 heading

掃描器用 heading 決定這條 bullet 落到 `\my` 的哪一桶。**MUST** 用下列語義，**NEVER** 自創同義詞：

| heading 語義 | 桶 | 什麼進得去 |
| --- | --- | --- |
| `Awaiting Charles` / `Ready for review`（球在 Charles 手上） | `ruling` | 要拍板的選擇題，或要給值的題 |
| `Blocked` / `需要 Charles 執行` | `irreversible` | 不可逆或只有人做得到的動作（實體硬體、線上帳號、密鑰輪替） |
| loop 結構性推不動 | `loop-structural` | agent 反覆撞同一堵牆，要人改結構 |
| **跨 repo** | **不進佇列** | 見下 |

**跨 repo 區段 NEVER 進待拍板佇列。** 2026-08-27 起 `categoryOfHeading` 對它回 `null`：那裡的條目
是「本 repo 不修 / 已移交」的紀錄，沒有裁決可下，開成待拍板題只會累積永遠答不掉的列
（實測一次進了 15 題）。要別的 repo 動手就去那個 repo 的登記簿寫。

## 🟡 / ✅ 標記

`- 🔴` / `- 🟡` 是「還沒解決」；`- ✅` 與 `- [x]` 是已完結，掃描器跳過。**答案落檔不會刪掉來源
bullet**（`answer.ts` 是 append），所以**答完之後 MUST 自己把那條標成完結**，否則它會一直留在
檔案裡——它不會被重問（`source_id` 已記錄答過），但下一個讀這份檔的人分不出來。

## 新問題優先走 `flow ask`

要問的題**現在**就成形時，直接開 span，不必等 60 秒掃描：

```bash
node vendor/scripts/flow/flow.ts ask "<問句>" --option "A（推薦）…" --option "B …" --carrier HANDOFF.md
```

檔案來源是給「本來就要寫進登記簿」的題用的。兩條路徑寫進的是同一個佇列。

## 改寫與重問

`source_id` 由 identity（檔案 + 問句）導出，**不由內容**。因此：

- **改寫說明、補一段 context、調整選項文字 → 同一題**，不會重問，佇列上那題的選項會在下一次
  掃描就地更新（`decision-sync.ts` 的 amend）
- **改寫問句本身 → 換一題**：舊的撤回、新的重開。要重問就改問句；**NEVER** 為了讓它重新出現
  而刪掉再貼回——刪掉那一刻它會被記成 `retracted`（來源消失），不是被裁決

## 編輯既有不合格條目時 MUST 順手轉正

**每一次**編輯一條已經在待拍板區段、但不符本檔形狀的 bullet 時，都 MUST 一併把它改成合格形狀，
不是只改你本來要改的那一部分。這條對**每一條**這樣的 bullet 生效，不是只有你正在處理的那一條。

`/decisions` 卡片與 `\my` 輸出會對這類條目印一行 `✎ 來源檔有幾行差一點就是選項`——那一行的
收件人就是下一個編輯該檔的 agent，也就是你。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | item 落 ruling 桶且無選項（`no-options-under-ruling`），或 body 含差一點就解析成功的行（`near-miss-option-line`）。**warn-only，不 block**——HANDOFF 是高頻活文件，把寫法卡在寫入路徑上換到的是一個 bypass flag，不是更好的 bullet |
| 消費端 | `/decisions` 卡片（答題的 Charles）＋ `flow pending` 輸出（下一個編輯該檔的 agent） |
| 載入路徑 | 本檔，paths-gated 到 `HANDOFF.md` / `docs/tech-debt.md` / work-loop state——也就是寫這種條目的當下 |
