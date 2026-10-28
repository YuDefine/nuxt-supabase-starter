
# `flow` 指令查表（`/my` 用）

本檔只收 `/my` 會用到的七個子命令。指令與旗標以 `node vendor/scripts/flow/flow.ts --help` 及 `vendor/scripts/flow/flow.ts` 的實作為準；判準（什麼時候問、怎麼寫選項、失敗怎麼處置）不在本檔，見 `rules/`。

共同前提：

- `pending`／`answer`／`revise`／`dismiss`／`ask-options` **在 clade checkout 執行**（`cd ~/offline/clade`，或設 `CLADE_HOME`）。`ask` 例外：它把題目寫進**當前 cwd 所屬 repo** 的 spine（在 linked worktree 會改寫到該 repo main checkout），沒有 `--repo`，所以 MUST 在**該題所屬 repo 的 checkout** 執行（例：`<consumer-id>` 的題 `cd ~/offline/<consumer-id> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask …`）；在 clade 跑會把別 repo 的題標成 `[clade]`、答案落到 clade 的 carrier。`flow` 以 `CLADE_HOME`，否則以 cwd 的 `git rev-parse --show-toplevel` 當根目錄；fleet roster 與 `--repo` 名稱解析都從這個根讀：roster＝`consumers.local` ∪ `registry/consumers.json` 上本機有 checkout 的 consumer（含 `pending_onboard`），所以沒跑過 `bootstrap-consumers-local.ts` 的機器也讀得到全部已登記的 repo。在 consumer 目錄跑 `pending`（那裡兩個來源都沒有）會印 `⚠ 找不到 <consumer>/consumers.local，只能看這一個 repo` 並只列那一個 repo。
- 下文的 `flow` 都是 `node vendor/scripts/flow/flow.ts` 的簡寫。

## pending

讀待拍板佇列，照 `/my` 的格式渲染。四個來源（三個檔案來源＋spine）已在這裡收斂。

```bash
cd ~/offline/clade && FLOW_CLI_CONTRACT=2 node vendor/scripts/flow/flow.ts pending
```

| 旗標 | 作用 |
| --- | --- |
| （無） | Fleet 預設：讀 roster 上每個 repo |
| `--repo-only` | 只讀當前根目錄這一個 repo（不問 peer） |
| `--local-only` | 只讀本機這一份 spine，不問 peer 機器（peer 端被問時就是帶這個旗標） |
| `--audience all` | 連問 coordinator 的題（`--audience coordinator`／`--decision-for coordinator` 開的）一起顯示；值只收 `all`／`charles`／`coordinator`，打錯 fail closed |
| `--json` | 輸出 `{ asked, gated, measurements, … }` JSON，不渲染 |

輸出與退出碼：

