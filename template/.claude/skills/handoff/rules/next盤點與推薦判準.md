<!-- 跨檔的「下方／上方 §」皆指 rules/ 下同名段落 -->

## next — 盤點 + 推薦

### 2B.0 Session-end pitfall sweep（呼叫 /oops Mode C；`/oops` 屬 maintenance/full capability，repo 沒有它時跳過整段並繼續 2B.1）

在動 HANDOFF.md 前，呼叫 `/oops` Mode C 回顧當前 chat session transcript 掃 missed lessons。觸發訊號與每個 candidate 的分流都以 `/oops` 為準（Mode C 的 Phase 4 step 1 列訊號、oops 的 `rules/新增條目准入判準.md` Rule 3 落點判定表列落點），本節不另列。使用者的糾正不在本步回顧：由糾正帳本每日歸類、達門檻時在 session 啟動提醒（`correction-ledger.ts`），**NEVER** 為了找糾正訊號重讀對話。**NEVER** 新 pitfall 檔（`docs/pitfalls/` 已退役，呼叫端遷移與否都一樣）。

若 sweep 為空（無 candidate）→ 一句話宣告「無 missed lesson」繼續 2B.1。

**禁止行為**：

- ❌ 把 sweep candidate 一次塞給 user 讓他選哪些要記 — 主動分流後直接 dispatch，user 看結果（唯一例外是落點判定的 memory 列：寫 memory 一律先問）
- ❌ 把 candidate 暫存到 HANDOFF.md `outstanding` 段 — sweep 是 session 內 cleanup，不該變成跨 session 待辦
- ❌ 強推 candidate 升級到 pitfall — 不符四條件就降級或跳過，不硬塞

### 2B.1 HANDOFF.md Health Gate（hard step）

**MUST Read [scan-steps.md](../scan-steps.md) § 2B.1 before proceeding** — 含 2B.1b 100% rotate 指令、audit、JSON schema、reorganize 表、dead-section 處置表、寫入規約。

摘要：先跑 `rotate-handoff-done.ts`（每次 `next` 的第一個寫入：100% 清掉可 rotate 的紀錄，不詢問、不看 KB 門檻）。JSON `retired: true` = clade home／已遷移 repo：完成段從主檔刪除、**不**寫月份 archive。未遷移 consumer 才搬進 archive。接著 `handoff-scan.ts --json` 讀 `healthGate` → fail 回報 user → 2B.1c reorganize。三 sub-step 完才進 2B.1.5。

`tier-a-dead-section` warn 的處置在 [scan-steps.md](../scan-steps.md) § 2B.1d dead-section 處置（Tier A）—— 依該處 D 表 first-match 判（D2 拆條 / D3 關條 / D4 知識語態重寫），D1「防重做 marker」偵測器已自動豁免、**NEVER 刪**。該 sub-step 不寫任何檔，逐段判即可，處置不完不擋 2B.1.5。

### 2B.1.5 Worktree & Stash 稽核

跑 **Step 3 共用 audit block**（見 [worktree與stash收斂判準.md](worktree與stash收斂判準.md) § Step 3）。next 完成 audit 後，在 chat 訊息加一行摘要：「Audit: N 個 worktree / M 個 stash 寫進 HANDOFF.md `## Worktree & Stash Audit` 段」。具體判定邏輯不在此重複，避免兩處規約走 drift。

### 2B.1.7 Human gates scan（hard rule）

**MUST Read [scan-steps.md](../scan-steps.md) § 2B.1.7 before proceeding** — 含 raw 形狀、family 分組寫法、SoT 判定、scan 失敗 fallback。

摘要：從 §2B.1a 同一次 handoff-scan 輸出讀 `reviewGuiReadiness` 段（`flow gates`）→ 依 family 寫入 `$MAIN_WT_PATH/HANDOFF.md` `## Review-gui Readiness` 段（整段覆寫）。Outstanding 推薦 **MUST** 引用 scan 結果。park 不執行。

### 2B.2 盤點剩餘 outstanding

從以下來源蒐集 outstanding 工作。**所有 active item 一律列入盤點並推薦處理** — drift scan 的 `active-section-stale`（14d）是 escalation threshold，不是 grace period；未超過 14d 的 active item **同樣 MUST 列入 outstanding**，不得因「尚未觸發 stale signal」而省略或降低優先序。

