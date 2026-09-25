---
description: 寫一條「要 Charles 拍板／驗收」的登記簿條目時，那條 bullet 要長成什麼形狀——區段 heading 的語義與分桶、拍板題的選項寫法、Ready for review 的三欄契約、🟡/✅ 標記；編輯 HANDOFF.md / docs/tech-debt.md / work-loop state 時 path-scoped 載入
paths:
  - 'HANDOFF.md'
  - 'packages/*/HANDOFF.md'
  - 'docs/tech-debt.md'
  - 'packages/*/docs/tech-debt.md'
  - '.clade/work-loop/state.json'
---
<!-- Clade native rule; source: rules/core/decision-authoring.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# 待拍板條目的寫法

本檔規範**被掃的那條 bullet**（掃描器與頁面見 [[review-gui-surface]] § 待拍板佇列）。你寫進 `HANDOFF.md` / `docs/tech-debt.md` 的待拍板 bullet，60 秒內會被 `vendor/scripts/flow/decision-sources.ts` 掃進 spine，出現在控制面板「輪到你」與 `\my`，Charles 多半在手機上讀。**寫的人與答的人中間隔著一個解析器。**

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

**沒有選項的拍板題 MUST 改寫成「這題要給值」並逐項列出要填什麼**，兩者都不成立就不要放進待拍板區段（否則手機上是一個答不了的空白輸入框）。

粗體只包字母、包整段、或包字母與標記（`**A（推薦）**：…`）三種都解析得到。選項可換行，但續行 **MUST** 縮排比該 bullet 深、不是新的 list item，上限 3 行——被截斷時手機上沒有任何訊號。

以下每一種都解析不到，靜默退化成自由填答：

| 寫法 | 為什麼收不到 |
| --- | --- |
| `或者可以 X，也可以 Y` | 散文。**NEVER** 從散文猜選項 |
| `- **A 這樣做**` / `- **D 那樣做**` | 字母不連續，整組丟棄 |
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

**分桶的軸只有一條：這一列怎麼離開佇列**（一句短回覆 → `ruling` / `review`；別處的一個動作 → `human-action`；結構改動 → `loop-structural`）。NEVER 是重要性或可逆性；「可回答」（`ANSWERABLE`）是它的衍生屬性，NEVER 是第二條軸。舊 span 的 `irreversible` 由 `bucketOf` 渲染時摺進 `human-action`，**NEVER** 改寫既有 span 的 `category`。

**跨 repo 與 `Blocked` NEVER 進佇列**：前者是已移交的紀錄，後者敘述工作為什麼停住、寫不出 Charles 的動作。**NEVER 把 `Blocked` 重新收進來，也 NEVER 改用區段內文的關鍵字啟發式**——真的要人動手就寫進 `Awaiting Charles`、`Ready for review`、tech-debt 的 `### 需要 Charles`、或 tasks 的 `deferred-user-only`。

## `Ready for review` 的三欄（正向契約）

**每一個** consumer 的 **每一條** `Ready for review` 條目，**MUST** 在它自己的 bullet 底下帶滿
這三行——不是「盡量」、不是「重要的那幾條」、不是「等有空補」：

```markdown
- [ ] **<change 名或一句標題>**
  - 改了什麼: <一句，講行為不是講檔名>
  - 證據: <可點的東西——preview URL / commit hash / repo 相對路徑>
  - 退回會怎樣: <一句，講退回的代價>
```

**分不出 `review` 還是 `human-action` 時問：證據能不能壓成「30 秒可開的東西」**（preview URL / commit / 一段輸出）。不能（要人手、實體裝置、只有你有的帳號，例如手機真機驗收）→ `human-action`；硬寫進 `Ready for review` 會永遠掛 `missing-evidence` 而進不了佇列。

三欄缺一就驗不了，**NEVER** 放寬成「三選一」。**證據 NEVER 寫「見 HANDOFF」、change 名字、或任何要對方再跳一次的指標。** 三欄沒寫齊的條目 ingest 端**拒鑄 span**，改在 `flow sources` 與 `handoff-scan` 印退件行（收件人是你），補齊後下一趟掃描自己會開。

> **改分桶語義時 MUST 同時改上面那張分桶表與 `categoryOfHeading()`**。

## 「通過」有兩種，NEVER 讓佇列那一種代替另一種

同一條 change 有兩個各自獨立的通過，它們的**終點不同**：