- 區段順序：`要我拍板` → `要我驗收` → `要我動手` → `不在本 repo` → `loop 結構性推不動` → `未分類` → `卡住、等人動手` → 最後一行現況量測（當下實跑，例：`clade: dirty 7 / worktree 21　<consumer-id>: stash 3`；全乾淨時是 `全 roster 乾淨：無 dirty、無 worktree、無 stash、無 lock`）。
- `Qn` 只出現在 `要我拍板` 與 `要我驗收`，編號連續；其餘為 bullet。題目子行可能有 `A./B.` 選項（推薦那條帶「（推薦）」）、`⚠` 警示、`✎` 寫法評語、`→` 動作／步驟、`答案落到：<carrier>`、`可回：X／Y`（僅動手桶）、`span <span_id>`。
- 每題行首的 `[<repo>]` 就是 `flow answer --repo` 要逐字照抄的值。題來自別台機器時寫成 `[<repo>@<機器>]`：`--repo` 只填 `@` 前面的 repo 名，`flow answer` 會自己對那台落答。
- 跨機：預設也併入 peer（`~/.config/clade/herdr-peers` 列的機器）的佇列，每台 ssh 並行、逾時 8 秒；`span_id` 去重、本機優先；`--json` 多帶 `peers: [{ machine, ok, error?, count }]`，每列帶 `machine`。**讀不到的 peer 會在輸出最上面印 `⚠ 讀不到 peer <機器>：<原因>`**——那代表那台的題這次看不到，不是那台沒有題；整體為空但有 peer 讀不到時 exit 6（不是 4）。
- 帶 `⏳ 疑似過時：<證據>` 子行的題排在同一區段最後：watch 的過時掃描判它前提可能已消失、但信心不到代寫掉（問 Charles 的題、題目內文才提到的 PR、有來源檔等）。多半不用答；查證屬實就照子行給的 `flow dismiss` 寫掉——子行那行指令沒帶 `--apply`，照抄時 MUST 補上（見 § dismiss）。被機器自動下架的題 `dismissed_by` 是 `stale-sweep`，reason 以「前提已不存在（<規則>）」起頭。
- 閒置 ≥72h 又沒有近期重驗紀錄的題**不會出現在這份清單**，只在結尾印一行 `⏸ 另有 N 題閒置 …，未列出`（`--json` 在 `recheck_due`）。那是主持者的工作：`flow recheck` 列清單、逐題查現況後 `flow recheck <span> --conclusion still-needed|obsolete|premise-changed --source … --evidence … --actor …`；仍需拍板才放行，過時就寫掉附證據，前提改變就改題。判準見 coordinator skill 的 `rules/向Charles提問判準.md` Rule 5。/my 的 agent NEVER 為了讓題目出現而自己記一筆 `still-needed`——重驗要查過現況才算。
- 退出碼照 `FLOW_CLI_CONTRACT=2`（每次呼叫前綴，NEVER export）：exit 0 = 佇列有東西；**exit 4 = 佇列空**（印 `佇列是空的。`），不是錯誤；exit 6 = 讀得到的部分是空、但有 peer 讀不到（不能報空）；exit 2 = 指令打錯。沒帶前綴時回舊碼（空＝2、peer 讀不到＝3）並在 stderr 多印一行 `flow: deprecated-exit`。

## ask

把一題推進佇列（開一個 `decision.request` span）。admission 不過就 exit 1 並印出可照抄的改法。

```bash
cd <該題所屬 repo 的 checkout> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<一句以？結尾的人話問句>' \
  --question '<一兩句陳述句前提（現況與為什麼要問，≥8 字，不能只重問標題），≤200 字，讀者沒有 scrollback>' \
  --option '<短標籤> :: <按了會怎樣>' --option '<短標籤> :: <按了會怎樣>' \
  --recommended '<推薦那條的短標籤>' --why '<一句為什麼>' \
  [--agent-note '<路徑、session、續接方式等給 agent 的資訊>'] \
  --carrier '<TD-NNN | HANDOFF.md | tasks/xxx.md>' --actor '<你的 pane id>'
```

送出把關（`flow ask`、`flow amend-options --headline`、herdr `--complete blocked --decision-for charles` 共用）會退回：沒有前提（問句之外的陳述句少於 8 字）、標題是「有 N 題等你回答」這類彙總句、標題塞兩個問句。一題只問一件事，多題就各送一次、各帶自己的前提與選項。

要的是一個值而不是選擇時：

```bash
cd <該題所屬 repo 的 checkout> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<一句以？結尾的問句>' \
  --question '<一兩句陳述句前提，再說要填什麼、為什麼>' \
  --needs-value --field '<欄位名>' --field '<欄位名>' \
  --carrier HANDOFF.md --actor '<你的 pane id>'
```

只有 Charles 做得了的工作（題目是範圍，執行寫成步驟）：

