---
description: 寫一條「要 Charles 拍板／驗收」的登記簿條目時，那條 bullet 要長成什麼形狀——區段 heading 的語義與分桶、拍板題的選項寫法、Ready for review 的三欄契約、🟡/✅ 標記；編輯 HANDOFF.md / docs/tech-debt.md / work-loop state 時 path-scoped 載入
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

### 選項行的三種粗體寫法都可以

```markdown
  - **A**（推薦）—— 收進 rules/core/     ← 粗體只包字母
  - **A（推薦）收進 rules/core/**        ← 粗體包整段
  - **A（推薦）**：收進 rules/core/      ← 粗體包字母與標記，正文在外
```

三種都解析得到。2026-08-27 之前只認第一種，而 fleet 幾乎只寫第二種；第三種到 2026-08-29
之前**匹配得到但讀錯**——手機上顯示成 `A. ：收進 rules/core/（推薦）`，冒號外洩、推薦標記被
搬到句尾。這是**解析器**遷就寫法，不是寫法遷就解析器。

### 選項換行沒有關係，但 NEVER 讓它跨出縮排

一條選項寫不下換行，續行照樣算同一條選項——**條件是續行縮排比該 bullet 深、且自己不是
新的 list item**。2026-08-29 之前續行整段丟失：<consumer-a> 的 A 案在手機上停在
「…改記到 TD-296 —— 折進去要動」，說明代價的那半句在下一行，沒有刪節號、沒有任何訊號。
**在被截斷的選項之間拍板，比排版難看嚴重得多。**

續行上限 3 行。要寫更長就把它拆成問句本文的說明——選項是按鈕的標籤，不是段落。

**這不代表「怎麼寫都行」**。以下每一種都解析不到，靜默退化成自由填答：

| 寫法 | 為什麼收不到 |
| --- | --- |
| `或者可以 X，也可以 Y` | 散文。**NEVER** 從散文猜選項——猜錯的選項被點下去就是一個沒人想要的答案被落檔 |
| `- **A 這樣做**` / `- **D 那樣做**` | 字母不連續。整組丟棄，**不會**只收兩條——兩條未知 N 的選項是沒人被問過的選擇題 |
| `- **A 只有這條**` | 一條不是選擇題 |
| A 在段落開頭、B 在六段之後 | 選項是相鄰的 sibling bullets，隔太遠的兩個粗體字母是散文 |
| `- **A 方案已採用**` / `- **B 案已否決**` | 在敘述已經決定的事。待拍板區段裡 **NEVER** 放已拍板的紀錄 |

## 區段 heading 與分桶

掃描器用 heading 決定這條 bullet 落到 `\my` 的哪一桶。**MUST** 用下列語義，**NEVER** 自創同義詞：

| heading 語義 | 桶 | 什麼進得去 |
| --- | --- | --- |
| `Awaiting Charles`（球在 Charles 手上） | `ruling` | 要拍板的選擇題，或要給值的題 |
| `Ready for review`（做完了，等看一眼） | `review` | 已完成、等驗收的工作。**MUST 帶三欄**，見下節 |
| `需要 Charles 執行` | `human-action` | 只有人做得到、而**終點不是一句回覆**的動作（實體硬體、線上帳號、密鑰輪替） |
| loop 結構性推不動 | `loop-structural` | agent 反覆撞同一堵牆，要人改結構 |
| **跨 repo** | **不進佇列** | 見下 |
| **`Blocked`** | **不進佇列** | 見下 |

**分桶的軸只有一條：這一列怎麼離開佇列。** NEVER 是重要性、也 NEVER 是可逆性。

- 被**一句短回覆**結掉 → `ruling` / `review`（編 `Qn`、給輸入框）
- 被**別處的一個動作**結掉 → `human-action`（給動作行，不給編號）
- 被**結構改動**結掉 → `loop-structural`

「可回答」是這條軸的**衍生屬性**（`ANSWERABLE`），**NEVER** 是第二條正交的軸——把它讀成正交
會讓下一個加 category 的人去做一個 2×2 矩陣，而那個矩陣有兩格是空的。`human-action` 這個名字 2026-08-28 取代 `irreversible`——
舊名描述的是 heading 規則而不是讀的人要做什麼。spine 是 append-only，舊 span 上的 `irreversible`
由 `bucketOf` 在渲染時摺進 `human-action`，**NEVER** 改寫既有 span 的 `category`。