- 整理後的 `HANDOFF.md`
- **有 `specs/truth/work-lifecycle.md`（`techDebtHygiene.raw.retired: true`）**：outstanding **先**讀 `jq '.planInventory.raw' "$SCAN"` 三桶（**可做** / **卡人** / **該 RETIRE**）。每列的 `next` 欄是給 agent 的下一動（claim → `flow.ts plan show` / `plan readiness` → `/implement`；卡人寫明 `waitingOn`；RETIRE 寫 close/GC）。**NEVER** 把 `techDebtHygiene.raw.plans[]` 或 `flow plan list` 全表平鋪成接著做；**NEVER** 對半成品推 `/work-route`、第二次 `/specify` 或 `flow plan open` 當入口。**NEVER** 為列 outstanding 讀 `docs/tech-debt.md`、NEVER 對其中條目推薦 stamp Last reviewed／補 Resolution／wontfix（凍結舊載體）；下面三層 TD 規則整段不適用
- 未遷移 consumer 的未解決 TD-NNN — 三層來源**全部**取自 §2B.1a 落檔的 `techDebtHygiene.raw`（`jq '.techDebtHygiene.raw' "$SCAN"`）。**NEVER 為了列 outstanding 整讀 `docs/tech-debt.md` 主檔**；需要細節時用 raw 的 `lineNo` **定點 Read**。優先序分三層，**MUST** 依此排序，**NEVER** 平鋪混在一起：
  1. **stale**（`techDebtHygiene.raw.stale[]`，>60d 無 Last reviewed）— 最高優先，`discAge` 越大越前。每條 **MUST** 附三選一（做掉 / wontfix / stamp Last reviewed），但 stamp Last reviewed 列為最後選項，不推薦
  2. **aging**（`techDebtHygiene.raw.aging[]`，>14d 含被 snooze 的）— 第二優先，`discAge` 越大越前。每條 **MUST** 主動追問 blocker：「什麼卡關？能現在推進嗎？」。對 `snoozed: true` 的項目明確指出「已 stamp Last reviewed 但仍未解決 — 不應再延期」
  3. **其他 open TD** — 取 `raw.open[]` 扣掉已在前兩層的 id，按 `discovered` 排序，正常列入 outstanding：

     ```bash
     jq -r '.techDebtHygiene.raw | ((.stale + .aging) | map(.id)) as $seen
            | .open | map(select(.id as $i | $seen | index($i) | not))
            | sort_by(.discovered) | .[] | "\(.id)\t\(.discovered)\t\(.lines)行\t\(.title)"' "$SCAN"
     ```
- repo 根目錄 `ROADMAP.md` `## Next Moves`
- 任何已收尾但留下 follow-up 註記的工作

每條 outstanding 抓三件資料：
- 標題（一句話）
- 涉及檔案 / module / consumer
- 依賴關係（依賴誰、誰依賴它）

### 2B.2.5 external-action / exception / ruling 卡主動 triage（hard rule）

**等人的只是那一題，不是整件工作**。§2B.1.7 讀到 `external-action` / `exception` / `ruling` 卡時，**MUST** 對**每一張**主動 triage，**NEVER** 只寫進 `## Review-gui Readiness` 就 silently drop。

對每張卡 **MUST** 做三件事：

1. **抽 blocker 原因**：讀卡片的 `question` / `why_now`，再讀 `work_id` 對應 carrier（`tasks/<date>-<slug>.md` 或 `specs/plans/<id>/tasks.md`）的未勾項。逐條列出每一個原因，**NEVER** 從 family 名或 HANDOFF 既有 narrative 推測。
2. **辨識 startable 子集**（最關鍵）：一件工作有卡只代表它**含**至少一個等人的點，**不代表整件無事可做**。**MUST** 由 carrier 內容判斷是否有**不依賴那一題、可現在開工的 work**。有 startable 子集 → **提供 dispatch 選項**（交 `wt` 建立隔離環境，只做不受阻的部分），**NEVER** 因整件有卡就當 user-bound 擱置。
3. **端出具體 user 決策**：`ruling` 卡的判斷題原樣端出（逐字、帶選項）；`external-action` 卡寫明**要人到場做什麼**；`exception` 卡寫明核准恢復／改派／abort 各會怎樣。**NEVER** 只寫「等 owner 拍板」這種無法行動的模糊句。純外部依賴（等 A 端 contract / 等別件工作）才真的擱置，但仍 **MUST** 明列在等什麼 signal。

triage 結果併入 §2B.2 outstanding 清單（與 HANDOFF / plan（未遷移 consumer 為 tech-debt）/ ROADMAP 來源並列），進 §2B.3 serial/parallel 評估、§2B.4 推薦。

