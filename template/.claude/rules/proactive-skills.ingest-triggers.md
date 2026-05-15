<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.ingest-triggers.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Ingest triggers、UX Completeness Gate、Spectra Roadmap maintenance 與 Follow-up Register；寫 / 改 openspec/changes / HANDOFF / tech-debt / ROADMAP 時 path-scoped 載入
paths: ['openspec/changes/**', 'openspec/ROADMAP.md', 'HANDOFF.md', 'docs/tech-debt.md']
---

# Proactive Skills — Ingest, UX Gate, Roadmap & Follow-up Triggers

> Reference 檔。核心規約見 [`proactive-skills.md`](./proactive-skills.md)。本檔聚焦寫 / 改 `openspec/changes/**` / `HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md` 時 path-scoped 載入的 ingest 主動觸發信號、UX Completeness Gate hook 規約、roadmap 維護觸發語、follow-up register marker 規約。

> **歷史備忘**：本檔的 Spectra Roadmap Maintenance 段以 v1.10+ 內 SPECTRA-UX:START marker 內容為唯一來源；原檔尾部 v1.6 重複段已隨本次拆檔移除（pre-existing duplicate cleanup）。

## Ingest Triggers

`spectra-ingest` 是 apply 階段的「需求漂移補丁」。當 proposal / tasks / design artifact 與實際需求或實作現況出現結構性落差時，**Claude MUST 主動引導使用者**（不是等使用者自己想起）。

### 主動觸發信號

Apply 階段中偵測到以下任一信號 → 必須立即處理：

1. **使用者口頭改需求** — 對話中出現「順便加…」「其實應該…」「我想改成…」「還要支援…」等擴增或修改
2. **Journey / Entity 遺漏** — 實作中發現觸動了 proposal 的 `User Journeys` / `Affected Entity Matrix` 未列之 surface 或 schema
3. **Tasks 結構性落差** — 不是單一 task 字句調整，而是要整段新增 / 刪除 / 重排
4. **Design scope 溢出** — design review 發現 UI 影響範圍超出 proposal 原列頁面 / 元件
5. **Schema 漂移** — migration 新增 enum / column 但 `Affected Entity Matrix` 沒對應紀錄
6. **Risk plan 前提變動** — 實作中發現 `Implementation Risk Plan` 的 truth layer / contract / test plan 需要更新

`post-edit-drift-check.sh`（hook）會自動偵測 5、4、2 的部分靜默漂移，寫 stderr 提示 Claude 考慮 ingest。LLM 判斷層面則需要主動感知 1、3、6。

### 決策規則（明確直接做、模糊再詢問）

| 情況 | 動作 |
| --- | --- |
| 信號明確（migration 新增未紀錄欄位、使用者直白改需求、journey 遺漏具體 URL） | Claude **直接跑** `spectra-ingest`，口頭告知「偵測到 X，已觸發 ingest 更新 Y」 |
| 信號模糊（不確定是否達結構性落差門檻、可能只是 task 字句微調） | 先口頭詢問使用者，描述信號並列出選項（ingest vs. 在當前 tasks 微調）讓使用者選 |

**NEVER** 偵測到信號卻靜默繼續實作 — 會導致 proposal / tasks 與實作永久不同步。

### 必要流程

1. 判斷信號明確度 → 直接跑 `spectra-ingest` 或先問
2. 確認 proposal / tasks / design artifact 已同步新需求
3. 繼續或調整當前 apply，不回頭修舊 task 的字句以敷衍差異
4. Archive 前已被 ingest 吸收的漏項不需再補 `@followup` marker

### 與其他登記出口的分界

- **當前 change 本身的 scope 漏項 → `spectra-ingest`**（本節規則）
- 範圍外技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- Session 未完 WIP → `HANDOFF.md`
- 未來才做的工作 → `openspec/ROADMAP.md` `## Next Moves`

