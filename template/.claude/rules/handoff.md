---
description: Handoff 規則——當 session 尚有未完成的 spectra work、blocker 或跨 agent 交接時，必須留下可執行的交接文件
paths: ['HANDOFF.md', 'openspec/changes/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/handoff.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Handoff

**核心命題**：session 結束時若仍有 in-progress 的變更、未 commit 的 WIP、或明確的 blocker，資訊不能只留在對話上下文。必須落到 `HANDOFF.md`，讓下一個 session / agent 能直接接手。

此規則優先於個別 skill 說明與 ad-hoc 習慣。

## 什麼時候建立或更新 `HANDOFF.md`

符合以下任一情況，**MUST** 建立或更新專案根目錄的 `HANDOFF.md`：

- session 結束時仍有 active spectra change
- 被 `/clear`、context window、或外部中斷打斷
- 有未 commit 的 WIP 需要之後接續
- 工作轉交給其他 agent / runtime（Claude、Codex、Copilot、Cursor、subagent）
- 使用者明確要求留下交接

## 建議格式

```markdown
# Handoff

## In Progress

- [ ] 正在做什麼（change 名稱、task 編號、主要檔案）
- 目前做到哪裡、剩下什麼

## Blocked

- 被什麼擋住
- 還缺什麼資訊 / 權限 / 決策

## Next Steps

1. 下一步最先做什麼
2. 接著做什麼
3. 注意事項 / 風險 / 陷阱
```

## 生命週期

- `HANDOFF.md` 是 **session-scoped**
- `HANDOFF.md` 只保留**尚未被接手**的項目，以及**當前 baseline snapshot blocks**（如 `## Worktree & Stash Audit` / `## Review-gui Readiness` / `## Parked changes` / `## Deferred discuss`）；snapshot block **MUST** 以覆寫式更新，**不**累積歷史版本
- **不得**保留已完成 chronological session narrative（`## YYYY-MM-DD ...` 形式的 session log）；完成的 dated section **MUST** rotate 到 `docs/archives/<YYYY-MM>-handoff-narrative.md`（per § 歷史段路由）
- 新 session 接手後：**先建立 claim** → 移除已接手項目 → 繼續執行
- 所有項目都接完後：刪除 `HANDOFF.md`
- **允許 commit 進 git**，因為跨機器、跨 agent 交接時很有價值

## 接手流程

接受 handoff 時，順序必須是：

1. 執行專案的 `spectra:claim` script，宣告接手的 change
2. 確認 `openspec/ROADMAP.md` 已反映新的 ownership
3. 從 `HANDOFF.md` 移除對應項目
4. 若 `HANDOFF.md` 已空，直接刪除整份文件

**不是「讀了就刪」**，而是**「claim 已成立後再刪」**。

## 與長期知識的分工

| 文件 | 用途 | 生命週期 |
| --- | --- | --- |
| `HANDOFF.md` | 尚未被接手的 WIP、blocker、next steps、當前 baseline snapshot blocks | 短期、用完即清 |
| `tasks/<id>.md` | 本 session 工作記憶（per-session 一檔） | 短期、session 結束升級或刪 |
| `.spectra/claims/**` | 即時 ownership / heartbeat | 短期、機器維護 |
| `docs/archives/<YYYY-MM>-handoff-narrative.md` | 從 HANDOFF rotate 過來的已完成 dated session narrative | 長期、month-bucket append-only |
| `docs/archives/<YYYY-MM>-<topic>.md` | 一次性 wave / 主題盤點成果（既有用途） | 長期 |
| `docs/solutions/**` | 非直覺問題的解法沉澱 | 長期 |
| `docs/decisions/**` | 架構決策與取捨 | 長期 |
| `openspec/ROADMAP.md` | 進行中 change、active claims、未來工作排序 | 持續維護 |

**與 `session-tasks.md` 的銜接**：tasks 檔內未完項在 session 結束時若需下一 session 立刻接手，**MUST** 升到 `HANDOFF.md` 的 `## In Progress`，不能只留在 tasks 檔等下一 session 自己 grep。

## 歷史段路由（Mode B 2B.1 Health Gate 用）

對 `HANDOFF.md` 每個 `## ` section 依下表分類處置：

| 類型 | 判定規則 | 處置 |
| --- | --- | --- |
| **active** | section 含 `- [ ]` unchecked checkbox / `Outstanding` / `Next session` / `下次 session` / `待後續` / `待客戶` / `等客戶` / `等 prod` / `[discuss]` / `尚未` / `未完` / `TODO` / `awaiting` 等 keyword | 留 `HANDOFF.md` |
| **baseline-snapshot** | section title 含 `Worktree Audit` / `Review-gui Readiness` / `Parked` / `Deferred discuss` / `跨 repo` / `並行 session` / `In Progress` / `Blocked` / `Next Steps` 等基準關鍵字；或 section title 無 `YYYY-MM-DD` 前綴 | 留 `HANDOFF.md`（**覆寫式**更新，不累積歷史版本） |
| **completed-narrative** | `## YYYY-MM-DD ...` 且**不**符 active / baseline 條件（純已完成 prose + checked checkbox） | rotate 到 `docs/archives/<YYYY-MM>-handoff-narrative.md`（month-bucket，append-only） |
| **ambiguous** | 介於上述之間、無法穩定判定 | 保守保留 `HANDOFF.md` + 標 review-pending（等下次 Mode B 重判） |

> **baseline 過度累積**：若 `HANDOFF.md` 大多為 baseline section 但仍超 size / lines threshold（clade 自家常見情境），表示 baseline 已過度膨脹，**MUST** 評估是否該把某些 baseline 段拆出成 `docs/archives/<YYYY-MM>-<topic>.md` 或 `docs/solutions/<topic>.md`、`docs/decisions/<topic>.md`。HANDOFF 不是長期 KB。

審計訊號（`vendor/scripts/handoff-drift-scan.mjs`）對應的觸發點：

- `handoff-size-exceeded` / `handoff-lines-exceeded`：HANDOFF.md 超過 size / lines threshold（default 30 KB / 400 lines；env / registry override 可調）
- `narrative-section-stale`：completed-narrative dated section 超過 narrative_age_days（default 3 天）
- `active-section-stale`：active dated section 超過 active_age_days（default 14 天）→ 提醒「outstanding work 可能 silently 卡住」

> **14 天是 escalation threshold，不是 grace period**。所有 active item 預設都應儘速處理；Mode B 盤點時**一律列入 outstanding 並推薦處理**，不因 age < 14d 而降低優先序或省略。14d threshold 的作用僅是「超過時語氣升級為 warn — 可能 silently 卡住」，不代表「未超過 = 不需關注」。

審計只 warn 不阻擋；實際 rotate 由 `/handoff` Mode B Health Gate 執行（per `plugins/hub-core/skills/handoff/SKILL.md § 2B.1`）。

## Outstanding writing hygiene (v1.14+)

**核心命題**：HANDOFF.md `## Outstanding` / `## In Progress` 推薦 next move 前，**MUST** 跑當次 ground-truth signal 確認；禁止把 task 進度當 land 安全度寫。

### 禁止寫作 anti-pattern

- ❌ 「wt N/M done，**最快 deliverable**」— task 進度跟 merge-back 安全度不同維度。撞 PTB（pre-fork baseline hides in-flight feature）的 wt 即使 task 100% 也不快
- ❌ 「safe to land」/「clean merge」/「ready to archive」— 沒跑 dry-run 確認前不該下這些斷言
- ❌ 「只剩 archive」— 只說工作 phase，不說執行風險

### 推薦寫法

- ✅ 「wt N/M done，⚠ merge-back unsafe（PTB: 無 baseline ref + K uncommitted），需 user 拍板 commit-all/abandon/defer」
- ✅ 「wt clean，可直接 merge-back → /spectra-archive」（**前提：已跑 dry-run 確認 0 blocker + 有 baseline ref**）
- ✅ 「剩 #X [discuss] 等 prod deploy signal」（user-bound 明確）

### 寫 outstanding 前必跑 signal（hard rule）

對涉及的每個 wt：

```bash
node vendor/scripts/wt-helper.mjs merge-back <slug> --dry-run 2>&1
git -C <wt-path> status --porcelain | wc -l
git for-each-ref "refs/wt-baseline/<slug>/" --format='%(refname)'
```

把結果（blocker count、uncommitted count、baseline ref present/absent）反映在 outstanding 描述。不跑 = 寫的是上次 session 的樂觀推測，不是 ground truth。

### 為什麼這條 rule 存在

2026-05-23 實證：HANDOFF outstanding 寫「page-titles-baseline 收尾（最快 deliverable，wt 32/33 done）」 → 下一 session `/handoff` dispatch `/spectra-archive` → merge-back 撞 793 staged blockers + 無 baseline ref → 連續 3 輪 AskUserQuestion 才退回 Defer。3 輪 round-trip 全可在 outstanding 寫作階段跑 1 條 dry-run 避免。

## Outstanding actionability hygiene (v1.15+)

**核心命題**：HANDOFF.md `## Outstanding` / `## Next Steps` / handoff Mode B § 2B.4 推薦下一 session（含 remote-control session、並行 Codex / Cursor session、人類 user）動工時，**MUST** inline 必要 actionable detail；禁止「by reference」handoff（只列 candidate 名稱 + 1-line summary + 指向 audit/scan/decision doc，要 receiver 自己 grep 還原 context）。

### 適用範圍

| 動工類型 | 是否適用 |
| --- | --- |
| 推薦下一 session 跑 `/spectra-propose <new-slug>`（新 change） | ✅ 適用 — 需 inline pattern / scope / target API |
| 推薦 `/spectra-apply <existing-change>` / `/spectra-archive <existing-change>` | ❌ 不適用 — change directory 自帶 spec / tasks，receiver 直接讀 |
| 推薦跑 `wt-helper merge-back <slug>` / `/commit` 等 mechanical action | ❌ 不適用 — slug 已自帶 context |
| 推薦下一 session 接手某 in-progress wt | ✅ 適用 — 需 inline 當前狀態（done / blocker / next step）+ 主要檔案路徑 |
| 推薦從 audit / scan / decision doc 撈 candidate 開新工作 | ✅ 適用 — 需 inline 必要細節讓 receiver 不必重 grep |

### 寫法要求（refactor / extraction / migration 類 propose target）

**MUST** inline 4 件事（或提供完整 pasteable prompt 含這 4 件事）：

1. **Audit / scan / decision 來源 + 行號**：`docs/audit/<file>.md` 哪一段或 `docs/decisions/<file>.md` 哪一節
2. **Pattern + 涉及檔案 list**：具體 file path 列表 + 識別 token（callsite shape / class / function name / migration timestamp）
3. **Target API / 結構**：抽出 / 重構 / 遷移後的 component / function / module / schema signature
4. **Scope boundary**：要動哪些檔、不動哪些檔（per scope-discipline）；同 file 內哪些 callsite 在 scope 哪些不在

### 禁止寫作 anti-pattern

- ❌ 「Candidate X — 取代 N callsites，詳見 docs/audit/Y.md」— 指向 doc 但不 inline，receiver 必須 round-trip
- ❌ 「跑 `/spectra-propose <slug>`」— bare argument，propose skill 收到要自己 investigate；如有 9 條 candidate 還要 receiver 挑哪一條
- ❌ 「從 high impact 第一條開始」— 不指定 candidate identifier
- ❌ 「Audit 結論詳見 `docs/audit/X.md`」當作 HANDOFF 唯一指引 — implicit pointer 不算 inline

### 範例

❌ 不夠（2026-05-24 <consumer-a> HANDOFF Next Steps #4 實證問題寫法）：

```markdown
### 4. Nuxt UI v4 audit refactor candidates（9 條，本次稽核產出）

`docs/audit/nuxt-ui-audit-2026-05-23.md` 末段「Phase 4」整理：

- **高 impact 3 條**: C1 `<AppStatusBadge>` (44 callsites) / C2 `<AppPanelCard>` (12+) / C3 `<AppOverlayShell>` (~26)
- **中 impact 3 條**: ...

建議路徑：對任一 candidate 開 `/spectra-propose <candidate-slug>`，從 high impact 開始。
```

→ 結果：remote session 收 `/spectra-propose app-status-badge-extraction` argument 後立刻問「scope 不夠 — 是哪種 badge？目前散落在哪？要抽到哪？」前 5-10 分鐘全在重做 investigation。

✅ 夠（inline 4 件事）：

```markdown
### 4. C1 `<AppStatusBadge>` extraction（high signal × low complexity）

- **Audit 來源**：`docs/audit/nuxt-ui-audit-2026-05-23.md` line 162-181 + 869-881
- **Pattern**：`<UBadge :color="statusBadgeColor[row.status] ?? 'neutral'" variant="subtle" size="sm">{{ statusLabel[row.status] }}</UBadge>` + 各檔自己 declare 的 `statusBadgeColor` / `statusLabel` constant
- **涉及 8 files**：
  - `packages/ehr/app/pages/admin/attendance/index.vue`
  - `packages/ehr/app/pages/admin/attendance/amendments.vue`
  - `packages/ehr/app/pages/admin/salary/index.vue`
  - `packages/ehr/app/pages/admin/schedules/index.vue`
  - `packages/ehr/app/pages/admin/overtime/index.vue`
  - `packages/ehr/app/pages/admin/overtime/backpay.vue`
  - `packages/ehr/app/pages/admin/petition/index.vue`
  - `packages/ehr/app/pages/admin/contracts/index.vue`
- **Target API**：`<AppStatusBadge :status :color-map :label-map />`
- **Target location**：`packages/core/app/components/AppStatusBadge.vue`
- **Scope boundary**：
  - 動：8 files 的 Pattern A status badge callsite + 新增 1 個 component
  - 不動：其他 UBadge usage（Pattern B count badge / Pattern C `<AppDetailPage>` header pill 不在 scope；另開 candidate C4 / C5 處理）

**Dispatch**：`/spectra-propose app-status-badge-extraction`（上面 5 項當 propose context 貼入）
```

### 為什麼這條 rule 存在

2026-05-24 實證：<consumer-a> HANDOFF Next Steps #4 列 9 條 Nuxt UI audit candidate，只給 1-line summary + 指向 audit doc。當天另開 remote-control session 嘗試接 C1 → `/spectra-propose app-status-badge-extraction` 後第一句就是「argument 看起來像在說『把 app 內的 status badge 抽出來』，但細節不夠 — 是哪種 badge？目前散落在哪？要抽到哪？」，開始重跑 grep / glob 探索。

Root cause = HANDOFF writer（包含 Mode B § 2B.4 推薦階段）把 audit doc 當「receiver 自己會 grep」的 implicit context，沒 inline 必要細節。Receiver 重做 investigation = 重複 main session 已 sunk 的 token，且容易 scope drift（receiver 可能對「44 callsites」「8 files」「Pattern A vs B vs C」的邊界判斷不同）。

「治根」修法 = 在 outstanding 寫作層強制 inline，不靠 audit doc 當 indirection。

## Drift detection (v1.13+)

每次 session start 時，`session-start-roadmap-sync.sh` hook 會跑 `scripts/handoff-drift-scan.mjs`，自動掃所有 `session/*` worktree 跟 `HANDOFF.md` 內容比對，把 drift 寫到 stderr：

- **unmentioned-progress** — branch HEAD 已 commit 但 slug 沒在 HANDOFF 出現 → 下個 session 看不到這個工作
- **mention-stale** — branch 最新 commit 時間晚於 HANDOFF mtime → HANDOFF 描述可能過時
- **merged-but-not-cleaned** — branch 已 fully merge 進 main 但 worktree 還在 → 可跑 `wt-helper cleanup` 或讓 archive 自動吸收

理由：[[worktree-default]] §5.5 採 atomic landing model，worktree → main 吸收延後到 `/spectra-archive` 才發生。中間 subagent commit 後若 user 沒同步更新 HANDOFF，下個 session 可能誤判工作未做。drift scan 把這類情境 surface 出來。

行為：scan 是純 informational，**不**擋 session、**不**自動改 HANDOFF。User 看到警告後依情境跑 `/handoff` refresh、或繼續工作（warnings 在每次 session start 重新評估，工作完成 archive 後自動消失）。

## 禁止事項

- **NEVER** 把需要交接的資訊只留在對話裡
- **NEVER** 用含糊句子如「差不多好了」「剩下一點點」
- **NEVER** 把 `HANDOFF.md` 當成長期知識庫，結案後不清理
- **NEVER** 在 `HANDOFF.md` 累積 `## YYYY-MM-DD` chronological session log；已完成 dated section **MUST** rotate 到 `docs/archives/<YYYY-MM>-handoff-narrative.md`
- **NEVER** 在 baseline snapshot block（Worktree Audit / Review-gui Readiness / Parked / Deferred discuss）累積歷史版本；snapshot 必須**覆寫式**更新
- **NEVER** 在 handoff 裡省略 change 名稱、task 編號、關鍵檔案路徑
- **NEVER** 接手之後還把同一項目留在 `HANDOFF.md`
