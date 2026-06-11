---
description: Manual Review discuss flow——[discuss] items walkthrough、Defer-to-HANDOFF、Resume mode、HANDOFF.md ## Deferred discuss items schema、混合 kind change 順序；寫含 [discuss] item 的 tasks.md 或跑 /spectra-archive 時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', '.claude/skills/spectra-archive/**', 'HANDOFF.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.discuss.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Manual Review — Discuss Flow

對 `[discuss]` kind items 的標準流程，由 `/spectra-archive` Step 2.5 walkthrough 主動觸發。  
本檔 path-scoped 載入；marker 核心定義、kind 分類、共用 schema 見主檔 [[manual-review]]。

## `[discuss]` flow（spectra-archive Step 2.5 Walkthrough）

tasks.md 有未勾 `[discuss]` 項時，**MUST** 走 spectra-archive Step 2.5 「Discuss Items Walkthrough」：

1. archive 階段主線 Claude **主動** Read tasks.md `## 人工檢查` 區塊，識別未勾 `[discuss]` items
2. 對每條 item，主線 Claude 分類 trigger condition：
   - **Internal evidence available now** — code / schema / migration / cron 等可立刻 grep / query
   - **External signal already occurred** — staging / production 已 deploy、soak 已過、商業決策已拍板
   - **External signal pending** — required deploy / soak / authorization **尚未**發生；Claude 無法用分析合成 evidence
3. 對非 pending 的兩類，主線 Claude 主動準備 evidence（grep 結果、diff、command output、data summary、合理性分析）— **不要**等使用者開口
4. 向使用者展示 evidence + item description，請使用者明確 OK / Issue / Skip / Defer
   - 「Defer」只在 trigger 為 **External signal pending** 時才出現；其他兩類 trigger **NEVER** 顯示 Defer 選項
5. **OK 路徑**：勾 `[x]` + 在 description 後、trailing markers 前插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation
6. **Issue 路徑**：保持 `[ ]`、附 issue 註記、不擋 archive（使用者保留主導權）
7. **Skip 路徑**：勾 `[x]` + `（skip）` annotation
8. **Defer 路徑**（External signal pending 限定）：勾 `[x]` + `(deferred-to-handoff: <ISO>)` + `(awaiting-signal: <signal-desc>)` annotations；archive 階段同時把 entry 寫進 `HANDOFF.md` `## Deferred discuss items` 段（schema 見下方）；archive flow **繼續走完**，不 STOP

archive-gate.sh Check 4 會驗 `[discuss]` items 必須勾選或含 `(claude-discussed: ...)` / `(deferred-to-handoff: ...)` evidence trail；兩者擇一即視為 valid。

## Defer 後的 Resume（deploy / signal 發生後回流）

User 看 `HANDOFF.md ## Deferred discuss items` 找回該 entry，重跑 `/spectra-archive <change-name>` —— archive skill 偵測到 archived directory 內 `(deferred-to-handoff:)` annotation 自動進 **Resume mode**：

- 只跑 Step 2.5 對所有 deferred items 重做 walkthrough（**不**搬目錄、**不**重跑 gate / delta sync 等其他 archive 步驟）
- 每條 deferred item 按一般 3 種 trigger 重新分類（signal 通常已 occurred → 收 post-signal evidence）
- 4 個結果分支：
  - **OK**：annotation 翻 `(claude-discussed: <new-ISO>)`，刪掉 `(deferred-to-handoff:)` 跟 `(awaiting-signal:)`
  - **Issue**：checkbox 翻 `[ ]`，annotation 改成 `（issue: <note>）`（清掉 deferred / awaiting）
  - **Skip**：annotation 翻 `（skip[: reason]）`（清掉 deferred / awaiting）
  - **Still pending**：保持原樣（user 認為仍要等）
- Resume 結束時 archive skill best-effort sed 清掉 HANDOFF entry（依 HTML marker），刪不掉提示 user 手動清

## `HANDOFF.md ## Deferred discuss items` schema

archive skill 寫入時用以下格式（每 entry 由 HTML marker 包圍，便於 Resume 階段 sed 清理）：

```md
## Deferred discuss items

<!-- deferred-begin:<change-name>:<item-id> -->
- **<change-name>** #<item-id> — <一句話 description>
  - Awaiting signal: <staging deploy / production deploy / N-day soak / 商業授權 / ...>
  - Resume: `/spectra-archive <change-name>`
  - Deferred at: <ISO-8601-timestamp>
<!-- deferred-end:<change-name>:<item-id> -->
```

- Section 不存在時 archive skill 在 HANDOFF.md 適當位置（通常文末）新增整段 + heading
- 多條 deferred entry 在同段內並列，順序依 deferred-at 升冪
- `/handoff` skill Mode B 整理階段 **NEVER** 動此段（由 `/spectra-archive` Resume mode 獨自 maintain）

## 混合 kind change

一個 change 同時含未勾 `[verify:*]` + `[discuss]` + `[review:ui]` items 時，**MUST** 依以下順序執行（早→晚，讓 user 拿到的 review GUI 內容最完整）：