**跨 repo 與 `Blocked` 兩個區段 NEVER 進佇列。** 跨 repo 2026-08-27 起回 `null`：那裡的條目是
「本 repo 不修 / 已移交」的紀錄，沒有裁決可下（實測一次進了 15 題）。`Blocked` 2026-08-28 起
同樣回 `null`，理由同型——它敘述的是**工作為什麼停住**，球依 fleet 自己的慣例不在讀者手上；
實測 15 列有 9 列來自它，**零列寫得出 Charles 的動作**。

**NEVER 把 `Blocked` 重新收進來，也 NEVER 改用區段內文的關鍵字啟發式。** 真的要人動手時，
fleet 已經有明確的家：`Awaiting Charles`（拍板）、`Ready for review`（驗收）、
tech-debt 的 `### 需要 Charles`、tasks 的 `deferred-user-only`。寫進那四個之一，不要寫在 `Blocked`
底下期待有人看到。

## `Ready for review` 的三欄（正向契約）

**每一個** consumer 的 **每一條** `Ready for review` 條目，**MUST** 在它自己的 bullet 底下帶滿
這三行——不是「盡量」、不是「重要的那幾條」、不是「等有空補」：

```markdown
- [ ] **<change 名或一句標題>**
  - 改了什麼: <一句，講行為不是講檔名>
  - 證據: <可點的東西——preview URL / commit hash / repo 相對路徑>
  - 退回會怎樣: <一句，講退回的代價>
```

**分不出 `review` 還是 `human-action` 時，問這一題：證據能不能被壓成「30 秒可開的東西」。**
能（preview URL / commit / 一段輸出）→ `review`。不能——要人手、要實體裝置、要只有你有的帳號
——→ `human-action`。<consumer-a> 的 LINE 手機真機驗收是後者：它的終點是「你拿手機做一件事」，verdict
只是副產物，寫進 `Ready for review` 會永遠掛 `missing-evidence` 而無限退回（手機握在手上這件事
沒辦法變成可點證據）。

三欄各自回答驗收的人在回覆之前一定要先答的一個問題：**我在不在乎**（改了什麼）、**我三十秒內
看得完嗎**（證據）、**我說不的代價是什麼**（退回會怎樣）。缺任一欄這條就驗不了，所以
**NEVER** 放寬成「三選一」或「有寫就好」。

**證據 NEVER 寫「見 HANDOFF」、change 名字、或任何要對方再跳一次的指標。** 那正是這條契約要
刪掉的成本：2026-08-28 實測，佇列上 7 條 ready-for-review 全部只有標題與一個 carrier 路徑，
每條都要人自己去開 repo、找 change、跑起來，於是每條都躺了 10.8–16.6 小時沒人動。

三欄沒寫齊的條目**照樣進佇列**，但會掛上 `missing-evidence` 並由掃描端自動退回給你補件。
**這是刻意的**：擋在佇列外會讓做完的工作徹底隱形——你不會發現自己少填，Charles 不會知道有東西
在等——比一條躺著的列更糟。

> 這一節之前不存在，而上面那張表當時寫著 `Ready for review` → `ruling`（可回答），
> `categoryOfHeading()` 實際回的卻是 `irreversible`（每個渲染端都印「這條是狀態不是問題」）。
> 規約承諾可回答、實作交付不可回答，兩邊各自自洽了好幾個月。**改分桶語義時 MUST 同時改這張表
> 與 `categoryOfHeading()`**——它們是同一件事的兩半，只改一半不會有任何東西報錯。

## 「通過」有兩種，NEVER 讓佇列那一種代替另一種

同一條 change 有兩個各自獨立的通過，它們的**終點不同**：

| 哪一種 | 誰記錄 | 一句「通過」結掉的是什麼 |
| --- | --- | --- |
| 佇列的 `Ready for review` → `通過` | spine 上的 span，答完那條就離開 `\my` / `/decisions` | **方向 OK、可以進 review inbox** |
| `tasks.md` 的 `[review:ui]` checkbox | 那個 checkbox 自己，經 /review inbox 寫回 | **人真的在瀏覽器把那一頁開起來看過了** |

