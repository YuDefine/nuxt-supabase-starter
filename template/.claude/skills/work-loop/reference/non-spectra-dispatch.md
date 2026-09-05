<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 非 spectra candidate 的分類與 dispatch

> 前身是 `change-loop/reference/turbo-dispatch.md`（`--turbo` 專屬）。合併成 `/work-loop` 後
> `--turbo` flag 消失、非 spectra 待辦成為預設 scope，本檔改為 **Step 3.1b 的分類依據**。
> 分類表、skip 窮舉、逐字藉口實錄**原樣保留**——它們對應的 pitfall 沒有失效。

適用對象：Step 2 candidate list 裡 source 為 `handoff` / `techdebt` / `roadmap` 的每一條。

## 掃描來源（Step 2 已合併，此處只記段落判準）

1. **`HANDOFF.md`** —— 段落名因 consumer 而異，靠 `##` / `###` heading 辨識：
   `## 你接下來要做的事` / `## Next Steps` / `## Outstanding` / `## Follow-up` / `## In Progress`
   - 每個 heading 下的 `- [ ]` 未勾項 = 一個 candidate；已勾 `- [x]` 跳過
   - 純文字段落（無 checkbox）視為單一 candidate
2. **`docs/tech-debt.md`** —— 從 scan 的 `techDebtHygiene.raw` 取，**NEVER 整讀主檔**
3. **`openspec/ROADMAP.md`**（存在時）：
   - `## Next Moves` 下的 `###` 子段（每個子段 = 一個 candidate）
   - `## Active Changes` 下的 `### In progress` / `### Draft`（若未被 spectra scan 涵蓋）

## 需求關聯（進入分類表前 MUST 跑）

以 Step 2 OPSX list 的明確 change ID、artifact path、source locator 與 work origin 比對每一筆文件待辦。可靠身分相同才交由 § 3.1a 接續，已在本輪需求清單者不重複 dispatch。只有相似標題或散文名稱時先建立候選關聯並核對原件，不自動合併工單。

## 分類與 dispatch

| 類型 | 辨識方式 | Dispatch |
| --- | --- | --- |
| 需求引用 | 帶明確 change ID、artifact path 或 source/work identity | 走 3.1a OPSX 接續；保留原验收与证据政策，不另開 ad-hoc 根工單 |
| code task（有明確檔案路徑 / 行為描述） | 含 `server/` / `app/` / `scripts/` / `.vue` / `.ts` / `.mjs` 等路徑，或含動詞（「改」「加」「修」「移除」「重構」） | worktree 內直接實作：`/wt <slug>: <brief>`，brief 從條目萃取 |
| investigation / research | 含「調查」「確認」「檢查」「分析」「audit」 | 主線即時組直接執行（不需 worktree；read-heavy 者先過 [dispatch-topology.md](dispatch-topology.md) § 主線即時組的 pre-scan 前置判定），結果寫回對應條目 |
| blocked / 需拍板 | 含「待 user」「待確認」「blocked」「需拍板」 | **NEVER 直接 skip** —— 走 [autonomy-predicate.md](autonomy-predicate.md) § Decision Packaging |
| 模糊 / 無法判斷 | 以上皆不符 | 先跑唯讀調查補事實再重判（見 autonomy-predicate.md § 判不出來時的三步）；仍模糊 → packaging，**不是** skip |

> 最後兩列與前身版本不同：`turbo-dispatch.md` 當時寫「跳過，log 到 Skipped」。合併後 packaging
> 是 MUST——skip 會讓 user-bound 比例高的清單完全停擺，而那正是 `/handoff-loop` 當初存在的理由。

## Brief MUST 有驗收二分欄位（machine / human）

**每一個** dispatch 出去的非 spectra brief（code task 走 worktree、investigation 走主線即時組，兩者都算）
**MUST** 含以下兩份清單，**兩份都要有**，只列一邊不算：

```markdown
**Machine-verifiable（你自己跑，綠了才算完成）**：
- <逐條列出：typecheck / 具名 test / lint / audit script / curl endpoint 回 200 …>

**Human-only（你 NEVER 自己判定通過，做完把證據留在 <具名落點>）**：
- <逐條列出：UI 順不順 / 文案對不對 / 該不該做這個決定 / 視覺回歸 …>
- 證據落點：<screenshot 路徑 / PR 連結 / HANDOFF entry>
```

