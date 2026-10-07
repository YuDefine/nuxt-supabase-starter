# 非 plan candidate 的分類與 dispatch


本檔是 **Step 3.1b 的分類依據**。適用對象：Step 2 candidate list 裡 source 為 `handoff` / `techdebt` / `roadmap` 的每一條。

## 掃描來源（Step 2 已合併，此處只記段落判準）

1. **`HANDOFF.md`** —— 段落名因 consumer 而異，靠 `##` / `###` heading 辨識：
   `## 你接下來要做的事` / `## Next Steps` / `## Outstanding` / `## Follow-up` / `## In Progress`
   - 每個 heading 下的 `- [ ]` 未勾項 = 一個 candidate；已勾 `- [x]` 跳過
   - 純文字段落（無 checkbox）視為單一 candidate
2. **`docs/tech-debt.md`** —— 有 `specs/truth/work-lifecycle.md`（scan `techDebtHygiene.raw.retired: true`）時本來源**退場**：`raw.open[]` 等欄位刻意為空，不是「沒有債」—— 工作改由 `specs/plans/<work-id>/plan.md` 的 Open work 承載（`raw.plans[]`），**NEVER** 回頭整讀或改寫凍結的 `docs/tech-debt.md`。未遷移 consumer：從 scan 的 `techDebtHygiene.raw` 取，**NEVER 整讀主檔**
3. **repo 根目錄 `ROADMAP.md`**（存在時）：
   - `## Next Moves` 下的 `###` 子段（每個子段 = 一個 candidate）

## Carrier association（進入分類表前 MUST 跑）

以 Step 2 掃到的 carrier 路徑、work slug 與 flow work id 比對**每一筆**文件待辦。可靠身分相同才交由 § 3.1a 接續，已在本輪需求清單者不重複 dispatch。只有相似標題或散文名稱時先建立候選關聯並核對原件，**NEVER** 自動合併工單。

## 分類與 dispatch

| 類型 | 辨識方式 | Dispatch |
| --- | --- | --- |
| 需求引用 | 帶明確 carrier 路徑、work slug 或 flow work id | 走 3.1a 接續；保留原驗收與證據政策，不另開 ad-hoc 根工單 |
| code task（有明確檔案路徑 / 行為描述） | 含 `server/` / `app/` / `scripts/` / `.vue` / `.ts` / `.mjs` 等路徑，或含動詞（「改」「加」「修」「移除」「重構」） | worktree 內直接實作：交 `wt` 建立隔離環境並派出 brief，brief 從條目萃取 |
| investigation / research | 含「調查」「確認」「檢查」「分析」「audit」 | 主線即時組直接執行（不需 worktree；read-heavy 者先過 [dispatch-topology.md](dispatch-topology.md) § 主線即時組的 pre-scan 前置判定），結果寫回對應條目 |
| blocked / 需拍板 | 含「待 user」「待確認」「blocked」「需拍板」 | **NEVER 直接 skip** —— 走 [autonomy-predicate.md](autonomy-predicate.md) § Decision Packaging |
| 模糊 / 無法判斷 | 以上皆不符 | 先跑唯讀調查補事實再重判（見 autonomy-predicate.md § 判不出來時的三步）；仍模糊 → packaging，**不是** skip |

## Brief MUST 有驗收二分欄位（machine / human）

**每一個** dispatch 出去的非 plan brief（code task 走 worktree、investigation 走主線即時組，兩者都算）
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

**NEVER** 用「這條 item 很小，驗收顯而易見」略過本節。plan package 路徑靠 acceptance scenario 的 `@human` 標記與
machine check 分離把這件事結構化了，非 plan 路徑沒有那個結構——不明寫，evidence pointer 的品質
就退回 agent 自覺，而 harvest 拿到的是 machine 與 human 混在一起的一段自報完成。

## Dispatch 規則

- **分組同主流程**：**每一個** candidate 依上表落進 [dispatch-topology.md](dispatch-topology.md) 的
  四組之一——code task / 需求引用 → 扇出組（**與 `plans` item 共用**同一個 ≤4 in-flight 上限），
  investigation → 主線即時組。非 plan 工作不是獨立於四組之外的第五條路徑