**答佇列 NEVER 等於驗收。** 2026-08-29 <consumer-a> 實測：四條 ready-for-review 全部已被答
「A. 通過」（span `c99f0d2acd529afc` / `07635ab2db246bc5` / `8bef7118645c7121` /
`5ad93c75982be99c`），而 `retire-legacy-employee-route-cluster` 的 9 項 `[review:ui]`
（`#1 /my/clock` 到 `#9 /my/salary`）一項都沒勾。答完那條就從佇列消失，9 項留在
`tasks.md`，**沒有任何畫面會再提醒任何人**——真正 user-only 的驗收工作靜默消失了。

所以寫 `Ready for review` 條目時：**條目指向的 change 若還有沒勾的 `[review:ui]`，那條
NEVER 是佇列的題。** 掃描端會偵測到並掛 `belongs-on-review`，且**不**替它合成 通過／退回
——一鍵通過正是讓瀏覽器驗收靜默消失的那個按鈕。條目照樣留在佇列（**NEVER** 擋掉：擋在
佇列外會讓做完的工作徹底隱形，同上一節的理由），但它渲染成沒有選項的條目，lint 說明那條
的 verdict 在哪裡。

**偵測讀的是 checkbox，NEVER 是散文。** 舊版只認「條目本文同時出現『人工檢查』四個字 ＋
change 名字」——那問的是**作者有沒有打那三個字**，而上面四條全部沒打、全部逃掉。判準
MUST 是 `openspec/changes/<name>/tasks.md` 裡還有幾項未勾的 `[review:ui]`：那是「這件事
驗了沒」本身，不是它的代理。判定器 `changesWithOpenManualReview()`
（`vendor/scripts/flow/decision-sources.ts`）。

