# state 寫入 —— 五道保護與 STATE_* token 處置


SKILL.md Step 7.3 留的是一條判讀規則（非 `STATE_OK` 即停）。本檔收的是**收到某個 token 之後**
才需要的東西：每道保護擋掉什麼、每個 token 怎麼處置、`.bak` 的救援契約。

**NEVER 憑印象在 token 之間選處置**——`STATE_CORRUPT_REFUSED`（正本壞了、不動它）與
`STATE_ROUND_REGRESS`（patch 算錯、確認過才加 flag）的方向相反。

## 五道保護

- 新內容寫進同目錄 temp 後**讀回來 parse 一次**才換正本（rename 要原子就必須同目錄）
- `.bak` 先寫 temp 再 rename —— `cp` 中途失敗不會把既有備份截斷。漏掉這道的長相是：`.bak` 寫壞、正本照換、還印 `STATE_OK`，兩份一起沒了
- 換檔用 `rename(2)`（即 `mv -T` 語義）：`state.json.bak` 若是**目錄**（前一次救援留下的、或誰手滑 mkdir 的）直接失敗，**NEVER** 把備份搬進那個目錄還回成功——無 `-T` 時該情境會回 `STATE_OK` 而備份根本不存在
- `round` 不得倒退 —— 倒退代表本輪讀到的是舊 state 或 patch 算錯，續寫會靜默吃掉中間輪次的 bookkeeping。確認過是刻意的才加 `--allow-round-regress`
- retention pass（`--no-retention` 關閉）—— 契約見 Step 1 § Retention。archive **先**落地才換正本，所以被移出正本的內容不會兩邊都不在

**stderr 的 `STATE_ARCHIVE_FAILED` / `STATE_OVERSIZE` 都不是失敗 token**（stdout 仍是 `STATE_OK`、exit 0），**NEVER** 因為看到它們就中止本輪 bookkeeping：

- `STATE_ARCHIVE_FAILED: <原因>` —— 本輪不 rotate、state **照原樣完整**寫入。正本是完好的，停下來只會讓本輪已完成的 bookkeeping 懸空。記進 `sessionNote` 讓下一輪知道 archive 落點有問題，然後**照常收尾**
- `STATE_OVERSIZE: …｜前三大：<欄位=bytes>` —— 被點名的欄位是自創欄位（無 reader 契約），處置見 Step 1 § Retention：**當輪**收斂掉它

**現有 `state.json` parse 不過時它回 `STATE_CORRUPT_REFUSED` 並且不動正本**，**NEVER** 當成 `{}` 從頭寫 —— 那會讓 `round` 從 0 重來且每個欄位看起來都合法（處置走 Step 1 § `STATE_CORRUPT` 的還原程序）。

**看到 `STATE_WRITE_FAILED` / `STATE_BACKUP_FAILED` / `STATE_ROUND_REGRESS` / `STATE_CORRUPT_REFUSED` MUST 立刻停止本輪 bookkeeping**（`STATE_OK` 以外的每一個都是）：四者都保證正本仍是上一輪的完好版本，照 7.2 Iron Law 的無害方向倒（HANDOFF 已寫、state 未寫，下一輪冪等重做）。`STATE_BACKUP_FAILED` 額外意味著磁碟或權限有問題，**MUST** 在 `sessionNote` 記一筆再重試。**NEVER** 因為「內容應該沒問題」跳過驗證，也 **NEVER** 在失敗後改用直接覆寫繞過。

## `.bak` 的救援契約

**`.bak` 只保留上一輪的完好版本，NEVER 累積多份帶時間戳的副本**——救援時要能一眼看出該還原哪一個。
且 **NEVER 把寫壞的檔存成 `.bak-<ts>`**：那個名字會讓還原程序把屍體當備份撿起來；寫壞的檔存成
`state.json.corrupt-<ts>`。

## state 欄位 schema 與讀取端還原（主檔 Step 1 下推）

> 主檔 pointer：Step 1 讀到 `STATE_CORRUPT`、寫入或判讀 state 欄位（`notes`／`awaiting`／`packaged`／`refused`／`decisions`／`blockers`）、讀到截斷標記、或 writer 印 `STATE_OVERSIZE` 時 MUST 讀本節。2026-10-06（TD-833 第 6 項）自主檔搬來；還原程序、schema 與欄位語義的本體只在本節，主檔只留觸發時機。

### 讀取端 `STATE_CORRUPT` 的三步還原程序

主檔 Step 1 禁止把 `STATE_CORRUPT` 當成空物件的原因：空物件會讓 `round` 從 0 重來、`awaiting` / `decisions` / `failStreak` 全空——上游那 N 輪的記憶一次歸零，而每個欄位看起來都「合法」，沒有任何一步會報錯。還原程序（依序）：