1. **apply 階段** — Step 8a Verify Channel Pass：主線依 `e2e → api → ui` 跑 verify channels，寫 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` annotations；automatic-only items 由 helper 自動勾 `[x]`
2. **archive 階段 Step 2.5** — Discuss Items Walkthrough：Claude 主動準備 `[discuss]` evidence、與 user 討論
3. **archive 階段 review GUI** — `pnpm review:ui` 一次處理所有未勾 `[review:ui]` + `[verify:ui]` items（user 在 GUI 看 evidence/screenshot 點 OK / Issue / Skip）

spectra orchestrator Archive Flow Step 1 已內建這個分流邏輯。

## 人工檢查時機詳解

> 自主檔 [[manual-review]] § 人工檢查時機 移入；hard rule 本體（最終驗收集中一次做、**NEVER** 穿插 ingest / apply 中段）與禁止事項仍在主檔。

### 為什麼

User 在 review:ui round N 留下的 issue 若 triage 路由到 (C) Spec gap → `/spectra-ingest`，會新增 verify items（如預檢 inline alert 對應的新 `[verify:ui]` item），這些 item 需要 `/spectra-apply` 落 code 後才能在 review-gui 看到 evidence。若把流程拆成「fix → user round 2 評估 → commit → ingest → apply → user round 3 評估 → commit → archive」：

1. **User round 2 評估看不到全貌** — ingest 後新增 verify item 尚未出現；user 對 round 2 全 OK 可能誤判「change 全完成」→ Claude 接 archive trigger 提前歸檔
2. **commit ceremony 翻倍** — 兩次 `/commit` 跑兩次 0-A/B/C quality gates（codex review + screenshot review + check + test），時間成本翻倍
3. **Spec / code 中間態 commit** — 中間 commit spec 跟 code 暫時不同步；reviewer 讀 history 需追兩個 commit 才看到完整 design
4. **多次 review-gui reload + tasks.md re-parse** — token / 注意力浪費

### 正確 sequence

```
review:ui (round N) → user 留 N 條 issue
  ↓
Claude triage 每條 issue 到 (A) UX/copy / (B) Behavior / (C) Spec gap
  ↓
(A)/(B) fix 落 code；(C) Spec gap → /spectra-ingest 補 spec → /spectra-apply 落 code（含新 verify item evidence）
  ↓ ALL DONE
review:ui (round N+1, FINAL) — user 對既有 + 新增 verify item 一次性評估
  ↓ 全綠
/spectra-archive（worktree merge-back + archive bookkeeping：mv folder + spec delta-sync）
  ↓
單一 /commit — 一次包 fix + ingest 產出 spec + apply phase code + archive rename + spec snapshot
```

> **收尾順序對齊 `archive-commit-order`（CLAUDE.md「Spectra Change 收尾：先 archive 再 /commit」段，source `claude-md/core-snippets/archive-commit-order.md`）**：commit **MUST** 在 `/spectra-archive` 之後。理由：archive 本身會產出 directory rename + spec delta 等**新的未 commit 改動**，若先 commit fix、archive 之後勢必還要第二個 commit 收 bookkeeping —— 那正是本 § 想避免的「雙 commit / 雙 0-A/B/C 慢路徑」。唯一達成單一 commit 的順序是 **archive 先、commit 後**。worktree v3 模型同此：`/spectra-archive` Step 0 先 atomic merge-back，user 再在 main 跑 `/commit`（見 [[worktree-default]] §5）。

### 例外

- **(A) / (B) only**（不涉及 ingest 的純 code fix）：fix → review:ui 最終評估 → archive → 單一 commit。本規約不限制此 happy path（commit 仍在 archive 之後，對齊 `archive-commit-order`）
- **`[discuss]` items** spectra-archive Step 2.5 walkthrough：另有獨立規約（本檔 § `[discuss]` flow）
- **跨 session handoff**：若 user 主動切到別 session 處理 apply，本 session 視為 handoff 完成；新 session 接手後仍須遵守此規則
- **獨立外部 trigger 撞進來**（與本輪 review:ui issue 無關的緊急 bug fix）：可在中段獨立 commit，但**不**觸發 review-gui 評估 round；本輪人工檢查仍延後到 apply 全部完成後一次做

### Cross-ref

- `archive-commit-order`（CLAUDE.md「Spectra Change 收尾：先 archive 再 /commit」段，source `claude-md/core-snippets/archive-commit-order.md`）— 收尾順序唯一真相：先 archive 再單一 commit；本 § sequence 對齊此
- [[worktree-default]] §5 — worktree v3 atomic landing：`/spectra-archive` Step 0 merge-back → user 在 main `/commit`
- [[proactive-skills.ingest-triggers]] § review:ui 觸發 ingest 的後續順序
- `plugins/hub-core/skills/spectra-ingest/SKILL.md` Step 9 Summary
- `plugins/hub-core/skills/spectra-apply/SKILL.md` 末段「apply 完成後 review:ui」