**NEVER**：
- ❌ 讀到卡片卻不讀 carrier 抽 blocker 原因
- ❌ 把「有一張卡」等同「整件無 startable 工作」→ 漏掉可現在 dispatch 的子集
- ❌ 只寫「等 owner 拍板 / 卡外部」而不端出**具體**決策題或**具體**等待 signal
- ❌ 因為是卡片就從 outstanding / 詢問操作 選項中省略

### 2B.3 Serial vs Parallel 評估

**MUST Read [dispatch-steps.md](../dispatch-steps.md) § 2B.3 before proceeding** — 含 serial / parallel 兩份訊號清單、parallel candidate 的 thin-brief 長駐 subagent 四條。

摘要：serial 訊號任一成立即 serial；parallel 訊號全成立才算 candidate → 判 parallel 時 **MUST** 走 thin brief + 具名長駐 subagent，**NEVER** fresh fan-out。

### 2B.4 推薦 + 詢問操作

**MUST Read [dispatch-steps.md](../dispatch-steps.md) § 2B.4 before proceeding** — 含推薦訊息格式、Option 1–4 配置、7 條禁止行為（ptb-unsafe 不得標 Recommended、wt 推薦必附 safety signal、等人狀態推測禁令）。

摘要：先輸出「outstanding 盤點 + serial/parallel 推薦」訊息，再用 詢問操作 讓 user 選；人工驗收相關 next move **MUST** 引用 §2B.1.7 的 `flow gates` 結果，**NEVER** 自行推測有沒有等人的事。

### 2B.4.5 PTB-unsafe wt 的快速分流

Step 3.1 audit **有任一條** wt 判為 `mergeBackSafety: ptb-unsafe` → **MUST Read [dispatch-steps.md](../dispatch-steps.md) § 2B.4.5 before proceeding** — 含 3 個 terminal 選項的動作 / 風險對照表、inspect 路徑只能作 Option 4 的規約。零條 ptb-unsafe → 本節不適用，直接進 2B.5。

摘要：commit baseline 全收 → merge-back / abandon wt / defer 三選一，**禁止** inspect 子選項作為主推薦。

### 2B.5 接續 dispatch（user 選定 outstanding 後）

**MUST Read [dispatch-steps.md](../dispatch-steps.md) § 2B.5 before proceeding**（user 在 詢問操作 選定下一步的當下就要讀）— 含 5 列 next-skill dispatch 表、判定條件三條、slug 解析、parent cwd 不動 invariant、人工驗收 dispatch 的 family 入口表。

摘要：一律透過 Skill tool 內呼對應入口，**不要**輸出「請執行 cd ... && claude ...」oneliner；會寫 tracked file 的實作入口（`/implement`）交 `wt` 建立隔離環境並在樹內續跑 `<next-skill>`，read-only 與規格類（`/specify`、`/system-analysis`）直接內呼。`bdd` 與 `clarify-over-specs` 沒有 Skill tool 入口：`bdd` 由 `/implement` 委派，`clarify-over-specs` 由 `work-route` 載入。

### 2B.1.8 Tech-debt hygiene scan（hard rule — 防 tech-debt.md 堆積）

**MUST Read [scan-steps.md](../scan-steps.md) § 2B.1.8 before proceeding** — 含 staleOpen / aging / closedBloat 三訊號處置表、anti-snooze 規約、SoT 判定。

摘要：從 §2B.1a 同一次 handoff-scan 輸出讀 `techDebtHygiene` 段。`raw.retired: true`（check `tech-debt-hygiene-retired` n/a）= 已遷移 plan/truth repo：本 sub-step **整段跳過**，outstanding 改走 §2B.2 的 plan 來源，**NEVER** 寫 `docs/tech-debt.md` 或 `docs/archives/tech-debt-*`。未遷移 consumer：stale 列 outstanding 最高優先 → aging 列第二優先並追問 blocker → closedBloat warn 時跑 `rotate-closed-bloat.ts`（**NEVER** 詢問操作）。stdout `retired` = clade home／已遷移 repo，**不要**寫 closed archive 或改 `docs/tech-debt.md`。park 不執行。

### 2B.1.9 Consumer-local audit scan（hard rule）

**MUST Read [scan-steps.md](../scan-steps.md) § 2B.1.9 before proceeding** — 含宣告檔形狀、exit code 契約、NEVER 清單。

摘要：讀當前 consumer 的 `.claude/rules/local/handoff-audits.md`（**不存在 → 整段跳過，不報錯**）→ 逐條跑表內指令 → exit 1 的 finding 逐條列進 §2B.2 outstanding、exit ≥2 一行 skip（缺憑證不是待辦）。**NEVER** 把這些指令搬進 `pnpm check` / CI，**NEVER** 把 script 原始輸出整段貼進 `HANDOFF.md`。park 不執行。
