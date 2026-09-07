---
description: Follow-up Register 規則——強制 tasks.md 的未解決項目使用 @followup[TD-xxx] marker 並在 docs/tech-debt.md 留下可追蹤 entry；archive gate 攔截未登記 marker
paths: ['openspec/changes/**/tasks.md', 'docs/tech-debt.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/follow-up-register.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->

# Follow-up Register

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
- ID 在主清單與既有 closed archive 合併後全 repo 唯一，不重編、不重用
- 一個 task 可帶多個 marker：`@followup[TD-003] @followup[TD-005]`
- 允許出現在 task body、備註段落、「備註」「Notes」等子段落

**禁止事項**：

- **NEVER** 用自由文字（例如「LOCAL BLOCKED: ...」「DEFERRED: ...」「待後續處理」）而不帶 marker
- tasks.md 的 follow-up 引用使用 marker；HANDOFF 與一般文件可用 TD ID 指向唯一入口

---

## Register 結構：`docs/tech-debt.md`

每個有效欠帳在主 register 保留一條入口；已結案 ID 由既有 `docs/archives/tech-debt-closed-*.md` 的精簡憑證承載。

```markdown
# Tech Debt Register

## Index

| ID | Title | Priority | Status | Discovered | Owner |
| --- | --- | --- | --- | --- | --- |
| TD-001 | mcp-token-store libsql 不相容 | low | open | 2026-04-20 B16 #10 | — |

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

| Status | 意義 |
| --- | --- |
| `open` | 待處理，archive gate 允許此 marker 通過 |
| `in-progress` | 某 change 正在解，archive gate 允許 |
| `done` | 已驗證完成，關卡回讀成功後退出主清單；歷史憑證可滿足 archive gate |
| `wontfix` | 明確放棄；**必須** 寫 Reason。archive gate 允許 |

### Priority 欄位語意

| Priority | 意義 |
| --- | --- |
| `critical` | 影響正式使用者或阻擋功能。下一個 sprint 必解 |
| `high` | 影響開發體驗或未來功能。Quarterly 內解 |
| `mid` | 有機會就解 |
| `low` | 留存備忘，時間允許即解 |

---

## Archive Gate（強制閘門）

`.claude/hooks/pre-archive-followup-gate.sh` 在 `spectra-archive` 前自動執行：

1. 掃描 change 的 `openspec/changes/<change>/tasks.md` 所有 `@followup[TD-NNN]` marker。
2. 每個 ID 對應主清單的有效 entry，或既有 closed archive 的唯一終態憑證；重複 ID、未知狀態與缺乏理由的關單會阻擋 archive。
3. 未結案 entry 保留 Problem / Fix approach / Acceptance；已結案憑證保留 ID、Status、Resolution 或 Reason，以及可核對的證據。
4. 等待外部條件、部分完成與已落地待驗收仍是未結案工作，保留在主清單。active 工作只從主清單產生。

不合規 → `exit 2` 阻擋 archive。

### 為什麼要這麼嚴格

以往 tasks.md 的 `DEFERRED` / `LOCAL BLOCKED` 註記在 archive 後被埋進 `openspec/changes/archive/` 目錄，沒人主動回頭 grep，結果是「寫了註記 = 沒寫」。本 gate 強制作者在 archive 前做出選擇：

- 寫入 register → 有 ID 有責任人，未來可追蹤
- 或 `wontfix` → 明確放棄 + reason
- 否則 archive 被擋住

---

## 主動消化

每個 repo 的 HANDOFF 只保留當前交接、必要決策與阻塞；已有 TD 的工作用 ID 指針連到唯一入口。tech-debt 每條保留問題、影響、下一個動作及驗收，等待項附責任人或可觀察觸發條件。

1. **收工時**：commit、handoff、work-loop 完成相關工作後，核對實際驗收證據，更新對應 TD 的狀態及精簡結論；同步移除 HANDOFF 的完成流水帳與重複背景。
2. **移出前**：執行 `node .clade/vendor/scripts/flow/flow.ts sources --apply`，回讀該 ID 的關卡結果。clade 自身使用 `vendor/scripts/flow/flow.ts`。關卡未完成就保留來源，移除文字不作為完成證據。
3. **關單後**：執行 `node .clade/vendor/scripts/rotate-closed-bloat.ts --all-closed` 移入 closed archive（clade 自身使用 `vendor/scripts/rotate-closed-bloat.ts`）；每條只保留 ID、結論、理由及證據，ID 不重編。等待訊號與未知狀態保留，不用歸檔數宣稱實際欠帳減少。
4. **開工時**：主件優先；從既有掃描挑一個不衝突、無活躍認領的同主題小批次，查證已完成／重複項或可局部回復的小修。涉及客戶承諾、安全、資料完整性、schema/API、憑證或正式部署的決策回到其既有授權流程；其餘大型工作保留具體接手入口。

寫入前重取目標檔的 dirty／claim 狀態；有人正在寫就先協調，基線有變則重讀。低價值淘汰與重複整併各附理由；完成數、整併數、淘汰數與純篇幅縮減分開回報。

## Session-start Surfacing

既有 SessionStart 呼叫 `collect-followups.ts --session-summary`，輸出有上限的候選與本節 pointer；沒有候選時靜默。讀不到清單時明示掃描不可用，不把它當清空。

| 欄位 | 契約 |
| --- | --- |
| 觸發條件 | 主清單存在 active 或待移出的終態條目時提示；不阻擋 SessionStart |
| 消費端 | 當前 session 依 § 主動消化 處理一個安全小批次；commit／handoff／work-loop 收工同步清理相關項 |
| 載入路徑 | 本規則；SessionStart 只注入本節指針與有上限的候選 |

---

## Collect Script：`pnpm spectra:followups`

`scripts/spectra-advanced/collect-followups.ts` 提供三種模式：

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
- **`commit.md`**：本規則只阻擋不完整的 archive；commit 收工依 § 主動消化 同步清理相關紀錄。
- **`session-tasks.md`**：`tasks/<id>.md` 內出現「等待中」「之後再說」性質的項目，session 結束升級時 **MUST** 建 TD-NNN entry，不能只留註記在 tasks 檔（tasks 檔會被刪 / archive，註記跟著消失）。

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

歷史引用：
  - 保留原 ID，提供 closed archive 的結論、理由與證據
```
