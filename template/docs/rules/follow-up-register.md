---
description: Follow-up Register 規則——強制 tasks.md 的未解決項目使用 @followup[TD-xxx] marker 並在 docs/tech-debt.md 留下可追蹤 entry；archive gate 攔截未登記 marker
globs: ['openspec/changes/**/tasks.md', 'docs/tech-debt.md']
---

# Follow-up Register

繁體中文 | [English](./follow-up-register.en.md)

**核心命題**：tasks.md 內的「DEFERRED / LOCAL BLOCKED / follow-up」註記在 archive 後會被埋進歸檔目錄，導致未解決項目消失在眾人視野。本規則用 **marker + register + archive gate** 三層結構強制這些項目不會遺漏。

此規則優先於個別 skill 說明與其他規則。

---

## Marker 語法（強制）

tasks.md 中**任何未解決或延後處理的項目**（deferred、local blocked、tech debt、operation note、cross-change follow-up）**MUST** 使用以下語法標註：

```markdown
- [x] #7 切換 `guest_policy` ... 驗證立即生效。**@followup[TD-004]** operation safety note：繞過 API 直接改 DB 會造成 cache drift。
```

**語法規則**：

- Marker 格式：`@followup[TD-NNN]` —— `TD-` 前綴 + 三位以上阿拉伯數字
- ID 在 `docs/tech-debt.md` 全 repo 唯一
- 一個 task 可帶多個 marker：`@followup[TD-003] @followup[TD-005]`
- 允許出現在 task body、備註段落、「備註」「Notes」等子段落

**禁止事項**：

- **NEVER** 用自由文字（例如「LOCAL BLOCKED: ...」「DEFERRED: ...」「待後續處理」）而不帶 marker
- **NEVER** 在 marker 外使用 TD-NNN（全 repo 以 marker 為唯一引用點）

---

## Register 結構：`docs/tech-debt.md`

每個 `TD-NNN` **MUST** 在此 register 有對應 entry：

```markdown
# Tech Debt Register

## Index

| ID     | Title                         | Priority | Status | Discovered         | Owner |
| ------ | ----------------------------- | -------- | ------ | ------------------ | ----- |
| TD-001 | mcp-token-store libsql 不相容 | low      | open   | 2026-04-20 B16 #10 | —     |

---

## TD-001 — mcp-token-store libsql 不相容

**Status**: open  
**Priority**: low  
**Discovered**: 2026-04-20 — `member-and-permission-management` 人工檢查 #10  
**Location**: `server/utils/mcp-token-store.ts` (createToken / findUsableTokenByHash / touchLastUsedAt / revoke)  
**Related markers**: search `@followup[TD-001]` in repo

### Problem

mcp-token-store 使用 D1 `$client.prepare()` raw API，local dev libsql 不相容，導致 local 無法 call MCP 認證流程（`database.prepare is not a function`）。Production D1 正常運作。

### Fix approach

改用 Drizzle ORM（`import { db, schema } from 'hub:db'`）。四處 raw SQL 皆有對應 drizzle 表達式。

### Acceptance

- Local `pnpm dev` 可 call `/mcp` 並通過 Bearer token 驗證
- 新 spec `test/integration/mcp-token-store.spec.ts` 覆蓋 CRUD
- B16 人工檢查 #10 可 local 跑一遍驗證（GUEST_ASK_DISABLED / ACCOUNT_PENDING）
```

### Status 欄位語意

| Status        | 意義                                            |
| ------------- | ----------------------------------------------- |
| `open`        | 待處理，archive gate 允許此 marker 通過         |
| `in-progress` | 某 change 正在解，archive gate 允許             |
| `done`        | 已完成，留下條目作歷史。archive gate 允許       |
| `wontfix`     | 明確放棄；**必須** 寫 Reason。archive gate 允許 |

### Priority 欄位語意

| Priority   | 意義                                         |
| ---------- | -------------------------------------------- |
| `critical` | 影響正式使用者或阻擋功能。下一個 sprint 必解 |
| `high`     | 影響開發體驗或未來功能。Quarterly 內解       |
| `mid`      | 有機會就解                                   |
| `low`      | 留存備忘，時間允許即解                       |

---