1. `state.json.bak` parse 得過 → `mv` 回正本，本輪的 `sessionNote` **MUST** 記「從 .bak 還原，round <N> 的 bookkeeping 可能遺失」。還原回來的 `sessionNote` 若以 `⟨截斷 …⟩` 收尾，全文在 `state-archive.json` 的 `sessionNotes.r<N>`（見 § Retention）——**MUST** 讀那份全文再判上一輪做到哪，**NEVER** 只憑截斷後的頭 800 字下判斷
2. `.bak` 也壞或不存在 → **STOP，NEVER 自行重建一份新 state**。沒有第二份現況可抄（HANDOFF 自 2026-08-13 起不 render 進度），重建輪次與 awaiting 是**人**的工作，不是本輪的
3. 兩者皆不可用 → 標 `stoppedReason: state-unrecoverable` 並回報 user

### schema 範例與欄位語義

```json
{
  "round": 7,
  "startedAt": "2026-08-05T03:11:00Z",
  "lastRoundAt": "2026-08-05T04:02:13Z",
  "fingerprint": "sha256:abc123…",
  "fingerprintUnchangedRounds": 1,
  "nonProductiveRounds": 0,
  "subagentsSpawned": 4,
  "consecutiveDispatchFailures": 0,
  "guardrailsAck": "2026-08-05T04:02:10Z",
  "sessionNote": "本輪一句話紀錄（值得留痕的事）",
  "notes": "string，不是 object：sandbox 無外網；pnpm 一律 --prefer-offline",
  "lockSessionId": "mshkf6es-mptx87qc-ubuntu",
  "inFlight": [{ "agent": "wt-td317", "item": "TD-317", "dispatchedAt": "…",
                 "taskId": "<Bash harness task id 或 null>", "owner": "work-loop-dispatch",
                 "deadline": "<ISO 或 null>", "lifecycle": "dispatching|dispatch-failed|pending|harvesting|harvested|cancelling" }],
  "packaged": { "TD-402": "2026-08-05T03:40:00Z" },
  "awaiting": [{ "id": "TD-402", "title": "grain 二選一", "packagedAt": "2026-08-05T03:40:00Z",
                 "round": 6, "blocker": "src/db/schema.ts:88 …", "startableDone": "index 已補齊",
                 "requiresSpecificConsent": false, "state": "awaiting",
                 "options": [{ "key": "A", "label": "…", "effect": "…", "recommended": true },
                             { "key": "B", "label": "…", "effect": "…" }],
                 "rationale": "…", "nextStep": "交 wt 建立 td402 隔離環境：…" }],
  "refused": { "TD-401": { "answer": "B", "scope": { "resource": "…", "action": "…" }, "refusedAt": "…", "note": "<Charles 逐字>" } },
  "decisions": { "TD-355": { "answer": "A", "outcome": "granted", "note": "<Charles 逐字>", "answeredAt": "…",
                 "grant": { "actionFingerprint": "sha256:<item + exact scope>", "scope": { "resource": "…", "action": "…", "pathsOrRefs": ["…"], "exclusions": ["…"] }, "grantedAt": "…", "consumedAt": null } } },
  "failStreak": { "TD-388": 2, "fix-pinia-mutation": 1 },
  "escalated": { "add-audit-log": { "state": "blocked", "reason": "…" } },
  "blockers": { "TD-402": { "fingerprint": "sha256:…", "blocker": "<原文>",
                            "unblockPredicate": "<一條可觀察 predicate>", "predicateValue": "<上次量到的值>",
                            "firstSeenRound": 12, "lastCheckedRound": 18 } }
}
```

`blockers` 是 blocker 指紋表，讓同一批卡住的 item 不必每輪重新診斷一次——欄位語義、三步查表、入表門檻與清表時機在 [reference/blocker-ledger.md](blocker-ledger.md)，**此處不複述**。舊 state 檔沒有這個欄位是正常的（本欄位之前的版本），當成空物件起算即可。

**`notes` 的型別是 string，寫入方式是改寫、不是累加。** 它存的**只有**「下一輪仍然成立的 sandbox / 環境事實」——無外網、某個 CLI 缺 binary、某條路徑在本機解不到。每一輪都是把整段**重寫**成當下仍成立的版本：已經不成立的句子刪掉，新的事實寫進同一段散文。

- **NEVER 把 `notes` 寫成 object**，也 **NEVER** 在它底下開 `notes.r<N>` / `notes.round42` 這類逐輪 key。實測（2026-08-12 round 59，某 consumer round=38）：object 型 `notes` 長到 **27787 B**，佔該 runtime 三個累積欄位的 88%；同期兩個 string 型 runtime 停在 1.3–1.7 KB，而其中一家的輪數還更高——驅動因素是**型別**不是輪數。object 形態讓「每輪 append 一個新 key」變成最省事的寫法，string 形態逼人改寫既有句子。
- **NEVER 拿 `notes` 記本輪發生過什麼**——那是 `sessionNote` 的職責，且它有 retention 接住。事件記進 `notes` 就永遠不會有人來刪，因為讀者分不出哪一條還成立。
- **NEVER 記進 `notes` 留給下一輪處理**：本輪看到的收斂義務（§ Retention 的 `STATE_OVERSIZE`）**當輪**就要做掉。