**這兩份清單同時 MUST 寫進 state 的該 item 條目**——harvest 收割時照 machine 清單逐條複驗
（per [harvest.md](harvest.md)），human 清單則直接轉成 HANDOFF 的驗收方式一行，不重新發明。

**判準**：一條驗收條件能寫成「跑某個指令看 exit code / 看輸出字串」就是 machine，其餘全是 human。
判不出來的**歸 human**——保守側是多一次人看，不是少一次。

**NEVER** 用「這條 item 很小，驗收顯而易見」略過本節。spectra 路徑靠 `userActionPending` 與
machine check 分離把這件事結構化了，非 spectra 路徑沒有那個結構——不明寫，evidence pointer 的品質
就退回 agent 自覺，而 harvest 拿到的是 machine 與 human 混在一起的一段自報完成。

## Dispatch 規則

- **分組同主流程**：**每一個** candidate 依上表落進 [dispatch-topology.md](dispatch-topology.md) 的
  四組之一——code task / spectra 引用 → 扇出組（**與 spectra item 共用**同一個 ≤4 in-flight 上限），
  investigation → 主線即時組。非 spectra 工作不是獨立於四組之外的第五條路徑
- **Commit 紀律同主流程**：落地 main 時路徑全在 [[commit.detail]] 白名單 → `git commit --only -- <paths>`；任一不在 → invoke `/commit`。每個 item 獨立 commit。卡人工檢查 → packaging，**NEVER** `--only` 繞 0-A
- **完成後 MUST 更新來源檔**：勾 `[x]` 或補完成摘要，讓下一輪不重複做
- **Error handling 同主流程**：失敗 → log + skip + `failStreak` +1
- 每筆需求建立依 [guardrails.md](guardrails.md) § 護欄 7 的來源授權判定；已授權且明確的需求接 OPSX，未授權新目標或產品歧義才 packaging。
- **NEVER** 跨 consumer 操作 —— loop 仍限當前 repo

**動標準層不再是 skip 理由**：`rules/` / `plugins/hub-core/` / `CLAUDE.md` / `vendor/`（clade 端）
**可以改**（2026-08-05 授權），但 MUST 改完走 `/clade-publish` Step 1–9 散播完畢，**NEVER** 改完擱著。
做不到就 packaging。判準見 [guardrails.md](guardrails.md) 護欄 5 與 [autonomy-predicate.md](autonomy-predicate.md) predicate 2。

## Skip 合法理由窮舉（MUST，其他一律 dispatch 或 packaging）

只有以下 3 條理由可以跳過一個 candidate，**NEVER** 自創第 4 條：

1. **跨 consumer 操作** —— loop 限當前 repo
2. **blocked on external signal 且已 packaging** —— 等 deploy / 等第三方 / 等具名 user 決策，
   且已依 packaging SOP 寫進 `## ⏳ Awaiting Charles`。**沒 packaging 的不算，那是 skip**
3. **本輪已 packaged**（state 的 `packaged` 有 timestamp）—— 不重複 packaging

> 前身版本有「需 spectra-propose」與「動標準層」兩條。兩者現已改為 packaging 對象（前者寫進
> packaging 內容建議 propose，後者可自主改 + 散播），不再是合法 skip 理由。

以下**不是**合法跳過理由（逐字實錄，per [[pitfall-change-loop-turbo-self-rationalized-idle]]）：

- ❌「needs careful testing」— worktree isolation + pi 就是為此設計的
- ❌「complex」「多個 scripts 有不同 scope」— pi effort=high 處理
- ❌「not ideal for quick wins」— loop 不只做 quick wins
- ❌「需要 visual verification」— 非 `.vue` 的 backend 不需要
- ❌「這輪已做了一個了」— 沒有 per-round 上限（除 `--unattended` 5-item cap）
- ❌「等 agents 完成再處理」— 扇出組滿 4 就是做主線即時組的時機，不是該等的時機。等 notification
  期間 **MUST** 繼續推進（investigation 類主線直接做、code task 類等扇出組空位）
- ❌「先寫 HANDOFF status」— HANDOFF status 是 Step 7（四組皆空且 in-flight 歸零之後），不是中途的 exit ramp
