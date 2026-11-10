---
name: "clade-session-work"
description: "Session, delegation, handoff, work tracking, and follow-up rules. Use when planning work, delegating, opening worktrees, coordinating agents, or ending a session."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/agent-routing.agent-boundary.md`：agent 與 user 的 handoff 邊界全文——目標動作失敗證據、session-scoped latch／claim／lease、四步判準與 red flags；常駐 [[agent-routing]] 只留 Iron Law 與本檔 MUST-Read；且碰 `HANDOFF.md`、`tasks/**`、`specs/**` 等 4 處
   - `rules/agent-routing.dispatch-execution.md`：dispatch 執行期的全文——已決定派工之後的 brief 範圍判定（§ 派多少）、plan mode 可派／不可派的逐列名單、配額耗盡時 dispatcher payload 算不出來的三條判斷、檔位永不降檔的形狀列舉（§ NEVER 降檔的形狀）、以及所有 dispatch 通用的 4-status 回報契約與「report 是未驗證主張」核實紀律。派不派／派給誰／主線靜默上限這些**判定入口**留在 [[agent-routing]]（對照表在 [[agent-routing.routing-table]]），本檔只承載執行期條文。**單純「要派工」不會自動載入本檔**：決定把工作交出去、寫出任何一份 brief 之前，MUST 依 [[agent-routing]] § 必禁事項 的強制指針主動 Read；改 pi dispatcher／routing gate 或 agent 定義檔時 path-scoped 載入；且碰 `rules/core/agent-routing.md`、`.claude/rules/agent-routing.md`、`vendor/scripts/pi-dispatch.ts` 等 6 處
   - `rules/agent-routing.keepalive-wake.md`：keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 structured user-input surface 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，要依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read；且碰 `.clade/keepalive/**`
   - `rules/agent-routing.md`：選 executor／model／effort、派工，或跑 commit 0-A 之前
   - `rules/agent-routing.pi-input-intercept.md`：Pi 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入；且碰 `specs/plans/**/tasks.md`、`specs/plans/**/design.md`、`.claude/agents/**` 等 4 處
   - `rules/agent-routing.pi-watch-protocol.md`：Pi dispatch、bounded phase、截圖取證與符合性判定的載體、brief、監看、receipt 與配額契約；派工前依 agent-routing 指針載入；且碰 `specs/plans/**/tasks.md`、`specs/plans/**/design.md`、`.claude/agents/**` 等 4 處
   - `rules/agent-routing.routing-table.md`：Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入；且碰 `.claude/rules/agent-routing.md`、`rules/core/agent-routing.md`、`vendor/scripts/pi-routing-policy.ts` 等 5 處
   - `rules/consumer-meta.md`：每個 consumer 自宣告 .claude/consumer-meta.json，描述 dev port / auth / database / deploy / verification 等 runtime 事實；clade 聚合成 registry/consumers-meta.json snapshot 供規則 / skill / audit 使用；且碰 `.claude/consumer-meta.json`、`registry/consumers-meta.json`、`registry/consumer-meta.schema.json` 等 4 處
   - `rules/flow-work-dates.md`：要對 Charles 或客戶給日期、寫 `flow work eta`，或複核自報 ETA 時
   - `rules/flow-work-tracking.md`：flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入；且碰 `vendor/scripts/flow/**`、`.clade/flow/**`
   - `rules/follow-up-register.md`：Follow-up Register 規則——work 不做完就不能結案的殘工併回同一份 plan，能先結案的後續項各開獨立 plan、標級、交 watch 派工；舊 TD 結構僅給未遷移 consumer；主動消化節奏；且碰 `tasks/**`、`specs/plans/**`、`docs/tech-debt.md`
   - `rules/handoff.md`：Handoff 規則——當 session 尚有未完成的 work item、blocker 或跨 agent 交接時，必須留下可執行的交接文件；且碰 `HANDOFF.md`、`tasks/**`、`specs/plans/**`
   - `rules/proactive-skills.design-checkpoint.md`：UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`app/**/*.ts` 等 16 處
   - `rules/proactive-skills.dev-server-spawn.md`：Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範；且碰 `scripts/dev-session*`、`vendor/scripts/dev-session*`、`.claude/consumer-meta.json` 等 4 處
   - `rules/proactive-skills.disabled-skill-guidance.md`：禁用 skill 清單的「不引導」那一半——任何 skill / rule / snippet / script 輸出 NEVER 出現叫人去跑禁用清單上那支 skill 的句子，含合法與違規的語境分界表與 audit 訊號。觸發是「正在寫或改 skill／rule／snippet／script 的輸出文案」，綁得到檔案故 path-scoped；禁用清單摘要（哪幾支 NEVER 主動觸發）留在 [[proactive-skills]]，逐支名單表（audit 解析源）在本檔；且碰 `rules/**`、`.claude/rules/**`、`capabilities/**/skills/**` 等 7 處
   - `rules/proactive-skills.manual-review-entry.md`：進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**`
   - `rules/proactive-skills.md`：收到新任務、判斷要不要主動叫 skill 或進 SDD 入口，或要寫會引導人去跑某支 skill 的文字時
   - `rules/runtime/agent-routing.keepalive-wake.md`：keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 structured user-input surface 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，MUST 依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read；且碰 `.clade/keepalive/**`
   - `rules/runtime/agent-routing.md`：Claude native routing transport
   - `rules/runtime/agent-routing.pi-input-intercept.md`：Codex 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入；且碰 `specs/plans/**/tasks.md`、`specs/plans/**/design.md`、`.claude/agents/**` 等 4 處
   - `rules/runtime/agent-routing.pi-watch-protocol.md`：claude native dispatch and watch controls；具名模型與 UI 角色由共通 routing table 決定；且碰 `specs/plans/**/tasks.md`、`specs/plans/**/design.md`、`.claude/agents/**` 等 4 處
   - `rules/runtime/agent-routing.routing-table.md`：Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability 與路徑可見性、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入；且碰 `.claude/rules/agent-routing.md`、`rules/core/agent-routing.md`、`vendor/scripts/pi-routing-policy.ts` 等 5 處
   - `rules/runtime/flow-work-tracking.md`：flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入；且碰 `vendor/scripts/flow/**`、`.clade/flow/**`
   - `rules/runtime/handoff.md`：Runtime adapter fragment for handoff.md；且碰 `HANDOFF.md`、`tasks/**`、`specs/plans/**`
   - `rules/runtime/proactive-skills.design-checkpoint.md`：UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`app/**/*.ts` 等 16 處
   - `rules/runtime/proactive-skills.dev-server-spawn.md`：Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範；且碰 `scripts/dev-session*`、`vendor/scripts/dev-session*`、`.claude/consumer-meta.json` 等 4 處
   - `rules/runtime/proactive-skills.manual-review-entry.md`：進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**`
   - `rules/runtime/proactive-skills.md`：Claude native orchestration and browser carrier
   - `rules/runtime/session-claims.md`：多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類；且碰 `.clade/claims/**`、`HANDOFF.md`、`capabilities/core/hooks/pre-bash-ownership-stamp.sh` 等 10 處
   - `rules/runtime/session-tasks.md`：ad-hoc 工作開工前 MUST 先建 per-session task 檔——觸發條件、檔名格式、共享單檔禁令、session context 預算門檻
   - `rules/runtime/session-tasks.operations.md`：Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界；另含**收工正文**（收工三步 / 收工訊息契約 / Herdr session transport / 派幾個 pane / successor 收割），由 [[session-tasks]] 的具名時機指針與 session-context-budget-warn hook 叫醒；且碰 `tasks/**`、`HANDOFF.md`
   - `rules/runtime/skill-management.md`：新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界；且碰 `.gitignore`、`.clade/skills/**`、`.claude/skills/**` 等 7 處
   - `rules/scope-discipline.md`：Scope discipline 規則——不擴散、必登記、不擅改他人成果，避免 AI 工作流吞掉 WIP 或把範圍外問題靜默遺失；且碰 `tasks/**`、`specs/**`、`ROADMAP.md` 等 6 處
   - `rules/session-claims.md`：多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類；且碰 `.clade/claims/**`、`HANDOFF.md`、`capabilities/core/hooks/pre-bash-ownership-stamp.sh` 等 10 處
   - `rules/session-cloud-unattended.md`：cloud session（claude.ai／routine／cloud-dispatch 開的 Claude Code on the web）一律無人值守：要決定的事寫成 GitHub 上的 BLOCKED 回報，不停下來等人；registry repo 的 issue 只准兩種用途，BLOCKED issue 解掉就關、逾期 3 天升級；且碰 `capabilities/core/hooks/pre-tool-cloud-question-gate.sh`、`vendor/scripts/lib/cloud-orphan-blocked.ts`、`vendor/scripts/lib/issue-usage.ts` 等 5 處
   - `rules/session-tasks.concurrent-writers.md`：Session task 與 merge／publish 遇到其他 writer 時的四層 contention probe，以及多 session 同寫 HANDOFF／ROADMAP／未遷移 consumer tech-debt 這類共享單檔的寫入紀律；常駐 [[session-tasks]] 只留 fail-closed 摘要；且碰 `tasks/**`、`HANDOFF.md`、`ROADMAP.md` 等 9 處
   - `rules/session-tasks.md`：開始非瑣碎的 ad-hoc 工作（第一個 tool call 前）、交棒、收工，或 context 預算提示出現時
   - `rules/session-tasks.operations.md`：Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界；另含**收工正文**（收工三步 / 收工訊息契約 / Herdr session transport / 派幾個 pane / successor 收割），由 [[session-tasks]] 的具名時機指針與 session-context-budget-warn hook 叫醒；且碰 `tasks/**`、`HANDOFF.md`
   - `rules/skill-management.md`：新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界；且碰 `.gitignore`、`.clade/skills/**`、`.claude/skills/**` 等 7 處
   - `rules/wip-orphan-recovery.md`：接手 interrupted session 或收到 dirty worktree 與失效 claim 訊號時使用；區分 ownership 未明與已確認無主的 WIP；且碰 `HANDOFF.md`、`tasks/**`

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
