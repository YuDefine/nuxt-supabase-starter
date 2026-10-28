# Relay Mode — `/handoff relay`

把**本 session 的整個位置**交給另一個可獨立續跑的 Herdr interactive pane，然後收工；successor runtime 依 [dispatch-common.md](dispatch-common.md) § 3.1 **原樣繼承當前 session**（`cc → cc`、`ccN → ccN`、`grok → grok`）。只有 user 當次明確點名不同且受支援的 launcher 才可覆蓋；工作 routing 不構成授權。

成功事件是 helper 回傳 **`relay_dispatched`**，代表 successor 已 live、已收到 brief、durable 轉移已落盤。**不是**「successor 完成了工作」——那不再是本 session 的事。

Preflight、durable thin brief 紀律、`--label` 要求、runtime cleanup、parent worktree lifecycle、收工訊息契約全部依 [dispatch-common.md](dispatch-common.md)，本檔不重述。

## 0. 先判該不該用 relay

| 手上有幾件可平行的工作 | arg |
| --- | --- |
| 0（只登記，不派） | `park` |
| 1 | `relay` |
| N ≥ 2 | `fanout`（見 [fanout-steps.md](fanout-steps.md)） |

**被派出的 pane 先判這一題**（`CLADE_DISPATCH_ID` 非空、要交棒）。交棒理由只有三種：交棒 profile 越過 hard tier、品質退化、同一問題糾正 ≥2 次；壓縮 profile 下 context 大小**不是**理由，寫回 plan.md 並 commit 後續做（席位→profile 表在 `session-tasks.context-budget`）：

評估：first-match；以上皆非 → R*
| id | 可觀察 predicate | 動作 |
| --- | --- | --- |
| R1 | 有 plan.md、主持者是活的（dispatch 有 parent pane、wake 能送達） | **NEVER** 自 relay。把進度寫回 plan.md § 進度、commit＋push，再 `--complete relay-request --plan <plan.md>`；主持者的 watch 收割本 pane（`harvest-relay`），以同 work id、同 worktree、plan 指針另開下一棒 |
| R2 | helper 拒收並印 `self_relay`（沒有 parent pane、主持者冷或不在線）、沒有 plan.md、repo 有 push_hold、或本 session 是 Charles 自開 pane | 照本檔自 relay；brief 仍只寫 plan 指針與本棒差異 |
| R3 | helper 拒收但沒印 `self_relay`（branch 沒 push、plan.md 沒變動） | 補齊材料（寫回 plan.md、commit＋push）再報一次，不改走自 relay |
| R* | 以上皆非 | STOP：`--complete blocked` 回報 helper 原始輸出 |

「1 件」包含**多件但彼此 serial** 的情況：動同一批檔、有 phase 依賴、共享 mutex 資源的工作 **MUST** 合併成一份 brief 走 relay，由 successor 依序推進，**NEVER** 拆成 N 個 worker 同時跑。

本條是 [[agent-routing.dispatch-execution]] § 派多少 的實例。該節多管一種本條字面擋不住的形狀：把 serial 鏈切成「worker ＋ 主線自己留著後半段」——沒有第二個 worker，本條不會 fire。

`CLADE_DISPATCH_ID` 非空（本 session 自己是被派出來的 child）時 relay **照常適用**——helper 對 relay 開了 nested 缺口，因為 relay 做的是把位置橫向移交、自己站下來，與那道 guard 要防的責任樹擴張相反。**NEVER** 因為身在 coordinated child 就改走 `--recover-orphan`：那是「parent 已死、由 child 補救」的路徑，而 relay 的前提正好相反——parent（本 session）還活著，親自簽字交出位置。

已用 `--tier-basis stall-escalation --retry-of <medium label>` 升到 high 的 child，可以沿用這組參數與 `--effort high` relay 同一位置。helper 只豁免與當前 pane **及 exact runtime session** 相符的 live high record；其他 high attempt 與 reclaim／controlled-stop 的紀錄仍會擋第二次升級。Relay 是交接，不新增一次 high attempt。

## 1. 建 durable thin brief

