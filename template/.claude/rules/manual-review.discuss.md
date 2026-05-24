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