| 哪一種 | 誰記錄 | 一句「通過」結掉的是什麼 |
| --- | --- | --- |
| 佇列的 `Ready for review` → `通過` | spine 上的 span，答完那條就離開 `\my` / `/decisions` | **方向 OK、可以進人工驗收** |
| `tasks.md` 的 `[review:ui]` checkbox／plan 的 `@human` 場景 receipt | checkbox 自己，或 `flow receipt` 寫進 `evidence/receipts.jsonl`（`ui-judgement` 卡） | **人真的在瀏覽器把那一頁開起來看過了** |

**答佇列 NEVER 等於驗收**——答完就離開佇列，未勾的 `[review:ui]` 沒有任何畫面再提醒。所以**條目指向的 change 若還有沒勾的 `[review:ui]`，那條 NEVER 是佇列的題**：掃描端（`restatesManualReview()`，讀 `tasks/` 直下 live work 的未勾 checkbox，另以「`人工檢查` ＋ live work slug」文字 fallback）掛 `belongs-on-review`、**不**合成 通過／退回，但照樣留在佇列（**NEVER** 擋掉）。

**NEVER 把未勾的 `[review:ui]` 各開一條進佇列**——一條 change 的驗收是一趟差事，家在 `ui-judgement` 卡。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 條目指向的 live change 有 ≥1 項未勾 `[review:ui]` → `belongs-on-review` lint ＋ 不合成 通過／退回。**warn-only，不 block** |
| 消費端 | 寫該條目的 agent（看到 lint 就把它移回人工驗收流程）＋ `/decisions` 與 `flow pending` 上的 Charles（看到沒有通過鍵就知道要去逐條驗） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`） |

## 驗收：已經出版的，NEVER 再問一次

已經隨版本 tag 出版、散播到全 fleet 且零失敗的 work 不再問人：`flow sources --apply` 對每件 `done` 的工作查三格證據，全中就寫 `work.accept`（`actor: system`、`reason: landed <tag>`、`payload.accepted_by: 'landing'`）：

1. `commit:<sha>` 這個憑證在本 repo 存在
2. 它已經 push（至少一個 remote-tracking ref 包含它）
3. 它落在一個 `v<semver>` tag 裡，而**那一版的 propagate journal 有紀錄、且每一台 consumer 都真的
   收到了那一版**

**代替人按的是證據，NEVER 是判斷。** **NEVER 對沒有 landing 證據的 work 自動 accept**（「pane 回 success 了」「commit 已經在 main 上了」都不算——進了 main 不等於出版）。判定 fail-closed：三格缺一就照樣問人；journal **0 筆不是零失敗**。

第 3 格的 status 判定 **MUST 是 allow-list**，**NEVER 是 deny-list**（漏列的預設就是放行一個終態的 `work.accept`）。只有兩種算送達：

- `bumped` —— commit 建了、push 了、remote 確認過
- `skipped` **且那台 consumer 的 upstream remote-tracking ref 上的 manifest 版本已到達該 tag**（`skipped` 分不出來源，所以問那台自己停在哪一版；讀 `landing.ts` 固定的 upstream commit 上的 `.clade/manifest.json`，`.claude/hub.json` 為遷移期 alias）。**NEVER** 讀磁碟（propagate 先寫 manifest 才同步）、**也 NEVER** 讀 HEAD（journal 整檔覆寫會把 `push-withheld` 蓋成 `skipped`），也 **NEVER** 改成「HEAD 到版 ＋ HEAD 已 push」（consumer main 領先 origin 是常態，會永遠 false）。讀不到 → 無證據

其餘全部不算，包含 `push-unconfirmed`、`bumped-local`、`push-withheld`。**NEVER** 用「那一趟是 `--no-push`」放行 `push-withheld`——沒有證據是正確的量測。

沒有 landing 證據的驗收列**同一個 repo 合併成一張卡**（全收 / 逐條 / 還沒）；卡片逐條列出是哪幾件，**NEVER** 讀成一次收掉一批沒看過的東西。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 三格證據全中 → `flow sources --apply` 寫 `work.accept`，佇列不再排那一列。**不 block**，只少問 |
| 消費端 | `flow pending` 與 `/decisions`（同一支 `buildDecisionQueue`）；`flow accept` 保留給人 |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`）；判定器 `vendor/scripts/flow/landing.ts` |

## 🟡 / ✅ 標記

`- 🔴` / `- 🟡` 是「還沒解決」；`- ✅` 與 `- [x]` 是已完結，掃描器跳過。答案落檔是 append、不刪來源 bullet，所以**答完之後 MUST 自己把那條標成完結**。

### 自述結案 = 離開待拍板段

條目本文自己說了「已拍板 A」「已完結」「已隨 relay-4 落地」，掃描端判 `self-closed`、**不鑄 span**。**NEVER 把 `self-closed` 讀成「所以不用管它」**：`flow sources` 每輪會印計數，**MUST 搬到參考段或刪掉**。