依 [dispatch-common.md](dispatch-common.md) § 2，**外加**三項 relay 專屬內容：

- brief **MUST** 寫明「你是繼任者，不是被派出去做一件子工作的 worker」，以及本 session 交棒的理由（交棒 profile 越過 hard tier／品質退化／同一問題糾正 ≥2 次／工作已全部移交）。
- 本 session 若手上還有 in-flight dispatch，brief **MUST** 逐個列出它們的 dispatch id（指針即可）。在做什麼、預期什麼 outcome 已在 dispatch record（`label`、brief 路徑）與 flow，successor 依 id 自取；**NEVER** 在 brief 重述它們的脈絡或進度。
- brief 交代 PR 收尾時 **MUST** 寫成「ready → 本 head CI 綠 → 0-A finalize → `merge-queue.ts <pr>:<head>`」（coordinator skill `rules/0A與merge佇列判準.md` Rule 1），有主持者就寫「PR 開好交主持者 0-A／merge」。consumer 的 `workflow_model: trunk-based` 只決定自動批次門檻與 base，**NEVER** 讀成「開了 PR 綠了就合」。brief **NEVER** 寫出 `gh pr merge` 指令——helper 以 `self_merge_brief` 拒收（主持者繼任 brief 除外）；要禁止就寫「NEVER 自己 merge」。2026-10-20 #2160 的手寫 relay 寫了「trunk-based 的綠了用 `gh pr merge --rebase`」，三張 consumer PR 因此沒過 0-A 就合入。

## 1.5 spine 收尾（ambient `CLADE_WORK_ID` 非空時 MUST，空則整步跳過）

relay 是收工的四個 arg 之一，本 session 走到這裡同樣是「一段工作結束了」（對應 `park` 的 SKILL.md Step 3b）。
缺這一步的後果不是少一筆紀錄，是**漏斗上游餓死**：沒有任何必經收尾點會去按 spine 的終態。

**MUST 先判這一題再往下**，二擇一，判準是**你正在交出去的 brief 裡寫的是不是同一件事**：

評估：first-match；以上皆非 → N*
| id | 可觀察 predicate | 動作 |
| --- | --- | --- |
| N1 | successor 接手的是**同一件** work（brief 寫的是本 session 沒做完的那件事的續集） | **NEVER emit `work.done`**。work id 走 `dispatchEnv` 繼承過去，successor 是同一件事的延續，這裡不切分（[[flow-work-tracking]] § 一件 work 是什麼）。**整步跳過，不必 emit 任何東西** |
| N2 | ambient work **本身已經做完**，而 brief 交出去的是**另一件**工作 | 先宣告完成再派： |
| N* | 以上皆非（判不出是同一件還是另一件） | STOP：`--complete blocked`，問 brief 是否同一件事 |

```bash
# 只在 N2 適用
node ~/offline/clade/vendor/scripts/flow/flow.ts work done "$CLADE_WORK_ID" \
  --verification '<跑了什麼、輸出是什麼——一句可查證的實跑摘要>'
```

`--verification` 是整套設計唯一的 fail-closed 欄位：缺了 CLI 直接拒寫。**NEVER** 拿
「已完成」「測試通過」這類無指涉的句子填它——那兩句正是這道 gate 要擋的東西
（[[flow-work-tracking]] § R1）。

**MUST 排在 Step 2 之前**：`relay_dispatched` 之後本 session **NEVER 再開任何新工作段**，
而補一筆 done 需要你還在判斷位置上。逐字反開脫：「派完再順手補一筆」——那時 pane 已經交出去了。

沒有 ambient work（env 是空的）→ **整步跳過**，**NEVER** 為了留紀錄而現鑄一個新 work：
一件從沒被指認過的事，在收工這一刻鑄名只會在 /board 上多一列生下來就結束的工作。

指令 **fail-open**：非 0 exit **NEVER** 擋 relay 的其餘步驟，照常交棒。

## 2. 只走 canonical helper