本欄位**刻意不訂位元組上界**：上界會把判斷換成算數，而該刪的判準是「這句話還成不成立」，不是「超了幾個 byte」。§ Retention 對 `notes` 的截斷是**讀取端的止血**，**NEVER** 讀成「寫多少都有人幫我剪」——被截掉的部分下一輪就看不到了。

**`awaiting` / `packaged` / `decisions` 三者的關係**（寫錯會讓已答的決策被重問，或已問的被當成沒問）：

| 欄位 | 語義 | 唯一寫入時機 |
| --- | --- | --- |
| `awaiting[]` | **只放 unresolved** 的待答決策，帶完整選項內容。`requiresSpecificConsent=true` 不得自主 prune；答覆後必須出列 | Step 4b packaging 入列、Step 2.7 granted / refused 皆出列 |
| `packaged` | `awaiting[]` 的 `id → packagedAt` 投影，供 Step 2 排除用 | 與 `awaiting[]` 同步增刪，**NEVER** 單獨寫 |
| `refused` | 已明確拒絕的 scope ledger；Step 2 scan 必須排除這些 id，避免重問或自行執行，但它**不計入** attended 的 unresolved queue | Step 2.7 收到 refused 當下寫入；只有 user 之後明確改變決定才移除 |
| `decisions` | 已答的答案（含 Charles 逐字）、`outcome: granted|refused` 與逐字 note，**答完不刪**——後續輪次照它執行。較舊的條目會被 retention 轉成 stub（key 與 `answer` 都還在，見 § Retention），語義不變。specific shared-action consent 只能建立 action fingerprint 完全相符的 one-shot `grant`；dispatch 前原子寫入 `consumedAt`。**NEVER** 重用已消耗 grant | Step 2.7 (c) 收到答案當下；消耗發生在同一 action instance dispatch 前 |

**舊 state 檔只有 `packaged` 沒有 `awaiting`**（本欄位之前的版本）→ 用 HANDOFF `## ⏳ Awaiting Charles` 的對應 `###` 子段回填成 `awaiting[]` 條目，回填不出來的（子段已不存在）直接把該 key 從 `packaged` 刪掉。

### Retention（state 正本只留會改變路由的內容）

state.json 每輪被**整讀**一次，所以它的體積是一筆與本輪成果無關的固定成本（2026-08-13 clade 實測 48.6 KB，TD-491）。`work-loop-state-write.ts` 每次寫入時自動把下列內容 rotate 進**同目錄**的 `state-archive.json`，正本只留路由需要的部分：

| 正本欄位 | 留下什麼 | 全文去哪 |
| --- | --- | --- |
| `sessionNote` | 頭 800 字元 + `…⟨截斷 N 字元，全文見 state-archive.json sessionNotes.r<N>⟩` | `sessionNotes.r<N>` |
| `notes` | 頭 1200 字元 + 同款標記 | `notes.r<N>` |
| `decisions` | 最近 12 筆全文；更舊的轉 stub `{ answer, answeredAt, archivedAt: "r<N>" }` | `decisions.<key>` |
| `completed` | 最近 8 筆 | `completed[]` |

**`decisions` 的 key 與 `answer` NEVER 因 rotate 而消失**——這正是三欄位關係表要防的失敗（已答的決策被重問）。看到某 key 帶 `archivedAt` 就是「這條已答、答案是 `answer`」，照它執行即可；**只有需要 Charles 逐字理由時**才去讀 `state-archive.json`。

**自創欄位 MUST 自己收斂。** `nextRoundQueue` / `decidedHoldSteady` / `roundFindings` / `legitimateSkips` 這類不在本 schema 的欄位沒有 reader 契約，retention **不會**替它們修剪——猜著剪的失敗是靜默資料遺失。寫這些欄位的**每一輪**都 MUST 只留下輪真的會用到的條目，**NEVER** 把歷史累積留著等人清。writer 在 state 超過 24 KB 時於 stderr 印 `STATE_OVERSIZE: <bytes>｜前三大：<欄位=bytes>`——**看到它 MUST 當輪就把被點名的欄位收斂掉**，`NEVER` 記進 `notes` 留給下一輪。

## Scratch 命名 contract 與 sweep（主檔 Step 7.3 下推）

> 主檔 pointer：本輪要在 `.clade/work-loop/` 寫任何中間檔或大型 dump、或改 sweep 判準之前 MUST 讀本節。命名與落點的判準本體在主檔 Step 7.3；sweep 的呼叫點、白名單與保留期限只在本節。