**NEVER 把未勾的 `[review:ui]` 各開一條進佇列。** 一條 change 的 17 項瀏覽器驗收是**一趟**
差事，拆成 17 列就是 17 則推播問同一件事——同 `scanTasks` 對 deferred 子步驟已經寫明的理由。
它們的家是 /review inbox，不是這裡。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 條目指向的 live change 有 ≥1 項未勾 `[review:ui]` → `belongs-on-review` lint ＋ 不合成 通過／退回。**warn-only，不 block** |
| 消費端 | 寫該條目的 agent（看到 lint 就把它移回 /review 流程）＋ `/decisions` 與 `flow pending` 上的 Charles（看到沒有通過鍵就知道要去 /review 逐條驗） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`） |

## 驗收：已經出版的，NEVER 再問一次

一件 work 做完之後佇列會問「驗收？」。但那件工作若**已經隨版本 tag 出版、散播到全 fleet 且零
失敗**，再問人的就不是一個決定，是一個已經發生的事實。2026-09-03 實測：41 條待拍板裡有 18 條
是這個形狀（Phase 3.5 / C / 5a / 4′ / TD-853…，全部隨 v1.11.130–v1.12.8 出版）。

所以佇列自己把它收下：`flow sources --apply` 對每件 `done` 的工作查三格證據，三格全中就寫一筆
`work.accept`（`actor: system`、`reason: landed <tag>`、`payload.accepted_by: 'landing'`），那一列
從此不再出現。三格是：

1. `commit:<sha>` 這個憑證在本 repo 存在
2. 它已經 push（至少一個 remote-tracking ref 包含它）
3. 它落在一個 `v<semver>` tag 裡，而**那一版的 propagate journal 有紀錄、且每一台 consumer 都真的
   收到了那一版**

**代替人按的是證據，NEVER 是判斷。** 三格全部由 git 與 propagate 自己的 journal 回答，沒有一格
是誰的意見。`flow accept`（人按的那條路徑）行為完全不變。

**NEVER 對沒有 landing 證據的 work 自動 accept**，包括「我看它做完了」「pane 回 success 了」
「commit 已經在 main 上了」——最後那句最像：進了 main 不等於出版，而**沒有第 3 格的 accept
正是這條規則存在要防的東西**。

**NEVER 把「找不到證據」讀成「大概沒事」。** 判定 fail-closed：三格缺一就照樣問人。第 3 格的
journal **0 筆不是零失敗**——目錄不存在代表「這一版沒有散播紀錄」，而不是「散播得很乾淨」。

第 3 格的 status 判定 **MUST 是 allow-list**（「只有這幾種算送達」），**NEVER 是 deny-list**
（「這幾種算失敗」）：漏列一種的預設就是放行，而放行的那一邊是一個終態、append-only 的
`work.accept`。逐字只有兩種算送達：

- `bumped` —— commit 建了、push 了、remote 確認過
- `skipped` **且那台 consumer 的 origin 上那份 `.claude/hub.json` 版本已到達該 tag**——`skipped`
  在 journal 裡分不出五種來源（缺 hub.json / `--resume` 已驗 / unmerged / dirty / 無 drift），
  所以去問那台自己停在哪一版。**全 skipped 而版本沒到 = 無證據**。版本讀的是
  `git show @{upstream}:.claude/hub.json`，**NEVER** 讀磁碟、**也 NEVER** 讀 HEAD：
  - 磁碟：propagate 先寫 hub.json 才跑投影同步，同步失敗時磁碟領先而那台的 origin 什麼都沒收到
  - HEAD：journal 是整檔覆寫，同一版第二趟跑時那一列會從 `push-withheld` 被蓋成 `skipped`；
    此時 HEAD 到版而 origin 從頭到尾沒收到，`push-withheld` 判成無證據、換個 status 名字就放行
  - **NEVER** 改寫成「HEAD 到版 ＋ HEAD 已 push」：consumer 的 main 領先 origin 幾個本機 commit
    是常態（2026-09-03 實測 fleet 只有 <consumer-b> 的 HEAD 在 remote-tracking ref 內），那樣寫會對每一台
    回 false，而衰減成永遠 false 的判準與「沒有實作」事後不可區分
  - 沒設 upstream / 讀不到 → 無證據（fail-closed）。remote-tracking ref 落後的方向是少報送達

其餘全部不算，包含 `push-unconfirmed`（commit 在本地、origin 沒收到）、`bumped-local`（投影落地
但沒 commit）、`push-withheld`（刻意不 push）。**NEVER** 用「那一趟是 `--no-push`，不算它的錯」
放行 `push-withheld`：一趟沒有 push 的 propagate 就是沒把東西送到 consumer 的 origin，那一版
**沒有證據是正確的量測**，不是待修的缺陷。

沒有 landing 證據的驗收列（consumer 端工作、docs-only、還沒發版的）**同一個 repo 合併成一張卡**：
一次問「全收 / 逐條 / 還沒」，選「逐條」才展開成 N 題。**NEVER** 把合併讀成「一次收掉一批沒看過
的東西」——卡片逐條列出是哪幾件，而「逐條」是三個選項之一。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 三格證據全中 → `flow sources --apply` 寫 `work.accept`，佇列不再排那一列。**不 block**，只少問 |
| 消費端 | `flow pending` 與 `/decisions`（同一支 `buildDecisionQueue`）；`flow accept` 保留給人 |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`）；判定器 `vendor/scripts/flow/landing.ts` |

## 🟡 / ✅ 標記

`- 🔴` / `- 🟡` 是「還沒解決」；`- ✅` 與 `- [x]` 是已完結，掃描器跳過。**答案落檔不會刪掉來源
bullet**（`answer.ts` 是 append），所以**答完之後 MUST 自己把那條標成完結**，否則它會一直留在
檔案裡——它不會被重問（`source_id` 已記錄答過），但下一個讀這份檔的人分不出來。

### 自述結案 = 離開待拍板段

條目本文自己說了「已拍板 A」「已完結，供後續參考」「已隨 relay-4 落地」，那一條就不是題目，
即使它還坐在待拍板 heading 底下。掃描端據此判 `self-closed`，**不鑄 span**——那條進不了佇列。

**NEVER 把 `self-closed` 讀成「所以不用管它」。** 它會一直被掃到、一直被判成結案、一直不進
佇列，直到有人把它搬走：`flow sources` 每輪印一行「N 條自述結案的條目仍在待拍板段」，收件人
就是下一個編那份檔的人。**MUST 搬到參考段或刪掉**，理由與上一段是同一條——留在原地的話，
下一個讀這份檔的人分不出它是不是還在等誰。

判準只讀**標題 ＋ 第一段**（空行之前的內文），而且要求**沒有**未勾的 checkbox、**沒有**未答的
選項。三個條件同時成立才算：一條寫著「已拍板 A，接下來要決定 B / C」的條目仍然是題目，而只看關鍵字會把它吃掉。整條 body
搜也不行——一條真的在問「要不要照上次那個已拍板的做法辦」的題會因為引用自己的歷史而被判成結案。
兩道否決與只讀第一段是同一條理由：**被誤判的代價是一題永遠不會被問，比多問一題重得多。**