## Archive Gate（強制閘門）

`.claude/hooks/pre-archive-followup-gate.sh` 在 `spectra-archive` 前自動執行：

1. 掃描 change 的 `openspec/changes/<change>/tasks.md` 所有 `@followup[TD-NNN]` marker
2. 每個 `TD-NNN` **MUST** 存在於 `docs/tech-debt.md`
3. **MUST** 對應 entry 的 Status 欄位 ∈ `{open, in-progress, done, wontfix}`
4. **MUST** 有 Problem / Fix approach / Acceptance 三個段落（或顯式 `Status: wontfix` + Reason）

不合規 → `exit 2` 阻擋 archive。

### 為什麼要這麼嚴格

以往 tasks.md 的 `DEFERRED` / `LOCAL BLOCKED` 註記在 archive 後被埋進 `openspec/changes/archive/` 目錄，沒人主動回頭 grep，結果是「寫了註記 = 沒寫」。本 gate 強制作者在 archive 前做出選擇：

- 寫入 register → 有 ID 有責任人，未來可追蹤
- 或 `wontfix` → 明確放棄 + reason
- 否則 archive 被擋住

---

## Session-start Surfacing

`.claude/hooks/session-start-roadmap-sync.sh` 在 roadmap sync 之後呼叫
`collect-followups.mts --session-summary`，把以下內容印到 stderr（agent 可見，不擋流程）：

- **Open / In-progress 數量** + top 5 by priority（critical → high → mid → low）
- **Unregistered Markers** —— tasks.md 有 `@followup[TD-NNN]` 但 register 沒登記（通常是剛加 marker 還沒跑 register 更新）
- **Incomplete Entries** —— register 有 entry 但缺 Problem / Fix approach / Acceptance 或 wontfix 缺 Reason
- **Orphaned Entries 計數** —— register 有 entry 但 tasks.md 沒引用（手動 `pnpm spectra:followups` 取完整清單）

全綠時靜默不輸出。每次 session 開始，agent 看到 open / drift 就會主動提醒使用者處理。

---

## Collect Script：`pnpm spectra:followups`

`scripts/spectra-ux/collect-followups.mts` 提供三種模式：

```bash
pnpm spectra:followups            # 人類可讀報告
pnpm spectra:followups --json     # CI / automation
pnpm spectra:followups --fail-on-drift  # CI gate：未登記 marker 時 exit 1
```

輸出內容：

- 所有已登記 `TD-NNN` 的 Status / Priority 聚合
- 所有 tasks.md 的 `@followup[TD-NNN]` 使用位置
- Drift（未登記 / orphaned）清單

---

## 與既有規則的關係

- **`ux-completeness.md`**：本規則補充「Definition of Done」延伸面——即使 tasks 全勾，若有 follow-up marker 未登記 register，archive 仍被擋。
- **`proactive-skills.md` Design Gate**：Design Gate 檢查 UI 視覺品質；本 Follow-up Gate 檢查未解決項是否有追蹤。兩者並存。
- **`commit.md`**：本規則不阻擋 commit，只阻擋 archive。commit `/commit` 流程不變。

---

## 必禁事項

- **NEVER** 用自由文字註記 follow-up 而不帶 `@followup[TD-NNN]` marker
- **NEVER** 在 archive 前用 `--skip-hooks` 之類繞過 archive gate
- **NEVER** 把本規則當作「多餘繁文」—— 隱患擱置正是本規則防堵的對象
- **NEVER** 在 register 寫入內容空洞的 entry 只為通過 gate；Problem / Fix approach 必填且具體

---

## 違反時的回報方式

Hook / script 偵測到違反時，輸出格式統一：

```
[Follow-up Gate] 未登記 marker

問題：change `<change-name>/tasks.md` 出現 @followup[TD-003]，但 docs/tech-debt.md 無此 ID

修正方式：
  - 補寫 docs/tech-debt.md 的 TD-003 entry（包含 Problem / Fix / Acceptance 三段）
  - 或移除 tasks.md 的 marker（若問題已無效）

繞過：
  - 若此 marker 是刻意保留作歷史註記，改為 `@followup[TD-003-archived]` 並在 register 標 Status: wontfix + Reason
```
