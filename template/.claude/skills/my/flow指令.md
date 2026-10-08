
# `flow` 指令查表（`\my` 用）

本檔只收 `\my` 會用到的五個子命令。指令與旗標以 `node vendor/scripts/flow/flow.ts --help` 及 `vendor/scripts/flow/flow.ts` 的實作為準；判準（什麼時候問、怎麼寫選項、失敗怎麼處置）不在本檔，見 `rules/`。

共同前提：

- `pending`／`answer`／`revise` **在 clade checkout 執行**（`cd ~/offline/clade`，或設 `CLADE_HOME`）。`ask` 例外：它把題目寫進**當前 cwd 所屬 repo** 的 spine（在 linked worktree 會改寫到該 repo main checkout），沒有 `--repo`，所以 MUST 在**該題所屬 repo 的 checkout** 執行（例：`<consumer-id>` 的題 `cd ~/offline/<consumer-id> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask …`）；在 clade 跑會把別 repo 的題標成 `[clade]`、答案落到 clade 的 carrier。`flow` 以 `CLADE_HOME`，否則以 cwd 的 `git rev-parse --show-toplevel` 當根目錄；fleet roster 與 `--repo` 名稱解析都從這個根讀：roster＝`consumers.local` ∪ `registry/consumers.json` 上本機有 checkout 的 consumer（含 `pending_onboard`），所以沒跑過 `bootstrap-consumers-local.ts` 的機器也讀得到全部已登記的 repo。在 consumer 目錄跑 `pending`（那裡兩個來源都沒有）會印 `⚠ 找不到 <consumer>/consumers.local，只能看這一個 repo` 並只列那一個 repo。
- 下文的 `flow` 都是 `node vendor/scripts/flow/flow.ts` 的簡寫。

## pending

讀待拍板佇列，照 `\my` 的格式渲染。五個來源（四個檔案來源＋spine）已在這裡收斂。

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts pending
```

| 旗標 | 作用 |
| --- | --- |
| （無） | Fleet 預設：讀 roster 上每個 repo |
| `--repo-only` | 只讀當前根目錄這一個 repo |
| `--audience all` | 連問 coordinator 的題（`--audience coordinator`／`--decision-for coordinator` 開的）一起顯示；值只收 `all`／`charles`／`coordinator`，打錯 fail closed |
| `--json` | 輸出 `{ asked, gated, measurements, … }` JSON，不渲染 |

輸出與退出碼：

- 區段順序：`要我拍板` → `要我驗收` → `要我動手` → `不在本 repo` → `loop 結構性推不動` → `未分類` → `卡住、等人動手` → 最後一行現況量測（當下實跑，例：`clade: dirty 7 / worktree 21　<consumer-id>: stash 3`；全乾淨時是 `全 roster 乾淨：無 dirty、無 worktree、無 stash、無 lock`）。
- `Qn` 只出現在 `要我拍板` 與 `要我驗收`，編號連續；其餘為 bullet。題目子行可能有 `A./B.` 選項（推薦那條帶「（推薦）」）、`⚠` 警示、`✎` 寫法評語、`→` 動作／步驟、`答案落到：<carrier>`、`可回：X／Y`（僅動手桶）、`span <span_id>`。
- 每題行首的 `[<repo>]` 就是 `flow answer --repo` 要逐字照抄的值。
- 帶 `⏳ 疑似過時：<證據>` 子行的題排在同一區段最後：watch 的過時掃描判它前提可能已消失、但信心不到代寫掉（問 Charles 的題、題目內文才提到的 PR、有來源檔等）。多半不用答；查證屬實就照子行給的 `flow dismiss` 寫掉。被機器自動下架的題 `dismissed_by` 是 `stale-sweep`，reason 以「前提已不存在（<規則>）」起頭。
- exit 0 = 佇列有東西；**exit 2 = 佇列空**（印 `佇列是空的。`），不是錯誤。

## ask

把一題推進佇列（開一個 `decision.request` span）。admission 不過就 exit 1 並印出可照抄的改法。

```bash
cd <該題所屬 repo 的 checkout> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<一句人話的問句>' \
  --question '<一句話講完，讀者沒有 scrollback>' \
  --option '<短標籤> :: <按了會怎樣>' --option '<短標籤> :: <按了會怎樣>' \
  --recommended '<推薦那條的短標籤>' --why '<一句為什麼>' \
  --carrier '<TD-NNN | HANDOFF.md | tasks/xxx.md>' --actor '<你的 pane id>'
