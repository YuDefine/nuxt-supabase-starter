
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