- **Commit 紀律同主流程**：落地 main 時路徑全在 [[commit.detail]] 白名單 → `git commit --only -- <paths>`；任一不在 → invoke `/commit`。每個 item 獨立 commit。卡人工檢查 → packaging，**NEVER** `--only` 繞 0-A
- **完成後 MUST 更新來源檔**：勾 `[x]` 或補完成摘要，讓下一輪不重複做
- **Error handling 同主流程**：失敗 → log + skip + `failStreak` +1
- 每筆需求建立依 [guardrails.md](guardrails.md) § 護欄 7 的來源授權判定；已授權且明確的需求走 `/specify` 或建 tasks 檔，未授權新目標或產品歧義才 packaging。
- **NEVER** 跨 consumer 操作 —— loop 仍限當前 repo

**動標準層不是 skip 理由**：`rules/` / `capabilities/core/` / `CLAUDE.md` / `vendor/`（clade 端）
**可以改**，但 MUST 改完走 `/clade-publish` Step 1–9 散播完畢，**NEVER** 改完擱著。
做不到就 packaging。判準見 [guardrails.md](guardrails.md) 護欄 5 與 [autonomy-predicate.md](autonomy-predicate.md) predicate 2。

## Skip 合法理由窮舉（MUST，其他一律 dispatch 或 packaging）

只有以下 3 條理由可以跳過一個 candidate，**NEVER** 自創第 4 條：

1. **跨 consumer 操作** —— loop 限當前 repo
2. **blocked on external signal 且已 packaging** —— 等 deploy / 等第三方 / 等具名 user 決策，
   且已依 packaging SOP 寫進 `## ⏳ Awaiting Charles`。**沒 packaging 的不算，那是 skip**
3. **本輪已 packaged**（state 的 `packaged` 有 timestamp）—— 不重複 packaging

「需開新需求」與「動標準層」都不是 skip 理由：前者寫進 packaging 內容建議走 `/specify`，後者可自主改 + 散播。

以下**不是**合法跳過理由（逐字實錄，per [[pitfall-change-loop-turbo-self-rationalized-idle]]）：

- ❌「needs careful testing」— worktree isolation + pi 就是為此設計的
- ❌「complex」「多個 scripts 有不同 scope」— pi effort=high 處理
- ❌「not ideal for quick wins」— loop 不只做 quick wins
- ❌「需要 visual verification」— 非 `.vue` 的 backend 不需要
- ❌「這輪已做了一個了」— 沒有 per-round 上限（除 `--unattended` 5-item cap）
- ❌「等 agents 完成再處理」— 扇出組滿 4 就是做主線即時組的時機，不是該等的時機。等 notification
  期間 **MUST** 繼續推進（investigation 類主線直接做、code task 類等扇出組空位）
- ❌「先寫 HANDOFF status」— HANDOFF status 是 Step 7（四組皆空且 in-flight 歸零之後），不是中途的 exit ramp

## Step 2 各 source 的掃描細節（主檔 Step 2 下推）

> 主檔 pointer：Step 2 讀 `handoff`／`techdebt`／`roadmap`／`worktreeStash` source、要跑 `--run-selfverify`、或 `tech-debt-closed-bloat` 為 warn 時 MUST 讀本節。2026-10-06（TD-833 第 6 項）自主檔搬來；這些判準的本體只在本節，主檔只留觸發時機。