題目訊號**只算結案語之後、同一行內**的那幾個疑問詞。結案語之前的「是否 / 要不要」描述的是被
結掉的那個題目本身（「當場查額度**是否**恢復 —— 已拍板 A」是結案，不是提問），換行之後的那些
在描述作法（「看 `usageExceeded` **是否**轉 false」是一個動作）。**明說「接下來要決定 / 待你
拍板」的跨行照樣算**——那幾個詞沒有第二種讀法。
**NEVER 加關鍵字啟發式擴充這張表**——同 `docs/tech-debt.md` 那條 NEVER 的理由：「拍板」二字在
登記簿裡出現幾十次，幾乎全是在講別的條目。

agent 代收也有正路了：`flow dismiss <span_id> --reason '<為什麼不再需要人>' [--repo <name>]`
寫一筆 `decision.dismiss` 並在 carrier 條目行首加 `✅ dismissed: `。**NEVER** 手動去改 carrier
的那一行而不寫事件——一條從佇列上消失而沒有任何東西寫下來的題，與從來沒被掃到長得一模一樣。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 標題＋第一段命中結案語 ＋ 無未勾 checkbox ＋ 無未答選項 → 標 `self-closed`、不鑄 span、`flow sources` 印一行計數。**warn-only，不 block** |
| 消費端 | 寫 / 編那份 carrier 的 agent（看到那一行就搬段或刪）；`flow pending` 與 `/decisions`（少一條問不到人的題） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`）；判定器 `vendor/scripts/flow/decision-sources.ts` 的 `isSelfClosed`，對帳在 `decision-sync.ts` |

## 新問題優先走 `flow ask`

要問的題**現在**就成形時，直接開 span，不必等 60 秒掃描：

```bash
node vendor/scripts/flow/flow.ts ask \
  --question '<問句>' \
  --option 'A（推薦）第一案 —— 這樣做會怎樣' \
  --option 'B 第二案 —— 這樣做會怎樣' \
  --recommended 'A（推薦）第一案 —— 這樣做會怎樣' \
  --carrier HANDOFF.md
```

問句走 `--question`（**不是** positional），選項走可重複的 `--option`（一條一個旗標，選項本文
含逗號是常態）。字母前綴與「（推薦）」由寫入端剝掉，卡片依索引自己編號。

檔案來源是給「本來就要寫進登記簿」的題用的。兩條路徑寫進的是同一個佇列。

### 從 dispatch 出去的 pane 走 `--complete blocked`

pane 裡問的題不經這支 CLI，走的是 completion handshake，選項一樣 MUST 走旗標：

```bash
node vendor/scripts/herdr-session-handoff.ts --complete blocked \
  --summary '<目前狀態>' \
  --decision '<只問一個具體問題>' \
  --decision-option 'A …' --decision-option 'B …' \
  [--decision-recommended 'A …'] \
  [--decision-for coordinator|charles]
```

#### `--decision-for` —— 這題問誰，預設 coordinator

**你有 parent。** 一個 dispatch 出去的 pane 問的題，絕大多數是它的 coordinator 當場裁決得了的
——而在這個旗標之前，每一題都被路由到 Charles 的 `/decisions`。2026-09-03 實測：<consumer-a> worker 問
「要不要修 CI 兩條紅燈」，coordinator 當場裁決、clade 修掉、隨 v1.12.8 出版，那一題還掛在人的
佇列上。

| 值 | 這題會怎樣 |
| --- | --- |
| `coordinator`（預設） | 照樣鑄 `decision.request`（`payload.audience: 'coordinator'`）、照樣送控制訊息喚醒 parent pane，但**不在** `/decisions` 與 `flow pending` 的預設佇列上（`--audience all` 才顯示） |
| `charles` | 進人的佇列。parent pane 還活著時 helper 印一行 warn（不擋） |

**MUST `--decision-for charles` 的判準是「這題只有 Charles 答得了」**——實機、線上帳號、對外
承諾、密鑰、不可逆且他要負責的。**NEVER** 因為「這題比較重要」就寫 `charles`：重要與該問誰
無關，而佇列被不需要他的題塞滿，代價是他不再讀它。

**coordinator 的題照樣是 span，這一點 NEVER 拿掉。** 它被藏起來的只有「Charles 的那一頁」；
`answer-not-filed` 與各種停滯偵測照樣看得到它。所以 **parent 回答之後 MUST 跑
`flow answer <span_id> --answer '<答案>'`**——在 pane 裡口頭裁決而不落 `flow answer`，那一題會
以 `answer-not-filed` 的形狀躺在停滯清單上，而回答它的人以為自己已經答完了。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `--decision-for charles` 且 parent pane 的 wake 真的送達 → helper 收據帶 `warning`。**warn-only，不擋**：有些題就是要人，coordinator 在場不改變這件事 |
| 消費端 | worker（填欄位）、coordinator（收控制訊息並 `flow answer`）、`/decisions` 與 `flow pending`（預設只顯示 `audience: charles`） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`）＋ `rules/core/session-tasks.operations.md` § Herdr session transport；helper 的 completion handshake 樣板每次 dispatch 逐字帶給 worker |