**心智模型**：ingest 是「這個 change 自己要改」；tech-debt / handoff / roadmap 是「這個 change 之外的事」。分不清時預設走 ingest，不要為了維持原 proposal 敘述而把應補項偽裝成 follow-up。

## UX Completeness Gate（補充 Design Gate）

**Design Gate 檢查 UI 視覺品質；UX Completeness Gate 檢查 UI 功能覆蓋**。
兩者並存，都必須通過。完整規則見 [`docs/rules/ux-completeness.md`](docs/rules/ux-completeness.md)。

### Propose 階段

`pre-propose-ux-scan.sh`（hook）+ `post-propose-journey-check.sh`（hook）強制要求：

- `## Affected Entity Matrix`（若觸動 DB schema / shared types）
- `## User Journeys`（強制；純後端寫 `**No user-facing journey (backend-only)**`）
- `## Implementation Risk Plan`（強制；固定回答 `Truth layer / invariants`、`Review tier`、`Contract / failure paths`、`Test plan`、`Artifact sync`）

這個區塊保持精簡，目的不是寫 implementation 細節，而是把最容易拖到 `/commit` 才被指出的前提問題提前回答。

### Apply 階段

`pre-apply-journey-brief.sh`（hook）抽出 journeys + risk plan 簡報給 implementer。

**Exit criteria**：完成所有 tasks 後必須：

1. 對照 User Journeys 逐一確認可在瀏覽器走通
2. 跑 `pnpm audit:ux-drift` 檢查 enum exhaustiveness 無新漂移
3. 派遣 screenshot-review agent 對每個 journey 截圖

### Archive 階段

`pre-archive-ux-gate.sh`（hook）跑：

- **Journey URL Touch**：proposal 的 journey URL 對應 UI 檔必須被動過
- **Schema-Types Drift**：migration 新增 enum/column → shared types 必須同步
- **Exhaustiveness Drift**：audit-ux-drift 偵測新漂移 → warn

`pre-archive-followup-gate.sh`（hook，v1.5+）跑：

- **Follow-up Register**：tasks.md 的 `@followup[TD-NNN]` marker 必須在 `docs/tech-debt.md` 有完整 entry，否則阻擋 archive。詳見 `follow-up-register.md`。

### 必禁事項

- **NEVER** 寫空洞的 User Journeys 為通過 gate
- **NEVER** 用 Non-Goals 隱藏忘記做的 surface
- **NEVER** 把 `if/else if/else` 用在 enum 分支
- **NEVER** 新增 route 但不在 navigation 加入口
- **NEVER** 把「tasks 全勾 + tests 綠」當作 feature complete

### 心智模型

| 錯誤直覺 | 正確認識 |
| --- | --- |
| DB migration 過了就是 feature ready | DB allow ≠ feature ready |
| API test 綠就是 UX 完成 | Tests pass ≠ UX done |
| 既有頁面有了就不用改 | Branching logic 要更多改動 |
| 記得住改了什麼 | 列舉比記憶可靠 |
| Kiosk/主流程做完就收工 | Admin 管理路徑同等重要 |
| 感覺完成就是完成 | 差的那一哩通常是 UI |

## Spectra Roadmap Maintenance

**`openspec/ROADMAP.md` 是 spectra 工作流的儀表板**。AUTO 區塊由
`pnpm spectra:roadmap` 自動維護（hooks 會自動觸發），MANUAL 區塊由
你在討論中主動累積。

### AUTO 區塊內容

| 區塊 | 來源 | 說明 |
| --- | --- | --- |
| `Active Changes` | `openspec/changes/**` 掃描 | stage / 進度 / 觸動的 specs |
| `Active Claims` | `.spectra/claims/*.json` | 誰正在做哪個 change、最後 heartbeat、哪些 claim 已 stale |
| `Parallel Tracks` | spec collision 分析 | independent / mutex / blocked |
| `Parked Changes` | `spectra list --parked --json` | park 後檔案不在 disk，但 metadata 仍要可見以免遺忘 |