判準只讀**標題 ＋ 第一段**，且要求**沒有**未勾 checkbox、**沒有**未答選項——一條寫著「已拍板 A，接下來要決定 B / C」的條目仍然是題目。題目訊號只算結案語之後、同一行內的疑問詞（明說「接下來要決定 / 待你拍板」的跨行照樣算）。被誤判的代價是一題永遠不會被問。**NEVER 加關鍵字啟發式擴充這張表**。

agent 代收走 `flow dismiss <span_id> --reason '<為什麼不再需要人>' [--repo <name>]`（寫 `decision.dismiss` 並在條目行首加 `✅ dismissed: `）。**NEVER** 手動改 carrier 那一行而不寫事件。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 標題＋第一段命中結案語 ＋ 無未勾 checkbox ＋ 無未答選項 → 標 `self-closed`、不鑄 span、`flow sources` 印一行計數。**warn-only，不 block** |
| 消費端 | 寫 / 編那份 carrier 的 agent（看到那一行就搬段或刪）；`flow pending` 與 `/decisions`（少一條問不到人的題） |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`）；判定器 `vendor/scripts/flow/decision-sources.ts` 的 `isSelfClosed`，對帳在 `decision-sync.ts` |

## 新問題優先走 `flow ask`

要問的題**現在**就成形時，直接開 span，不必等 60 秒掃描：

```bash
node vendor/scripts/flow/flow.ts ask \
  --headline '<卡片標題：一句人話的問句，不放 work id／SHA>' \
  --question '<完整問句，讀者沒有 scrollback>' \
  --option '<短標籤> :: <按了會怎樣>' \
  --option '<短標籤> :: <按了會怎樣>' \
  --recommended '<推薦那一條的短標籤>' \
  --why '<一句為什麼推薦>' \
  --carrier HANDOFF.md
```

問句走 `--question`（**不是** positional），選項走可重複的 `--option`（一條一個旗標）。
字母前綴與「（推薦）」由寫入端剝掉，卡片依索引自己編號。

**`flow ask` 依形狀檢查必填，缺了就 exit 1 並印出可照抄的改法**（`vendor/scripts/flow/ask-admission.ts`，與 `--complete blocked --decision-for charles` 共用）：

| 這題要人做什麼 | 必帶 |
| --- | --- |
| 選一個（`ruling`／`review`） | 2–4 條 `--option '<短標籤> :: <後果>'`（短標籤 ≤16 字）＋ `--recommended` ＋ `--why` |
| 給一個值 | `--needs-value` ＋ 每個要填的值一條 `--field '<欄位名>'` |
| 到場做事（`--category human-action`） | 每個動作一條 `--step '<做什麼>'`；帶選項的到場題則照「選一個」那列給 `--option`＋`--recommended`＋`--why`，`--step` 只在沒有可用選項時必填 |

選填：`--deadline <ISO> --deadline-basis '<為什麼是這天>'`（72 小時內到期的卡排最前）、
`--dedupe-key <key>`（同一件事的第二次發問併進同一張卡）。問 agent 的題加
`--audience coordinator`，不受上表限制。

手機上第一眼只看得到標題、推薦與理由、短標籤按鈕；長的背景寫進 `--question` 與 carrier。檔案來源與 `flow ask` 寫進的是同一個佇列。

### 從 dispatch 出去的 pane 走 `--complete blocked`

pane 裡問的題不經這支 CLI，走的是 completion handshake，選項一樣 MUST 走旗標：

```bash
node vendor/scripts/herdr-session-handoff.ts --complete blocked \
  --summary '<目前狀態>' \
  --decision '<只問一個具體問題>' \
  --decision-option '<短標籤> :: <後果>' --decision-option '<短標籤> :: <後果>' \
  [--decision-recommended '<短標籤>' --decision-why '<一句為什麼>'] \
  [--decision-for coordinator|charles]
