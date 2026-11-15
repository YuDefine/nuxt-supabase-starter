# worker 回報 success 時還有殘工（派工共用）

## 6. worker 回報 success 時還有殘工

`success` 是唯一會**關掉** worker pane 的 outcome。因此只寫在 summary 散文或 pane scrollback 裡的殘工，
在收割那一刻就消失了——而它同時也是最容易發生的情況：worker 做完自己那段，順手發現一件它不該做
或做不完的事。

**worker 側（MUST）**：先把證據與殘工步驟寫回 `work.md`（舊 package：`plan.md`） § 進度（沒有 plan 時寫進 brief 本身），再把殘工寫成
durable brief（tracked repo 路徑，至少含 lifecycle 檔指針、殘工差異、檔案所有權），帶進 completion：

```bash
node <clade-central-repo>/vendor/scripts/herdr-session-handoff.ts \
  --complete success --summary '<已完成與驗證>' --followup-brief <absolute-brief-path>
```

**那份 brief 的首段 MUST 逐字帶上這一句**（TD-908）：

> 本 brief 是**工作指令**，不是待辦盤點。`/nx` / `/my` / 收工判定不適用於剛被派出的 pane——
> 即使 brief 讀起來像「已完成 ＋ 剩餘」清單也一樣。MUST 先把 brief 的每一項實際做完再回報。

殘工 brief 天生長成「已完成 ＋ 剩餘」兩段——那正是收工盤點的形狀，所以下一棒會把它讀成一題
「現在該做什麼」而不是一份工作指令，然後零工作就把上一棒的 summary 原樣回報成 success
（某 consumer 2026-09-03 同一輪兩次命中）。dispatch 時 helper 會在 prompt 最前面注入同一句，但
**brief 檔本身也要有**：它會被獨立讀（relay successor 逐字帶路徑、收割者自己開檔看），
那些場合沒有 helper 的注入。

helper 對這個欄位是 fail-closed 的：非絕對路徑、檔案不存在、不是普通檔、空檔、或搭配 `success`
以外的 outcome，一律 `usage_error` 而**不**寫任何 durable state。它在 `success` 的 `summary` 與
`followup_brief` **逐字等於同 parent 上一筆 completion** 時也會拒收（`completion_refused`，
`reason: duplicate-of <dispatch-id>`）——那是上面那個誤讀的機械兜底，撞到它代表這一棒還沒說出
自己做了什麼。它也與 `--successor-receipt` 互斥——
已經有 live successor 接手時，那份殘工已經有主人了。

**NEVER** 自己 fanout 去派那一跳（helper 回 `nested_dispatch_refused`）。**NEVER** 因為「順手做完比較快」
就自行續推殘工——那正是 worker scope 要擋的事。

**收割者側（MUST）**：`completion_success` receipt 的 `followup_brief` 非空 = 手上多了一件已具名、
已落檔、**還沒有人接**的工作：

評估：first-match；以上皆非 → F*
| id | 收割者狀態 | 動作 |
| --- | --- | --- |
| F1 | 收割者自己也撞到 [[session-tasks]] § Session context 預算 的收工線 | `relay`／`fanout` 交棒，successor brief **MUST** 逐字帶上那個 `followup_brief` 路徑 |
| F2 | context 還撐得住，且該殘工本 session 合法做得完 | 直接照那份 brief 做完 |
| F3 | context 還撐得住，但殘工與手上的工作可平行 | `/handoff fanout` 把它派成一個 worker |
| F* | 其餘（撐得住但既做不完、也不能平行） | `relay` 交棒，successor brief 帶 `followup_brief` 路徑 |

**NEVER 把 `followup_brief` 讀完就當作已經處理**——它是一份還沒有人做的工作，不是一份回報。
**NEVER 因為「worker 回的是 success」就認定這條 dispatch 已經結案**：`success` 說的是 worker 那一段
做完了，`followup_brief` 說的是它旁邊還有一段沒人接。逐字反開脫：「它回 success 了，那就是好了」
「殘工我記在收工訊息裡就行」「下一個 session 讀 HANDOFF 自然會看到」。

**收割者自身耗盡 context 不是這條的終端狀態。** 這條的終端狀態只有兩種：那份 brief 的工作**已完成**，
或它**已經在另一個 live session 手上**（fanout worker／relay successor，且路徑已寫進對方的 brief）。
一個已收工 session 手上的 `followup_brief` 路徑既不是前者也不是後者，**NEVER** 拿它當收斂——
收工訊息不是 dispatch。
