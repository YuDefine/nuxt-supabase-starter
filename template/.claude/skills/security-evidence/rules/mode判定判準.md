
# Rule 1 - 依使用者帶進來的東西判 mode，不依關鍵字猜

- Level: `MUST`
- 判 mode 只看使用者實際帶了什麼、要回答哪個問題：

| 可觀察 predicate | mode |
| --- | --- |
| 貼了或指了**一則** finding（findings.json 的一條、report.md 的一段、PR 留言裡的一則） | `finding` |
| 問的是上線前判斷：「上線前還缺什麼」「正式環境還有哪些風險沒證據」「掃完 No findings 可以上嗎」 | `map` |
| 一次貼了多則 finding | `finding`，先問要從哪一則開始 |
| 兩種都像（例如貼了一則 finding 又問能不能上線） | 先 `finding` 把眼前那則判完，review 結尾問要不要接著做 `map` |

- `finding` 要回答「這一則是不是真的」；`map` 要回答「這個範圍能不能上線、還缺哪些證據」。兩個問題的產物不同，**NEVER** 用一份產物同時回答兩個問題。

## Good Example

- 這個例子是好的，因為使用者同時給了 finding 與上線問題，先收斂到單則判讀，再把上線問題留到結尾。

```md
使用者：這則 IDOR 是真的嗎？還有這版能不能週五上線？
判定：finding（`/api/orders/:id` 那一則）；review 結尾問「要不要接著做上線前證據地圖（map）？」
```

## Bad Example

- 這個例子是壞的，因為它看到「上線」就直接跳 map，眼前那則 finding 沒有 verdict。

```md
使用者：這則 IDOR 是真的嗎？還有這版能不能週五上線？
判定：map，直接開始問部署拓樸
```

# Rule 2 - 多則 finding 一次只判一則，NEVER 合併出一個 verdict

- Level: `MUST`
- 每一則 finding 有自己的 attack path、前提與證據；合併判讀會讓一則的反證被拿去否定另一則，或讓一則的強證據替另一則背書。
- 多則時先列出每則的標題與檔案位置，問使用者先處理哪一則；判完一則、產出 review 後，才接下一則。
- 兩則 finding 指向同一個根因（例如同一個 middleware 漏掛）時，仍各自出 review，在 review 的「既有控制與反證」段互相引用即可。

## Good Example

- 這個例子是好的，因為它讓使用者選順序，並保留每則獨立的 verdict。

```md
這次有 3 則：
1. Missing owner check in GET /api/orders/:id（src/server/api/orders/[id].get.ts:14）
2. Webhook signature not verified（src/server/api/stripe/webhook.post.ts:8）
3. Upload size not limited（src/server/api/upload.post.ts:21）
要先判哪一則？判完一則會出完整 review，再接下一則。
```

## Bad Example

- 這個例子是壞的，因為三則被併成一個結論，沒有任何一則有可追的 attack path。

```md
三則看起來都是 scanner 誤報，整體 verdict：unsupported。
```

# Rule 3 - 上線前兩個事件觸發 map，且 map 做完才談深度稽核

- Level: `MUST`
- 下列兩個事件發生時，**MUST** 先走 `map`，不等使用者開口問「能不能上線」：
  - consumer 的 `business_activity` 要從 `pre-production` 改成 `active`（改 registry 之前）。
  - 已 `active` 的 consumer，`SECURITY.md` 的不變量被改（`security_md_sha` 與最近一次有效掃描不符，`audit-security-policy.ts` 報 `freshness`）。
- map 做完、verdict 帶範圍後，才判要不要登記深度稽核：map 有 P0／P1 的 `Unknown` 且靠 code 掃描才能補的，登記「需要深度稽核」進 plan Open work（附 scope 檔數），用 `flow ask` 請 Charles 決定發起；**NEVER** 由本 skill 或呼叫它的 agent 自行點火 Scan codebase（席位規則見 `agent-routing.routing-table.md`〔`deep-security-audit`〕）。
- map 只靠 Third Party、Operations、Production 層才能補的缺口，不登深度稽核：那些不在 code 掃描範圍內。

## Good Example

- 這個例子是好的，因為事件一到就先做唯讀的 map，稽核只登記不點火。

```md
事件：某 consumer 要把 business_activity 改 active。
動作：走 map → verdict「Repository 層 Confirmed，Production RLS 仍 Unknown（P0）」→ 在 plan Open work 登「該 consumer 需深度稽核（packages/trac/server 46 檔）」並 flow ask Charles。
```

## Bad Example

- 這個例子是壞的，因為把事件當成授權，直接點火掃描。

```md
事件：SECURITY.md 不變量改了。
動作：立刻對整個 repo 跑 claude-security Scan codebase。
```