```

要的是一個值而不是選擇時：

```bash
cd <該題所屬 repo 的 checkout> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --question '<要填什麼、為什麼>' \
  --needs-value --field '<欄位名>' --field '<欄位名>' \
  --carrier HANDOFF.md --actor '<你的 pane id>'
```

只有 Charles 做得了的工作（題目是範圍，執行寫成步驟）：

```bash
cd ~/offline/<consumer-id> && node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<consumer-id> 跑 dep batch：範圍？' \
  --question '<背景與要選的範圍>' \
  --option '<範圍 A> :: <後果>' --option '這輪不跑 :: <後果>' \
  --recommended '<範圍 A>' --why '<一句為什麼>' \
  --step 'Charles 在 <consumer-id> 親自打 /version-upgrade → Outdated mode' \
  --carrier HANDOFF.md --actor '<你的 pane id>'
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `--question Q` | 必填 | 完整問句（**不是** positional）。本文裡自己列了 `(A)`／`(B)` 卻沒有 `--option` 會被拒 |
| `--option '<短標籤> :: <後果>'` | 選一個時 2–4 條 | 可重複，一條一個旗標；短標籤 ≤16 字。字母前綴與「（推薦）」由寫入端剝掉，NEVER 寫進文字 |
| `--recommended '<短標籤>'` | 選一個時必填 | 推薦那條的短標籤 |
| `--why '<理由>'` | 選一個時必填 | 一句為什麼推薦 |
| `--needs-value` ＋ `--field F` | 要值時必填 | 取代 `--option`；每個要填的值一條 `--field` |
| `--step S` | `human-action` 沒有可用選項時必填 | 要人到場做的動作，一條一個；拍板題也可帶，卡上印成 `→` 行 |
| `--headline H` | 選填 | 卡片標題，一句人話問句，不放 work id／SHA；沒給就用 `--question` |
| `--category C` | 選填，預設 `ruling` | 只收 `ruling`／`review`／`other-repo`／`human-action`／`loop-structural` |
| `--carrier PATH` | 選填 | 答案落點（`TD-NNN`、`HANDOFF.md`、`docs/tech-debt.md`、`tasks/xxx.md`）；`TD-NNN` 落到 `docs/tech-debt.md` 該 entry 尾；不給則答案只存在 spine |
| `--actor A` | 選填，預設 `unknown` | 發問者（pane id） |
| `--work-id W` | 選填 | 掛到既有 work item |
| `--audience charles\|coordinator` | 選填，預設 `charles` | `coordinator` 不進人的預設佇列，也不受 admission 表限制 |
| `--deadline D --deadline-basis B` | 選填，成對 | 有期限的題排最前（72 小時內到期）；basis 必填 |
| `--dedupe-key K` | 選填 | 同一件事的第二次發問併進同一張卡 |
| `--ref pr:<N>｜pr:<repo>#<N>｜td:TD-<N>` | 選填，可重複 | 這題的前提依附在哪個 PR／TD 上。它在**題目問出之後**終局（合入、關閉、結案），watch 的過時掃描就自動把這題下架；問出之前就已終局的算前提，不算證據。涉 production／花費／政策的題只標不寫。沒有任何可核對參照（`--ref`、dispatch、題目裡的 PR／TD）時 stderr 會提醒，不擋 |
| `--supersede <span>` | 被「已有答案」拒收且現況變了才帶 | 指到拒收句列出的那一題才放行；記在 `payload.supersedes` |
| `--options 'A,B'` | 舊寫法 | 以逗號切選項，選項本文含逗號時會切壞；用可重複的 `--option` |
| `--question-page`／`--question-page-label` | 已退役 | 帶了直接被拒 |

寫入前的兩道拒絕（只對問 Charles 的題，exit 1；處置見 `rules/待拍板條目寫法.md` Rule 23）：同一 repo 同一 carrier 14 天內已有 Charles 的答案 → 印出既有答案與日期；cwd 的 repo 在 clade 旁邊卻不在 roster 上 → 印三條改法。