⛔ **先過 [dispatch-common.md](dispatch-common.md) § 1 的 `--cwd` 佔用探測**——successor 的 `--cwd` 指向既存工作區時，與 fanout worker 適用同一道 gate。

⛔ **`<routing-model>` NEVER 是 `sonnet`**（依 [dispatch-common.md](dispatch-common.md) § 3.2）：successor 判「還是主線複雜度」就 `opus`；判「只值 sonnet 等級」則兩條都行——`--launcher grok --model grok-4.7 --effort xhigh` 把位置交給 Grok successor，或本 session 留著、把那件事用 Grok worker 派掉。`relay-continuity` 那道限制只綁 Pi，**NEVER** 讀成 grok 不能當 successor。

⛔ **主持者交棒（brief 的 frontmatter 是 `coordinator_brief: successor`）只能 `--launcher cc|cc2|cc3 --model opus --effort medium`**（`cc3`＝`~/.claude-3` 帳號，只限本機、不走額度 admission）：Grok successor 與上一條的其他選項都不適用，helper 以 `usage_error` 拒（`coordinator` skill § 主持者的 model）。

```bash
node <clade-central-repo>/vendor/scripts/herdr-session-handoff.ts \
  --route <routing-policy> --tier-basis <routing-conclusion> \
  --cwd <absolute-main-checkout> \
  --model <routing-model> --effort <routing-effort> \
  --label <short-task-label> \
  --prompt-file <absolute-brief-path> \
  --relay
```

helper 自行負責 topology、fresh runtime session identity、prompt delivery、in-flight dispatch 的 coordinator 身分轉移、以及寫出讓 successor 回收本 pane 所需的 predecessor record。

## 3. 判讀 receipt

| receipt | 動作 |
| --- | --- |
| `relay_dispatched` | 位置已交出。`relayed_dispatch_ids` 是隨之轉移的 in-flight dispatch，`predecessor_dispatch_id` 是為本 pane 寫的回收憑證。進收工訊息 **A** |
| `relay_unconfirmed` | brief 已送出但沒看到 successor 起跑（`prompt_delivery: unconfirmed`），**交接已簽**：in-flight dispatch 已轉給 successor、本 pane 已寫回收憑證。**NEVER** 當成什麼都沒發生繼續做，**NEVER** 盲目重送。先 `herdr pane read <pane_id>` 看 successor：已收到 brief／在做 → 同 `relay_dispatched` 進收工訊息 **A**；輸入框閒置且 brief 明顯沒落地 → 用 `herdr agent prompt` 送一次 brief 路徑、確認起跑後進 **A**；pane 不在或讀不到 → 回 blocker 並附 `relayed_dispatch_ids`，不收工 |
| `relay_refused` | 本 session 的 exact runtime session（Claude 或 Pi）無法辨識，或沒有可交出的 pane。保留 durable task，回具體 blocker，**NEVER** 改用 raw `herdr` 指令繞過 |
| `transport_error` 且 receipt 帶 `relay_adopt_command`（brief 送出後、送達確認前失敗）| **轉移沒簽。** 先 `herdr pane read <pane_id>` 看 successor：已起跑（working／blocked／done）→ 在本 pane 跑 `herdr-session-handoff.ts --relay-adopt <dispatch_id>` 補簽（同一段轉移程式，receipt 回 `relay_dispatched` 且帶 `relay_adopted: true`，之後進收工訊息 **A**）；讀起來 idle → 確認 brief 真的被讀進去（不是還在輸入框）才加 `--verified`；沒起跑 → 回 blocker，**NEVER** 補簽。只有 relay 時的本 pane 與其 exact session 簽得了；**NEVER** 改用 successor 端 `--coordinate-claim` 繞（前任還活著會回 `coordinator_exact_identity_live`，那是刻意的） |
| `transport_error`／其他 preflight failure | 同上：保留 durable task 與 pane，回具體 blocker，**NEVER** 退回要求 user 手動 `cd`、開 session 或貼 prompt |

**`relay_dispatched` 之後 NEVER 再開任何新工作段。** 細則見 [dispatch-common.md](dispatch-common.md) § 5 兩者共通。