```bash
cd ~/offline/<consumer-id> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<consumer-id> 跑 dep batch：範圍？' \
  --question '<一兩句陳述句前提與要選的範圍>' \
  --option '<範圍 A> :: <後果>' --option '這輪不跑 :: <後果>' \
  --recommended '<範圍 A>' --why '<一句為什麼>' \
  --step 'Charles 在 <consumer-id> 親自打 /version-upgrade → Outdated mode' \
  --carrier HANDOFF.md --actor '<你的 pane id>'
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `--question Q` | 必填 | 一兩句背景（**不是** positional）。本文裡自己列了 `(A)`／`(B)` 卻沒有 `--option` 會被拒 |
| `--option '<短標籤> :: <後果>'` | 選一個時 2–4 條 | 可重複，一條一個旗標；短標籤 ≤16 字。字母前綴與「（推薦）」由寫入端剝掉，NEVER 寫進文字 |
| `--recommended '<短標籤>'` | 選一個時必填 | 推薦那條的短標籤 |
| `--why '<理由>'` | 選一個時必填 | 一句為什麼推薦 |
| `--needs-value` ＋ `--field F` | 要值時必填 | 取代 `--option`；每個要填的值一條 `--field` |
| `--item I` | 選填，可重複 | 題卡上的結構化清單，一條一行（最多 15 條、每條 160 字）；整批確認題（如 backlog 分診）用它列逐條內容，題目本文只放前提與批次摘要 |
| `--checked '<查了什麼> :: <查到什麼>'` | 題面說某東西「目前沒有／不存在／找不到／沒有…記錄」時必帶，可重複 | 這個斷言怎麼查出來的，寫進 `payload.checked` 並印在題卡上（每條 ≤160 字，不含家目錄路徑或 session 代號）；缺了 exit 1（`unchecked-absence`）。題卡另印該 work 最新的 checkpoint（哪台、哪棵樹、做到哪、卡在什麼） |
| `--resubmit <代號>` | 選填 | 內容把關退回時發的補件代號；帶有效代號再送一律進佇列，代號只能用一次。見下方「內容把關退回」 |
| `--step S` | `human-action` 沒有可用選項時必填 | 要人到場做的動作，一條一個；拍板題也可帶，卡上印成 `→` 行 |
| `--headline H` | 選填 | 卡片標題，一句以「？」結尾的人話問句，不放 work id／SHA；沒給就用 `--question` |
| `--agent-note N` | 選填 | 給 agent 的資訊（絕對路徑、session／dispatch id、續接方式、原文）。寫進 `payload.agent_note`，`flow pending`、`/my` 與 fleet 卡片都不顯示 |
| `--category C` | 選填，預設 `ruling` | 只收 `ruling`／`review`／`other-repo`／`human-action`／`loop-structural` |
| `--carrier PATH` | 選填 | 答案落點（`TD-NNN`、`HANDOFF.md`、`docs/tech-debt.md`、`tasks/xxx.md`）；`TD-NNN` 落到 `docs/tech-debt.md` 該 entry 尾；不給則答案只存在 spine |
| `--actor A` | 選填，預設 `unknown` | 發問者（pane id） |
| `--work-id W` | 選填 | 掛到既有 work item |
| `--audience charles\|coordinator` | 選填，預設 `charles` | `coordinator` 不進人的預設佇列，也不受 admission 表限制 |
| `--deadline D --deadline-basis B` | 選填，成對 | 有期限的題排最前（72 小時內到期）；basis 必填 |
| `--dedupe-key K` | 選填 | 同一件事的第二次發問併進同一張卡；key 不放寬不重問閘門：同題（含同 key）已答過就回既有答案，不鑄新卡 |
| `--ref pr:<N>｜pr:<repo>#<N>｜td:TD-<N>` | 選填，可重複 | 這題的前提依附在哪個 PR／TD 上。它在**題目問出之後**終局（合入、關閉、結案），watch 的過時掃描就自動把這題下架；問出之前就已終局的算前提，不算證據。涉 production／花費／政策的題只標不寫。沒有任何可核對參照（`--ref`、dispatch、題目裡的 PR／TD）時 stderr 會提醒，不擋 |
| `--not-same-as <span>` | 問句與已答題相近、但確定是另一件事時帶，可重複 | 身分鍵對不上、問句 bigram 相似度過門檻的已答題會被拒收；明說不是同一件事才放行（`decision-subject.ts`） |
| `--dispatch <id>` | 補鑄題掛回 blocked dispatch 時帶 | 同一題的身分鍵之一：同 dispatch 且問句相近的已答題算同一題 |
| `--supersede <span>` | 被「已有答案」拒收且現況變了才帶 | 「已有答案」包括同一 carrier，以及沒帶 carrier 時引用舊題 span id 或與舊題共用識別字（見 `rules/待拍板條目寫法.md` Rule 23）。指到拒收句列出的那一題才放行；記在 `payload.supersedes` |
| `--options 'A,B'` | 舊寫法 | 以逗號切選項，選項本文含逗號時會切壞；用可重複的 `--option` |
| `--question-page`／`--question-page-label` | 已退役 | 帶了直接被拒 |