### 一個拍板題 = 一個問題。底下的 bullet 是**選項**，NEVER 是**項目**

```markdown
- [ ] 🟡 **兩條 TD 的 Status 要不要照建議改？**（回「兩條都改」或逐條指定即可）
  - **TD-309 → `done`（推薦）**：…
  - **TD-305 → `wontfix-until-signal`（推薦）**：…
```

這是 2026-08-29 <consumer-a> 的原文，兩個**互不相干**的 TD 綁成一題。它同時壞在兩層：

- **語義層**：那兩條 bullet 是要處理的**項目**，不是同一個問題的**替代方案**。答「A」在這裡
  沒有意義——沒有 A。問句自己也知道，所以它補了一句「或逐條指定即可」，那句話正是
  「這其實是兩題」的自白
- **機械層**：`TD-309` / `TD-305` 不是 A/B，整組解析不到，這題以**空白輸入框**上手機

**MUST 拆成兩題**，各自帶自己的 A/B。「合成一題比較省 Charles 的時間」是反的：省下的是**寫的人**
按兩次 `flow ask` 的時間，付出的是答的人在一個空白框裡自己組織兩件事的答案。

### 在 chat 渲染過的 `Qn` 選項 MUST 同一個 turn 落 carrier

在對話裡把一題渲染成 `Q1` + A/B/C，**那不是登記**。`\my` 與 `/decisions` 讀的是 spine，
spine 讀的是 carrier；chat 不在這條路徑上的任何一段。

2026-08-29 實測：agent 在對話裡給了排序過的 A/B，carrier 上那條 bullet 沒有任何選項行，
spine 上 `options: []`，手機上是一個空白輸入框。**寫的人看得到自己給過選項，答的人看不到**——
這正是本檔開頭那句「寫的人與答的人不是同一個人」最貴的一種形式。

**MUST 同一個 turn 兩邊都寫**：對話裡渲染的那組選項，逐字寫進 carrier 的 bullet（或直接
`flow ask --option`）。**NEVER** 想著「等下再補進 HANDOFF」——`flow sources` 60 秒後就掃過去了，
它掃到的是那一刻的檔案，不是你的打算。

沒補的下場不是靜默：ingest 端偵測得到「這題進來時沒有選項」，會用 `ask-options` 把它退回，
而**退回的對象就是你**。退回停在佇列上不會自己解決（實測停了 3.2 小時），手機上留著一張
答不了的卡。

### NEVER 把選項寫進問句本文

`要留哪一個？(A) 留 X (B) 停 Y` 這種寫法，`options` 是空的——`/decisions` 依 `options` 決定畫
按鈕還是空白輸入框，於是那題在手機上退化成自由填答，答的人得自己把字母打回去，落檔紀錄也
對不回是哪一個字母。兩個入口都會擋（問句本文有「從 A 起連續」的字母、卻沒帶任何選項時直接
拒絕）；擋不到的變體同樣禁止——**選項的載體是旗標，不是句子**。

> 2026-08-27 <consumer-a> 實測：一題 A/B 的 dep-upgrade 爭用題以空白輸入框出現在手機上。成因不是
> 寫的人偷懶——當時 `--complete blocked` **根本沒有**帶選項的通道，而本節的 `flow ask` 範例寫的是
> 一個 CLI 不接受的形狀（positional 問句 ＋ 未宣告的 `--option`），照抄會靜默掉光選項。