v1.6+: `spectra:roadmap` 每次執行都是完整操作（無 mtime fast-path、無 `--force`
flag）。park / unpark 後直接跑 `pnpm spectra:roadmap` 即可。

### MANUAL 區塊 drift 偵測（v1.6+）

每次 sync 時會另外掃 MANUAL 區塊，對照以下三種 ground truth 找出過時內容：

| Drift 類型 | 偵測條件 | Ground truth |
| --- | --- | --- |
| `archived-as-active` | MANUAL 提到某 change 名稱，語意又稱之為「進行中 / draft / open / wip」 | `openspec/changes/archive/` 目錄 |
| `td-status-mismatch` | MANUAL 提到 `TD-NNN` + active 語意詞，但 register 標 done/wontfix | `docs/tech-debt.md` Status |
| `version-mismatch` | MANUAL 以「Production 跑 vX.Y.Z」/「目前 vX.Y.Z」敘述版本 | `package.json` `version` |

**Drift 不自動改寫 MANUAL**（避免誤刪人寫內容），以 stderr 警告提示。Claude 看到
drift warning 時**必須**主動更新 MANUAL 區塊（Current State / Next Moves），
並在回應中告知使用者已修正哪些過時敘述。

### 自動觸發點

| 時機 | 機制 | 保底 |
| --- | --- | --- |
| 新 session 開始 | `session-start-roadmap-sync.sh` | 永遠對齊 roadmap + claims |
| Edit/Write | `post-edit-roadmap-sync.sh` | 有 claim heartbeat 或改到 `openspec/changes/**` 時即時反映 |
| `spectra park` / `spectra unpark` 之後 | **你必須手動** `pnpm spectra:roadmap` | hook 沒監聽 `.spectra/spectra.db` |
| 在外部 runtime（背景 codex / 非 Claude Code session）跑 spectra command 之後 | **你必須手動** `pnpm spectra:roadmap && pnpm spectra:claims` | 外部 runtime 不觸發 PostToolUse hook |

### Work Claim 規則（v1.10+）

`HANDOFF.md` 與 `ROADMAP.md` 都不是鎖。**真正避免撞工的是 claim。**

開始做 active spectra change 前：

1. 先執行 `pnpm spectra:claim -- <change>`
2. 再開始修改該 change 或相關實作檔
3. 若是接手 `HANDOFF.md`：claim 成立後立刻移除對應 handoff 項目
4. 完成、park、archive、或交棒時，執行 `pnpm spectra:release -- <change>`

**`HANDOFF.md` 只保留尚未被接手的項目。**

### Claude 主動維護的時機

Claude **必須**在以下時機更新 `## Next Moves` 區塊（MANUAL block）：

1. `spectra-discuss` workflow 收斂出「未來要做的事」→ 寫入 `### 近期` / `### 中期` / `### 長期`
2. `spectra-propose` workflow 結束時，若對話提到其他尚未 propose 的未來工作 → 寫入
3. `spectra-archive` workflow 結束時，若剛完成的 change 影響 Next Moves 的排序 → 重新評估
4. 使用者明確說「記到 roadmap」/「排進下一步」→ 立刻寫入

**格式**：`- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy`

- priority: `high` / `mid` / `low`
- 依賴關係：若知道需要先等某個 change 完成，明確列出
- **NEVER** 捏造 Next Moves 為了填滿區塊

### 讀 ROADMAP 的時機

- 新 session 開始時（hook 已自動 sync，你只要 Read 即可）
- 開始規劃新工作前，先看 `## Active Changes` + `## Active Claims` + `## Parallel Tracks`
- 使用者問「parked 有什麼」「暫存的 change 還剩哪些」→ 看 `## Parked Changes` AUTO 區塊
- 使用者觸發以下關鍵字時（見下節「使用者觸發語」）

**不要依賴 `@openspec/ROADMAP.md` 快照引用** — 該機制只在 session 開頭載入一次，中途檔案變動不會反映。請用 Read 工具直接讀檔。