內容把關（形式把關之後，只對問 Charles 的新題；`flow ask` 與 herdr `--complete blocked --decision-for charles` 共用同一支判定）：AI 讀題卡，前提是空話、選項分不出差別、或填值題的欄位說不出要填什麼時，**第一次送出**會被退回並印出缺什麼與一個補件代號。補件的做法：

1. 讀退回訊息逐段列的缺口（前提／選項／欄位），把題面補到 Charles 不開任何檔案就答得了；
2. 帶回代號再送一次：`flow ask … --resubmit resub-<12 碼>`（herdr 入口是 `--complete blocked … --decision-resubmit resub-<12 碼>`），**其餘旗標照舊**；
3. 帶有效代號再送一律進佇列、不會第二次被退回；補完後 AI 仍判定不足的段落會以「AI 認為仍不清楚」標在題卡上，Charles 看得到。補不出內容時直接帶代號再送也可以，代號只能用一次。

代號沒帶、不存在、已過期（14 天）或已用過，這題當新題重新判定。AI 不可用（沒有 key、額度用完、API 錯誤、逾時、回傳不合格式、功能停用）時題目照形式把關放行，輸出多一行「這次沒有做內容判定（原因：…）」；這不是錯誤，不必重送。coordinator 題（`--audience coordinator`）與形式拒收都不觸發內容判定。

題面檢查（只對問 Charles 的新題，exit 1；兩層怎麼分見 `rules/待拍板條目寫法.md` Rule 4）：標題或本文含絕對路徑或 UUID、本文超過 200 字、標題不是以「？」結尾的問句。

寫入前的兩道拒絕（只對問 Charles 的題，exit 1；處置見 `rules/待拍板條目寫法.md` Rule 23）：同一 repo 同一 carrier 14 天內已有 Charles 的答案 → 印出既有答案與日期；cwd 的 repo 在 clade 旁邊卻不在 roster 上 → 印三條改法。

輸出：一行 JSON `{"span_id": "...", "work_id": "..."}`——**記下 `span_id`**，Phase 2 第 2 步要用它標 `[本輪從對話撈出]`。在 linked worktree 裡執行時，落點會改寫到 main checkout 的共用 spine，stdout 多帶 `spine`／`rerouted_from`，stderr 印一行說明。

## answer

回答一題：關 span、把決策紀錄寫進 carrier 的 `## 決策紀錄` 節（`td:` carrier 為該 TD entry 尾）、量測 tech-debt hygiene 差集；carrier 是 TD、選中的選項標了「TD 結案」（或帶 `--close-td`）且答案通過終局檢查時關掉那條 TD；最後照該 repo 的 workflow 把紀錄送進 origin。

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts answer '<span_id>' \
  --answer '<他的答案>' --repo '<那題的 repo 欄位，逐字照抄 flow pending 給的值>' --apply
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `<span_id>` | 必填（positional） | `flow pending` 該題的 `span` 行 |
| `--answer '<text>'` | 必填 | 選項題寫 `<字母>. <短標籤>`；驗收寫 `通過` 或 `退回：<理由>`；給值或自由回覆照原文 |
| `--repo <name>` | 題目有 `[<repo>]` 前綴時必填 | 佇列上的 repo **名稱**，由 `resolveRepoRootByName` 解析；NEVER 填路徑。名稱不在 roster 上時印 `roster 上找不到 repo「<name>」——不寫入…` 並 exit 1 |
| `--repo-root <path>` | 只有 repo 不在 registry 上時 | 直接指那個 checkout；span 必須在它的 spine 上（判準見 `rules/回答落檔判準.md` Rule 2） |
| `--close-td` | 選項沒標「TD 結案」、但 Charles 明說要關那條 TD 時 | 補上關 TD 的來源；答案文字仍要過終局檢查才關（判準見 `rules/回答落檔判準.md` Rule 10） |
| `--via <text>` | 選填 | 決策紀錄的來源說明，預設 `Charles 在 chat 回答，由主線代填` |
| `--surface fleet-web\|cli-proxy\|cli` | 選填 | 作答介面，連同 `via` 寫進 `decision.request` end 事件。沒帶：有 `--via`＝`cli-proxy`、沒有＝`cli`（代填）。`fleet-web` 只有 /fleet 網頁的 server 路徑會帶，agent **NEVER** 帶；它是 server 自述不是防偽證明。三值以外當場拒絕、不落答 |
| `--apply` | 寫入時必帶 | 真的關 span、寫檔、散播。不帶就只預演：不關 span、不寫檔、不散播，輸出的 `block` 逐字就是等一下會寫進去的那段（`FLOW_CLI_CONTRACT=2` 下的預設；過渡期沒帶前綴時不帶 `--apply` 仍會寫入並印 `flow: deprecated-default`）。`--dry-run` 是舊名別名 |
| `--local-only` | 選填 | 本機沒有這題時不問 peer。預設：本機判 `no-such-decision` 才問 peer 的佇列、對題所在那台跑同一條 `answer --local-only`；peer 讀不到就拒絕並印原因（exit 1），NEVER 在本機另寫一份 |