### NEVER 把該協調的事開成拍板題

「哪個 session／pane／worktree 該留下」「誰先 commit」這類題**球在 agent 手上**，不是裁決。
MUST 先跑 [[session-tasks]] § 並行爭用 的 Step 0 判出持有者，再對那個 pane 送一則
`herdr agent prompt` 問它還要多久 land／要不要合併。談過之後仍談不攏的那一題才進佇列，且
問句 MUST 寫明已探測、對方怎麼回。

### NEVER 把 live change 的 `## 人工檢查` 寫成登記簿條目

逐條看證據、勾 `[x]`、寫 `[issue]` 退回，是 **`/review` 的職責**——它有 preview 入口、evidence
檢視、以及寫回 `tasks.md` 的能力，`/decisions` 三樣都沒有。所以 `HANDOFF.md` /
`docs/tech-debt.md` 的條目 **NEVER** 承載「去把 `<change>` 的 `## 人工檢查` 逐條確認」。

那條 bullet 只會在兩種狀態下被寫出來，兩種的處置都不是留在登記簿上：

| 那個 change 現在的 bucket | 這條 bullet 是什麼 | MUST |
| --- | --- | --- |
| `changeBelongsOnReviewInbox` 回 **true**（票已經在 `/review` 上） | 重複——同一個勾由兩個畫面各要一次 | 刪掉這條 bullet |
| 回 **false**（`readyForEvidence` / `applyInProgress` 這類 **Claude 球**的桶） | 繞道——票進不了 inbox，於是改用登記簿叫人做 | 補齊缺的 evidence 讓它進 inbox，**再**刪掉這條 |

**判之前 MUST 實跑**，NEVER 從「我記得它已經做完了」推斷：

```bash
cd ~/offline/clade && node --input-type=module -e "
const m = await import('./vendor/scripts/review-gui.ts')
for (const c of await m.listPendingChanges('<repo>'))
  console.log(c.name, c.bucket, JSON.stringify(c.evidenceMissing?.map(e => e.itemId)))
"
```

**NEVER 代勾 `## 人工檢查` 的 checkbox 讓這條消失**——沒有人確認的 `[x]` 一律是 false-green
（per `agent-self-verification` MUST 8）。那是唯一比繞道更糟的收法：繞道至少還看得見。

**已封存的 change 不在此列。** `openspec/changes/archive/**` 的 `## 人工檢查` 在 `/review` 上
沒有 surface，它進 `/decisions` 是正確路由——那條路由由 `tasks.md` 上的 `(deferred-user-only:)`
標記承載（見 [[review-gui-surface]]），**NEVER** 改用登記簿 bullet 去補一條它漏掉的。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 條目文字同時含 `人工檢查` 與某個 **live** change 的目錄名 → `belongs-on-review` lint ＋ `decision-sync` 自動退回給作者。**warn-only，不 block**——擋在佇列外會讓繞道變隱形，比一條掛著 lint 的列更糟（同 `missing-evidence` 的理由） |
| 消費端 | 寫該條目的 agent（收自動退回，照上表處置）＋ `/decisions` 與 `flow pending` 上的 Charles（看到 `✎ 這條把 live change 的 ## 人工檢查 寫成 HANDOFF 條目` 可以跳過不讀） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`——寫那條 bullet 正是在編輯這兩個檔） |

> 2026-08-28 成因：<consumer-i> 的 `product-save-hardening` 四條 `## 人工檢查` 都宣告
> `[verify:api+ui]`，實際每條只寫了一種 evidence，於是 change 停在 `readyForEvidence`
> （`changeBelongsOnReviewInbox` 回 false，那是**Claude 球**的桶，刻意不畫進 inbox）。
> 作者拿不到 `/review` 的票，就把「五條逐項確認」寫成 `## 需要 Charles 執行` 的 bullet——
> 於是它以「要我動手」出現在 `/decisions`，而 Charles 在那裡連要看什麼都打不開。
> **繞道的成因不是不懂分工，是 `/review` 收不進來**，所以本節的第二列要求先補 evidence、
> 而不是只要求刪 bullet。

## 答案落檔失敗不再是靜默的（`answer-not-filed`）