```

`--decision-for charles` 的題過同一份 admission（上一節的表）：選一個就 MUST 帶短標籤選項＋
`--decision-recommended`＋`--decision-why`；要一個值就改帶 `--decision-field '<欄位名>'`。
問 coordinator（預設）的題不受限。

#### `--decision-for` —— 這題問誰，預設 coordinator

**你有 parent。** dispatch 出去的 pane 問的題，絕大多數 coordinator 當場裁決得了。

| 值 | 這題會怎樣 |
| --- | --- |
| `coordinator`（預設） | 照樣鑄 `decision.request`（`payload.audience: 'coordinator'`）、照樣送控制訊息喚醒 parent pane，但**不在** `/decisions` 與 `flow pending` 的預設佇列上（`--audience all` 才顯示） |
| `charles` | 進人的佇列。parent pane 還活著時 helper 印一行 warn（不擋） |

**MUST `--decision-for charles` 的判準是「這題只有 Charles 答得了」**（實機、線上帳號、對外承諾、密鑰、不可逆且他要負責的）。**NEVER** 因為「這題比較重要」就寫 `charles`。

**coordinator 的題照樣是 span，這一點 NEVER 拿掉。** **parent 回答之後 MUST 跑 `flow answer <span_id> --answer '<答案>'`**——口頭裁決不落檔，那題會以 `answer-not-filed` 躺在停滯清單上。

child 判出「只有 Charles 答得了」時仍走 `--decision-for charles`，**NEVER** 自己在對話裡問 principal。`CLADE_DISPATCH_ID` 非空時，final response 裡的提問不是授權通道。

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

兩個互不相干的 TD 綁成一題：那兩條 bullet 是**項目**不是替代方案（「或逐條指定即可」就是自白），也解析不到、以空白輸入框上手機。**MUST 拆成兩題**，各自帶自己的 A/B。

### 在 chat 渲染過的 `Qn` 選項 MUST 同一個 turn 落 carrier

在對話裡渲染成 `Q1` + A/B/C **不是登記**——`\my` 與 `/decisions` 讀 spine，spine 讀 carrier。**MUST 同一個 turn 兩邊都寫**：選項逐字寫進 carrier 的 bullet（或 `flow ask --option`）。**NEVER** 想著「等下再補進 HANDOFF」——沒選項的題 ingest 端會拒鑄 span，只剩一行給你的退件。

### NEVER 把選項寫進問句本文

`要留哪一個？(A) 留 X (B) 停 Y` 的 `options` 是空的，手機上退化成自由填答。兩個入口都會擋；擋不到的變體同樣禁止——**選項的載體是旗標，不是句子**。

### NEVER 把該協調的事開成拍板題

「哪個 session／pane／worktree 該留下」「誰先 commit」這類題**球在 agent 手上**，不是裁決。
MUST 先跑 [[session-tasks]] § 並行爭用 的 Step 0 判出持有者，再對那個 pane 送一則
`herdr agent prompt` 問它還要多久 land／要不要合併。談過之後仍談不攏的那一題才進佇列，且
問句 MUST 寫明已探測、對方怎麼回。

### NEVER 把 live change 的 `## 人工檢查` 寫成登記簿條目

逐條驗收是**人工驗收**（`ui-judgement` 卡 → `flow receipt`）的職責，所以 `HANDOFF.md` / `docs/tech-debt.md` 的條目 **NEVER** 承載「去把 `<change>` 的 `## 人工檢查` 逐條確認」：

| `flow gates` 對那件 work 的輸出 | 這條 bullet 是什麼 | MUST |
| --- | --- | --- |
| 已有對應的 `ui-judgement` 卡（票已經在人的佇列上） | 重複——同一個判定由兩個畫面各要一次 | 刪掉這條 bullet |
| 沒有卡（evidence 缺或過期——**agent 的球**，機械待辦 NEVER 成卡） | 繞道——卡出不來，於是改用登記簿叫人做 | 補齊缺的 evidence 讓卡出現，**再**刪掉這條 |

**判之前 MUST 實跑**，NEVER 從「我記得它已經做完了」推斷（cwd = 該 repo，**NEVER** 帶 `CLADE_HOME`）：

```bash
node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json
```

**NEVER 代勾 `## 人工檢查` 的 checkbox 讓這條消失**（false-green，[[agent-self-verification]] MUST 8）。已封存的 change（`tasks/` 子目錄、舊 `openspec/changes/archive/**`）不是佇列輸入，不在此列。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 條目文字同時含 `人工檢查` 與某個 **live** change 的目錄名 → `belongs-on-review` lint ＋ 不合成 通過／退回。**warn-only，不 block，且 NEVER 拒鑄 span**（路由錯誤，擋掉會讓繞道變隱形） |
| 消費端 | 寫該條目的 agent（看到 `✎` 評語照上表處置）＋ Charles。說明文字由 `LINT_NOTES['belongs-on-review']` 渲染，NEVER 由 agent 寫進人的佇列 |
| 載入路徑 | 本節（`rules/core/decision-authoring.md`，paths-gated 於 `HANDOFF.md` / `docs/tech-debt.md`——寫那條 bullet 正是在編輯這兩個檔） |

## 答案落檔失敗會被偵測（`answer-not-filed`）