輸出：一行 JSON `{ ok, resolved, landed, carrier, carrierPath, block, reason, detail, td_status?, published? }`。

- `ok:false` → exit 1，`reason` 為 `no-such-decision`、`already-resolved` 或 `spine-override` 等
- `ok:true` → exit 0；`landed:false` 時 `reason` 說明 carrier 那一步為什麼沒做到（`no-carrier`、`carrier-missing`、`carrier-outside-repo`、`td-hygiene-regression`、`carrier-lock-contention`、`landed-block-ambiguous`）

- `td_status`（carrier 是 TD、選項標了「TD 結案」或帶 `--close-td`、且答案通過終局檢查時才有）：`{ td, from, to: 'closed' | 'wontfix', applied, reason }`
- `published`（`landed:true` 時才有）：`{ state: 'pushed' | 'pr-opened' | 'unpublished' | 'nothing-to-publish', reason, detail, spans, commit?, pr_url? }`；`unpublished` 時 stderr 另印一行原因

各 `reason`、`td_status`、`published` 的處置見 `rules/回答落檔判準.md`（Rule 4、6、9、10）。NEVER 改用 inline import `answerDecision`。

## revise

改一個已經答過的答案，並就地改寫 carrier 上那段決策紀錄。repo 解析與 `answer` 相同。

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts revise '<span_id>' \
  --answer '<新答案>' [--repo <name>] --apply
```

只在 Charles 明說要推翻 `follow-up` 推論鎖時：

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts revise '<span_id>' \
  --answer '<新答案>' [--repo <name>] --override-follow-up --reason '<Charles 給的理由>' --apply
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `<span_id>` | 必填（positional） | 要改答的 span |
| `--answer '<text>'` | 必填 | 新答案，格式同 `answer` |
| `--repo <name>` | 同 `answer` | 佇列上的 repo 名稱 |
| `--override-follow-up` | 選填 | 只越過 `follow-up` 推論鎖；對 `pickup` 鎖永遠拒 |
| `--reason '<why>'` | 帶 `--override-follow-up` 時必填 | 寫進 `decision.revise` payload 的 `override_reason`；缺了回 `override-reason-required` |
| `--actor A` | 選填，預設 `flow-cli` | 修訂者 |
| `--via <text>` | 選填 | 預設 `修訂（flow revise）` |
| `--apply` | 寫入時必帶 | 帶 `FLOW_CLI_CONTRACT=2` 前綴時，不帶 `--apply` 只回傳會寫成的 `block`；沒帶前綴的過渡期，不帶 `--apply` **仍會寫入**（印 `flow: deprecated-default`），要預演只能用舊名 `--dry-run`。規則同 `answer` |

輸出：與 `answer` 同形的 JSON，另帶 `locked`（`{ by: 'pickup' | 'follow-up', at, actor }` 或 `null`）與 `revisions`（含本次的修訂次數）。`ok:false` 時 `reason` 可能是 `not-answered`、`picked-up`、`override-reason-required`、`no-such-decision`、`spine-override`、`accept-not-revisable`；處置見 `rules/回答落檔判準.md`。

## publish-answers

補送：把留在工作區、還沒進 origin 的決策紀錄照各 repo 的 workflow 送出去。`flow answer` 落檔後自己會做一次；這一支給那一次沒送成的，以及 `flow status --stalled` 列出的 `answer-not-published`。

```bash
cd ~/offline/clade && FLOW_CLI_CONTRACT=2 node vendor/scripts/flow/flow.ts publish-answers  # 只列（沒帶前綴的過渡期，不帶 --apply 仍會送出）
cd ~/offline/clade && node vendor/scripts/flow/flow.ts publish-answers --repo <name> --apply  # 送一個 repo
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| （無） | — | 掃 roster 上每個 repo |
| `--repo <name>`／`--repo-root <path>` | 選填 | 只處理一個 repo，解析同 `answer` |
| `--apply` | 送出時必帶 | 帶 `FLOW_CLI_CONTRACT=2` 前綴時，不帶 `--apply` 只列出每筆紀錄的 `file`、`spans`、`pure` 與該 repo 的 `policy`，不 commit、不 push；沒帶前綴的過渡期，不帶 `--apply` **仍會送出**，要只列得用舊名 `--dry-run`（規則同 `answer`） |