Carrier 是**別的 session 也在寫的檔**。人在手機上答題的同時，某條 session 可能正在重寫
`## ⏳ Awaiting Charles` 整段——答案剛附上去就被整段覆寫掉了。寫入端回報成功，spine 上
一切正常，而讀那個檔的 agent 什麼都沒看到。

2026-08-29 <consumer-a> span `ee92949d75fa703c` 實測：答一次、改兩次，三次都沒進過 git 歷史；
agent 兩小時內三度把同一題當「等你拍板」重報，最後是 Charles 自己去 `/decisions` 看不到
自己的答案才發現。

現在 `flow status --stalled`（每個 attended session 開頭自動跑）會把這種狀態列成
`answer-not-filed` 一行，並印出重新歸檔的指令：

```bash
node vendor/scripts/flow/flow.ts relend <span_id>
```

`relend` **不收新答案**——答案在 spine 上一直是對的，壞掉的是檔案；它從 spine 重建那個區塊
放回去。重跑是 no-op，不會疊出第二份。

**NEVER 因為看到這一行就去要人重答一次。** 答案完好，要修的是投遞不是提問。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 已答（非 retracted）× 有指定 carrier × repo 內找不到它的決策紀錄區塊 × 超過 10 分鐘寬限 → `flow status --stalled` 列一行、exit 3。**warn-only，不 block** |
| 消費端 | SessionStart 的 `session-start-stalled.sh`（每個 attended session 開頭）；讀到就照 `relend` 指令處置 |
| 載入路徑 | 本節；停滯輸出自帶 action 句，不需要先知道要去看 |

**判準是「有沒有決策紀錄區塊」，NEVER 是「有沒有提到那個 span id」**：一條被寫成事故報告的
span id 到處都是，而那些檔案裡沒有答案。已歸檔（區塊搬進 `docs/archives/`）算已落檔——
只看 carrier 一個檔會讓每一條歸檔過的決策永遠報警，而會叫的警報等於不會叫的警報。

## 寫入當下就會提醒你沒帶選項

寫完 `HANDOFF.md` / `docs/tech-debt.md` 的當下，PostToolUse hook 會就地判「這題是 ruling
但沒有選項」，並把 `OPTIONS_REQUEST_TEXT` 原文印回同一個 session。

它與佇列端的 lint、ingest 端的 `ask-options` 退回**是同一個判準的三個時刻**，前兩者都是對的、
也都太晚：到那時題目已經在手機上長成空白輸入框，而唯一五秒鐘就能修好的人——選項還在自己
context 裡的那個 agent——已經走了。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 剛寫入的檔裡有 `no-options-under-ruling` 的條目 → 印到 stderr。**warn-only，一律 exit 0，NEVER 擋下 Edit**——`HANDOFF.md` 是高頻活文件，擋寫入買到的是繞過旗標不是更好的 bullet |
| 消費端 | 剛寫下那條 bullet 的 agent（本節）；判準與措辭走 `vendor/scripts/flow/decision-lint.ts` → `decision-sources.ts` 的 scanner ＋ `decisions.ts` 的 `OPTIONS_REQUEST_TEXT` |
| 載入路徑 | 本檔（paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`，編輯當下載入）＋ hook 自身的輸出 |

**NEVER 在 hook 裡自己解析 markdown。** 第二份 matcher 遲早與佇列給出不同答案，而不一致的
那一次會教讀者「這個提示是雜訊」。

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
| 觸發條件 | item 落 ruling 桶且無選項（`no-options-under-ruling`）、body 含差一點就解析成功的行（`near-miss-option-line`），或 item 落 review 桶而三欄沒寫齊 / 證據不可點（`missing-evidence`）。**三者都 warn-only，不 block**——HANDOFF 是高頻活文件，把寫法卡在寫入路徑上換到的是一個 bypass flag，不是更好的 bullet。`missing-evidence` 另外由掃描端自動 `requestClarification` 退回給 agent 補件（`EVIDENCE_REQUEST_TEXT`），球當場換手，不必等人在手機上看到 |
| 消費端 | `/decisions` 卡片（答題的 Charles）＋ `flow pending` 輸出（下一個編輯該檔的 agent） |
| 載入路徑 | 本檔，paths-gated 到 `HANDOFF.md` / `docs/tech-debt.md` / work-loop state——也就是寫這種條目的當下 |