Carrier 是別的 session 也在寫的檔，答案附上去可能被整段覆寫。`flow status --stalled` 會列 `answer-not-filed` 並印出重新歸檔的指令：

```bash
node vendor/scripts/flow/flow.ts relend <span_id>
```

每個 attended session 開頭 MUST 取得一次 `flow status --stalled` 的實際結果：已驗證的 session-start hook（`session-start-stalled.sh`）可自動提供，否則自己跑 `node scripts/flow/flow.ts status --stalled`（clade 用 `vendor/scripts/flow/flow.ts`）。設定檔或空白輸出不證明 hook 執行過；工具不可達就回報檢查未完成。

`relend` 從 spine 重建區塊放回、重跑是 no-op。**NEVER 因為看到這一行就去要人重答一次。**

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 已答（非 retracted）× 有指定 carrier × repo 內找不到它的決策紀錄區塊 × 超過 10 分鐘寬限 → `flow status --stalled` 列一行、exit 3。**warn-only，不 block** |
| 消費端 | 每個 attended session 的 agent，透過已驗證的 session-start hook 或上段顯式 CLI 取得結果；讀到就照 `relend` 指令處置 |
| 載入路徑 | 本節；停滯輸出自帶 action 句，不需要先知道要去看 |

**判準是「有沒有決策紀錄區塊」，NEVER 是「有沒有提到那個 span id」**；搬進 `docs/archives/` 算已落檔。

## 寫入當下就會提醒你沒帶選項

每次寫完 `HANDOFF.md` / `docs/tech-debt.md`，就地檢查「ruling 但沒有選項」：已接通的 `PostToolUse` hook 會跑共同 lint 並印 `OPTIONS_REQUEST_TEXT`；沒有 hook 觸發證據時寫完立即跑 `node scripts/flow/decision-lint.ts <repo-root> <edited-file>`（clade 用 `vendor/scripts/flow/decision-lint.ts`，參數用絕對路徑），讀 stderr 修正（exit 0 不代表條目完整）。這是同一判準三個時刻裡唯一還能補救的那一個。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 剛寫入的檔裡有 `no-options-under-ruling` 的條目 → 印到 stderr。**warn-only，一律 exit 0，NEVER 擋下 Edit**——`HANDOFF.md` 是高頻活文件，擋寫入買到的是繞過旗標不是更好的 bullet |
| 消費端 | 剛寫下那條 bullet 的 agent（本節）；判準與措辭走 `vendor/scripts/flow/decision-lint.ts` → `decision-sources.ts` 的 scanner ＋ `decisions.ts` 的 `OPTIONS_REQUEST_TEXT` |
| 載入路徑 | 本檔（paths-gated）；Hook 與顯式 CLI 共用 lint 輸出 |

**NEVER 在 hook 裡自己解析 markdown**——第二份 matcher 遲早與佇列不一致。

## 改寫與重問

`source_id` 由 identity（檔案 + 問句）導出，**不由內容**。因此：

- **改寫說明、補一段 context、調整選項文字 → 同一題**，不會重問，佇列上那題的選項會在下一次
  掃描就地更新（`decision-sync.ts` 的 amend）
- **改寫問句本身 → 換一題**：舊的撤回、新的重開。要重問就改問句；**NEVER** 為了讓它重新出現
  而刪掉再貼回——刪掉那一刻它會被記成 `retracted`（來源消失），不是被裁決

## 編輯既有不合格條目時 MUST 順手轉正

**每一次**編輯一條已經在待拍板區段、但不符本檔形狀的 bullet 時，都 MUST 一併把它改成合格形狀（`/decisions` 與 `\my` 的 `✎ 來源檔有幾行差一點就是選項` 就是給你的）。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | item 落 ruling 桶且無選項（`no-options-under-ruling`）、body 含差一點就解析成功的行（`near-miss-option-line`），或 item 落 review 桶而三欄沒寫齊 / 證據不可點（`missing-evidence`）。**寫入路徑上三者都 warn-only、不 block**。**ingest 路徑上前者與後者拒鑄 span**（`decision-sync.ts` 的 `REJECTING_LINTS`），改成 `flow sources` 與 `handoff-scan` 的退件行並計入 exit code。`near-miss-option-line` 是**評語不是退件碼**，NEVER 拿它擋 ingest |
| 消費端 | carrier 作者（退件收件人）＋ `/decisions` 與 `flow pending` 上的 Charles |
| 載入路徑 | 本檔，paths-gated 到 `HANDOFF.md` / `docs/tech-debt.md` / work-loop state——也就是寫這種條目的當下 |