主檔 Step 7.3 的命名 contract 裡 `N` = 本輪 round，套用對象是每一個中間檔，不是只有「看起來會留很久的那幾個」。sweep
（`work-loop-state-write.ts` `sweepScratch`）有三個呼叫點：Step 7.3 的 state-write 清 `N < round-3`；runner
輪末（child 已退出）再清 `N < round-1`，且帶 marker 的單檔 >1MB 一律刪（orphan／quarantine guard 即將
觸發的輪改帶 `--keep-evidence`，不套 size-based 刪除，證據留給 attended reconciliation）；runner 起跑時
（互斥鎖門檻確認鎖未被持有之後、preflight 之前）以輪末同一套判準再掃一次，所以 preflight 就退出、一輪都
起不來的 repo 也會收斂——鎖被持有或狀態無法確認時不掃。**沒帶 marker
的檔與 `logs/round-*.log` 超過 30 天即刪**——不命名就只能活到變 legacy。`logs/round-*.log` 被清不影響
`work-loop-cost-metrics.mjs`：runner 每輪把 round 分檔／收尾原因／訊號（`logClass`，口徑單一來源
`work-loop-round-classify.mjs`）隨 ledger 行落進 `rounds.jsonl`，sweep 刪 log 前若 ledger 沒有該 log 的
`logClass` 會先補一行 `backfill`，補不進去就不刪；cost-metrics 以 `rounds.jsonl` 為 round 資料來源。
sweep 全程只用 `lstat`、symlink 一律跳過，任何單檔 stat／rm 失敗只計入 failed、NEVER 中斷 state write。2026-08-26 clade home 實測 291 檔
22MB，2026-10-01 實跑輪後仍 147 檔 11MB（TD-675）——agent glob 誤讀一個就是一次 context 事故。

大型 dump 指 `flow status` 全量輸出這類 >1MB 的檔；落進本目錄也活不過輪末。`state*` 與 `lock` / `stop` / `logs/` / `scan-latest.json` / `scan-prev.json` /
`rounds.jsonl` / `unharvested.json` / `orphan-quarantine.json` / `adhoc-mjs.jsonl` /
`selfverify-cache.json` / `signal-probe-baseline.json` 是執行狀態不是 scratch，sweep NEVER 碰它們。
sweep 刪 `.mjs` 前把檔名記進 `adhoc-mjs.jsonl`，`scripts/audit-flow-nodes.ts` 的 ad-hoc 計數讀它。

## routingSummary 欄位語義（主檔 Step 7.3 下推）

`routingSummary.eligibleObserved` 只計**已進 dispatcher** 的 eligible decision／explicit dispatch；structured waiver 不在 dispatcher ledger，故不冒充完整 eligibility 分母。`dispatched`、各 exit、model mix、fallback lineage 與 token 欄皆直接來自 ledger，所以零 dispatch 的輪也有一份全零的 summary 可寫。

## 主檔 Step 0／1／7 判準的理由（判準本體在主檔，本節不複述）

> 判準只有一份，在主檔 SKILL.md 標示的 Step；本節只放那些判準的理由與證據，不複述判準。判準的增修只落主檔。

- **Step 0 開場佇列檢查，損毀不折成 0**：runner 的 child 恆為 unattended，把損毀讀成空佇列製造的正是該檢查要修的佇列滯留，只是換成由讀取端製造。
- **Step 1 從 state 重建**：理由不是保守，是機制事實——狀態外部化之後，compaction 只丟敘事、不丟事實。
- **Step 7.2 進度不進 HANDOFF**：每輪整段覆寫一份 state 的 markdown 副本，買到的只有「每輪一次必然的 diff ＋ 一份會過期的第二現況」。
- **Step 7.3 不直接覆寫 state**：靜默失敗的長相是寫入工具照樣回成功，下一輪才在讀取端炸開。temp → 驗 → 備份 → rename 這個序列逐輪不變，逐輪變的只有欄位值，所以沒改的欄位不必重述。
- **Step 7.3 patch 是淺層合併**：深合併會把已經移除的條目悄悄留下來。
- **Step 7.3 五道保護**：temp 讀回驗證、`.bak` 先 temp 再 rename、`rename(2)` 語義、`round` 不得倒退、retention pass（各自擋掉什麼見本檔 § 五道保護）。
- **Step 7.3 寫完刷 lock**：鎖的 heartbeat 只在 Step 1 / Step 5 / Step 7.3 被刷。
- **Step 7.4 commit message 形狀**：**emoji 與中文 subject 都不是裝飾**——clade 與各 consumer 的 `commit-msg` hook 跑 commitlint，配錯或漏 emoji 會讓 header 整個解析失敗、並誤報成 `subject-empty`；clade 另有 `subject-has-chinese`。