- **`HANDOFF.md`** —— 掃 `## In Progress` / `## Blocked` / `## Next Steps` / `## Outstanding` / `## Follow-up`（heading 名因 consumer 而異，靠 `##` / `###` 辨識）。`- [ ]` 未勾項 = 一個 candidate；`- [x]` 跳過；純文字段落視為單一 candidate
- **`docs/tech-debt.md`** —— 有 `specs/truth/work-lifecycle.md`（scan `techDebtHygiene.raw.retired: true`）時本來源**退場**：`raw.open[]` 等欄位刻意為空，不是「沒有債」—— 工作改由 `specs/plans/<work-id>/plan.md` 的 Open work 承載（`raw.plans[]`），**NEVER** 回頭整讀或改寫凍結的 `docs/tech-debt.md`。未遷移 consumer：**NEVER 整讀主檔**（fleet 各家主檔已在數百 KB 量級，整讀一次吃掉大半預算；當前值跑下方 `wc -c`）。從 `techDebtHygiene.raw` 取，優先序**四層**：`landed-pending-verification`（驗收）→ `stale`（>60d）→ `aging`（>14d）→ 其他 `open`。需要細節時用 `raw` 的 `lineNo` **定點 Read**（`offset` + `limit`）

  **驗收排第一層不是偏好，是流量算術**：landed 條目的 Resolution 已經寫好，close 它的成本是「跑一次自驗」；開一條新 TD 的成本也差不多，但方向相反。驗收永遠排在新工作後面的迴圈，close 流量必定輸給 open 流量——2026-08-13 clade 實測近 7 天 opened 39 / closed 10，同期 landed 桶 16 條無一驗收。**NEVER** 把「landed 那條反正已經 land 了」讀成它不急：它佔著 open class 的位置，且它的 Resolution 每多放一天就多一分過期風險。

  **`--run-selfverify` MUST 帶 `--selfverify-cache`**：全套一次 ~26 秒 / ~384KB 輸出，而 2026-08-06～13 的 round 70–75 **六輪 verdict 逐項相同**——每輪重跑換到的資訊量是 0 bit。快取 key =（audit script 內容 + `docs/tech-debt.md` 內容 + git HEAD），輸入不變就回上次結果並標 `cached: true`。實測冷跑 26s → 熱跑 **0.12s**；TD 檔一改立即失效（實測 0/47 命中），不是恆命中。

  **`--run-selfverify` MUST 同時帶 `--selfverify-queue`**：`-until-` 條目的自驗現在也在掃描範圍內（它們的解凍條件先前**沒有任何東西**在評估——轉列那一刻就離開了所有佇列視野）。這個旗標把「probe 輸出跟上次比變了」送進待拍板佇列，**fire-once**：同一個變動只問一次，沒變就完全不出聲，所以它不會製造每輪重報。**NEVER** 因為「這輪 verdict 看起來都一樣」就省掉它——看起來一樣正是它要接的那半，人眼六輪逐項相同的同時 TD-280 的實際輸出已經從 6 none 變成 8 none。快取命中時它自動跳過（拿上一次的結果比基線等於拿基線跟自己比），不必手動判。

  **NEVER 改成「N 輪跑一次」**：calendar-based skip 會讓真實改動落在跳過窗口內溜過去，然後搭著 propagate 散到全 registry consumer 才被發現。輸入不變時跳過在數學上無資訊損失，輪次計數跳過不是。**已知邊界**：48 條 probe 有一部分量的是**活狀態**（檔案數、目錄體積），git HEAD 涵蓋 repo 內變動但涵蓋不到 repo 外的環境漂移——所以它是 opt-in，判斷這一輪能不能接受這個邊界是呼叫端的責任。

  **`blocked-attended-only` 一律跳過**（unattended）：它的定義就是「本迴圈拿不到出口」，撈進 candidate list 只會每輪重新判定一次再放棄。attended 模式照撈——那正是它等的東西。判準與防濫用見 clade `.claude/rules/local/tech-debt-hygiene.md` § Invariant 12。

  **closedBloat 自動 rotate（不佔 5-item cap）**：`techDebtHygiene.checks` 含 `name: tech-debt-closed-bloat` 且 `status: warn` 時，**MUST** 跑 `node "${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts/rotate-closed-bloat.ts"`（runner child 改逐字跑 `$ARGUMENTS` 的 `--rotate-helper-command`）。stdout `retired` 或 `noop` → 不寫檔、不重 scan。其餘非 `noop` 再 scan 一次。**NEVER** 把 rotate 當 candidate、**NEVER** `AskUserQuestion`。`work-loop-scan.ts` 本身 NEVER 寫檔。

  ```bash
  wc -c docs/tech-debt.md   # 上面兩個數字的來源。主檔隨 rotate / 新增增減，複跑取當前值
  ```
- **repo 根目錄 `ROADMAP.md`** `## Next Moves` 的 `###` 子段（存在時）
- **`worktreeStash`** —— `mergedToMain: false` 的 wt 與每一筆 stash

### 主檔 Step 2 判準的理由（判準本體在主檔，本節不複述）

> 判準只有一份，在主檔 SKILL.md 標示的 Step；本節只放那些判準的理由與證據，不複述判準。判準的增修只落主檔。

- **需求來源查詢**：`plans` 提供 carrier 路徑、slug 與對應 work id；`flow` 卡提供 outcome 與 stall 狀態。掃不到任何 carrier 表示此 repo 沒有進行中的結構化工作——那與讀取失敗是兩回事。
- **Carrier association 改判 `plans`**：避免降級成 ad-hoc brief 而丟失 phase 結構與 evidence 收集。