輸出：一行 JSON `{"span_id": "...", "work_id": "..."}`——**記下 `span_id`**，Phase 2 要用它標 `[本輪從對話撈出]`。在 linked worktree 裡執行時，落點會改寫到 main checkout 的共用 spine，stdout 多帶 `spine`／`rerouted_from`，stderr 印一行說明。

## answer

回答一題：關 span、把決策紀錄寫進 carrier 的 `## 決策紀錄` 節（`td:` carrier 為該 TD entry 尾）、量測 tech-debt hygiene 差集；carrier 是 TD、選中的選項標了「TD 結案」（或帶 `--close-td`）且答案通過終局檢查時關掉那條 TD；最後照該 repo 的 workflow 把紀錄送進 origin。

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts answer '<span_id>' \
  --answer '<他的答案>' --repo '<那題的 repo 欄位，逐字照抄 flow pending 給的值>'
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| `<span_id>` | 必填（positional） | `flow pending` 該題的 `span` 行 |
| `--answer '<text>'` | 必填 | 選項題寫 `<字母>. <短標籤>`；驗收寫 `通過` 或 `退回：<理由>`；給值或自由回覆照原文 |
| `--repo <name>` | 題目有 `[<repo>]` 前綴時必填 | 佇列上的 repo **名稱**，由 `resolveRepoRootByName` 解析；NEVER 填路徑。名稱不在 roster 上時印 `roster 上找不到 repo「<name>」——不寫入…` 並 exit 1 |
| `--repo-root <path>` | 只有 repo 不在 registry 上時 | 直接指那個 checkout；span 必須在它的 spine 上（判準見 `rules/回答落檔判準.md` Rule 2） |
| `--close-td` | 選項沒標「TD 結案」、但 Charles 明說要關那條 TD 時 | 補上關 TD 的來源；答案文字仍要過終局檢查才關（判準見 `rules/回答落檔判準.md` Rule 10） |
| `--via <text>` | 選填 | 決策紀錄的來源說明，預設 `Charles 在 chat 回答，由主線代填` |
| `--dry-run` | 選填 | 不關 span、不寫檔、不散播；輸出的 `block` 逐字就是等一下會寫進去的那段 |

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
  --answer '<新答案>' [--repo <name>]
```

只在 Charles 明說要推翻 `follow-up` 推論鎖時：

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts revise '<span_id>' \
  --answer '<新答案>' [--repo <name>] --override-follow-up --reason '<Charles 給的理由>'
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
| `--dry-run` | 選填 | 不寫入，只回傳會寫成的 `block` |

輸出：與 `answer` 同形的 JSON，另帶 `locked`（`{ by: 'pickup' | 'follow-up', at, actor }` 或 `null`）與 `revisions`（含本次的修訂次數）。`ok:false` 時 `reason` 可能是 `not-answered`、`picked-up`、`override-reason-required`、`no-such-decision`、`spine-override`、`accept-not-revisable`；處置見 `rules/回答落檔判準.md`。

## publish-answers

補送：把留在工作區、還沒進 origin 的決策紀錄照各 repo 的 workflow 送出去。`flow answer` 落檔後自己會做一次；這一支給那一次沒送成的，以及 `flow status --stalled` 列出的 `answer-not-published`。

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts publish-answers --dry-run          # 只列
cd ~/offline/clade && node vendor/scripts/flow/flow.ts publish-answers --repo <name>      # 送一個 repo
```

| 旗標 | 必填性 | 作用 |
| --- | --- | --- |
| （無） | — | 掃 roster 上每個 repo |
| `--repo <name>`／`--repo-root <path>` | 選填 | 只處理一個 repo，解析同 `answer` |
| `--dry-run` | 選填 | 只列出每筆紀錄的 `file`、`spans`、`pure` 與該 repo 的 `policy`，不 commit、不 push |

輸出：JSON `{ dry_run, records: [{ repo, file, policy, state, reason, detail, spans, commit?, pr_url? }] }`。exit 0 = 全部送出或沒有東西要送；**exit 3 = 有 `unpublished`**，逐筆照 `rules/回答落檔判準.md` Rule 9 處置。只提交「整個 diff 都是決策紀錄」的 carrier；檔上有別的未提交改動就不動。