輸出：JSON `{ dry_run, records: [{ repo, file, policy, state, reason, detail, spans, commit?, pr_url? }] }`。exit 0 = 全部送出或沒有東西要送；**exit 3 = 有 `unpublished`**，逐筆照 `rules/回答落檔判準.md` Rule 9 處置。只提交「整個 diff 都是決策紀錄」的 carrier；檔上有別的未提交改動就不動。

## ask-options

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts ask-options '<span_id>' [--repo <name>]
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `<span_id>` | 必填（positional） | `flow pending` 該題的 `span` 行 |
| `--repo <name>`／`--repo-root <path>` | 題目有 `[<repo>]` 前綴、且不是 `[clade]` 時必填 | 解析同 `answer`（`@<機器>` 前綴只填 repo 名）。沒帶就寫進 **cwd 所屬 repo** 的 spine：別 repo 的題會回 `no-such-decision`，stderr 印持有那題的 repo 名，補上 `--repo` 重跑 |
| `--actor A` | 選填，預設 `charles` | 留言者 |

`flow pending` 對「沒給選項也沒說要填什麼」的題印的就是這支指令（`要選項：…` 那行不帶 `--repo`，照抄時依題目的 `[repo]` 補上）。它替 Charles 對出題者留一筆「請補選項」的 clarification（文字固定，不由人打），**不會當場產生選項**：選項要等出題的 session 或主持者補上，補完的題在下一次 `flow pending` 才帶選項出現。不在預演／`--apply` 契約內，跑了就寫。輸出：一行 JSON `{"written": true, "span_id": "..."}`；失敗時 exit 1、`written:false` 帶 `reason`（`already-resolved` 代表那題已經答掉）。

## dismiss

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts dismiss '<span_id>' \
  --reason '<為什麼寫掉，附查證證據>' [--repo <name>] [--actor <誰>] --apply
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `<span_id>` | 必填（positional） | `flow pending` 該題的 `span` 行 |
| `--reason '<why>'` | 必填 | 寫掉的理由與查證證據，缺了直接拒 |
| `--repo <name>`／`--repo-root <path>` | 題目有 `[<repo>]` 前綴時必填 | 照佇列上那題的 `repo` 欄位，解析同 `answer` |
| `--actor A` | 選填，預設 `human` | 寫掉的人 |
| `--apply` | 寫入時必帶 | 帶 `FLOW_CLI_CONTRACT=2` 前綴時，不帶 `--apply` 只預演——**照樣回 `ok:true`、exit 0，但什麼都沒寫**，所以 `ok:true` 不能當成「已寫掉」；沒帶前綴的過渡期，不帶 `--apply` 仍會寫入（印 `flow: deprecated-default`）。規則同 `answer` |

把重複、過時或已在別處結案的題寫掉。帶 `⏳ 疑似過時` 子行的題，子行給的整行指令沒帶 `--apply`，照抄時 MUST 補上。輸出：一行 JSON，`ok:false` 時 exit 1。寫掉後重跑 `flow pending` 確認那題消失才算寫掉。什麼時候可以寫掉見 `rules/分組討論判準.md`。