### 使用者觸發語（User trigger keywords）

使用者講下列任一關鍵字 → **立即**執行完整「sync → Read → 回報」流程：

| 類別 | 關鍵字（中文／英文） |
| --- | --- |
| 現況類 | 「roadmap 現況」/「專案現況」/「現在做到哪」/「現在在做什麼」/ "roadmap status" / "current state" / "where are we" |
| 下一步類 | 「接下來該做什麼」/「下一步」/「還有什麼要做」/ "what's next" / "next moves" |
| 刷新類 | 「看 roadmap」/「刷 roadmap」/「更新 roadmap」/ "show roadmap" / "refresh roadmap" |

**完整流程**（三步、不可跳）：

1. 跑 `pnpm spectra:roadmap` — v1.6+ 每次皆完整 sync，無需 `--force`
2. Read `<openspec>/ROADMAP.md` — 取得當前內容進入 context
3. 回報五件事：
   - **Active Changes 摘要** — 每個 change 的 stage + 進度 + 觸動的 specs
   - **Active Claims 摘要** — 哪些 change 已有人接手、哪些 claim 已 stale
   - **Parallelism 訊號** — 有無 mutex / blocked，能並行推進哪幾條線
   - **Parked Changes** — 有無暫存的 change 需要使用者決定 unpark / archive / 放著
   - **MANUAL drift warnings** — 若 sync stderr 有 drift 警告，先依警告修正 MANUAL 再回報
   - **Next Moves 狀態** — MANUAL backlog 有什麼項目，是否有本次對話該主動補進去的

**只 sync、不回報**：使用者說「sync roadmap」/「跑 spectra:roadmap」時，只執行第 1 步並簡報一行結果（含 drift 摘要若有），**不**繼續讀 + 分析。

**單純查詢、不強制 sync**：使用者只說「roadmap 裡有什麼」等純查詢問句時，可依賴最近一次 hook 觸發的結果直接 Read。

### 禁止事項

- **NEVER** 手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊內容 — 會被下次 sync 覆寫
- **NEVER** 把 AUTO 區塊的 active changes 複製到 MANUAL 區塊
- **NEVER** 為了填滿 Next Moves 編造使用者未提過的意圖
- **NEVER** 未 claim 就開始做 active change

## Follow-up Register (v1.5+)

`docs/tech-debt.md` 是所有 `@followup[TD-NNN]` marker 的 single source of truth。規則詳見 `follow-up-register.md`。

### Marker 語法（強制）

tasks.md 內未解決或延後項目 **MUST** 用 `@followup[TD-NNN]` 標註，每個 ID 在 register 有對應 entry。**禁止**自由文字（「DEFERRED」「LOCAL BLOCKED」「待後續處理」）不帶 marker。

### 自動化流程

| 時機 | 機制 | 動作 |
| --- | --- | --- |
| 新 session 開始 | `session-start-roadmap-sync.sh` | 跑 `pnpm spectra:followups` 摘要 open 數量 |
| `spectra-archive` 前 | `pre-archive-followup-gate.sh` | marker 未登記 register → `exit 2` 阻擋 |
| 手動 | `pnpm spectra:followups` | 詳細報告；`--fail-on-drift` 給 CI |

### Claude 主動維護的時機

- 人工檢查發現 deferred / local blocked 項 → 加 marker + 新增 register entry 一次到位
- Archive 前主動跑 `pnpm spectra:followups`，確認無 unregistered marker
- 使用者說「這個之後再弄」→ 提醒要建 TD-NNN entry

### 禁止事項

- **NEVER** 在 archive 前繞過 `pre-archive-followup-gate.sh`
- **NEVER** 為了通過 gate 而寫內容空洞的 register entry（Problem / Fix / Acceptance 必須具體）
- **NEVER** 在多個 register 以外的地方重複維護 follow-up 清單（single source of truth）
