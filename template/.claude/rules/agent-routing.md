<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Agent Routing

**核心命題**：當工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。本規則優先於個別 skill 內嵌的工具呼叫指示。

> 本檔是 routing 主規則（每 session 必載入）。派工模板、Watch Protocol、Plan-first / Git baseline、Runtime Gate 詳述見 [`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md)（下稱 reference）。

## Routing Table

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Web search**（即時資料 / 外部資訊查詢） | **Codex（GPT-5.5 medium）** | 中思考預算 + Codex 搜尋整合。 |
| **Code review（commit 0-A）** | **(1) `simplify` + (2) `codex review --uncommitted` high（GPT-5.5），(3) 0-A.1 出 Critical / Major 時條件升 xhigh** | 跨模型互補盲點。詳見 `.claude/skills/commit/SKILL.md` Step 0-A。 |
| **Spectra `propose` 階段（draft）** | **使用者選單三選一**：A Codex GPT-5.5 xhigh draft（預設/推薦）／ B 雙段 codex：Codex GPT-5.5 xhigh draft ＋ Codex GPT-5.5 xhigh review（Fable 暫不可用，原為 Fable 5 High draft，暫以 codex 代）／ C 純 Claude | 預設跳三選一選單；使用者明確指定路徑時跳過。詳見 `spectra-propose` Step 0。 |
| **Spectra `propose` cross-check / final check** | **主線 Claude Opus 4.8 xhigh** | 主線 = quality gate（A 的 cross-check、B 的 final check 都由主線跑），不只是 dispatcher。 |
| **Spectra `apply`（非 Design Review、非 UI view phase，phase 粒度）** | **Codex GPT-5.5 high** | medium 漏 schema drift 風險高；phase 粒度避免 round-trip。 |
| **Spectra `apply` UI view phase（component / page / view / layout / styling）+ Section 7（Design Review）** | **主線 Claude Opus 4.8 xhigh，永不派 codex** | 視覺 / 互動 / a11y 與 Design skill 緊耦合，Codex tooling 弱。非 view 的 frontend 不在此範圍，仍走 codex（範圍同 § Phase Dispatch C 類）。 |
| **`screenshot-review` verify mode**（`[verify:ui]` channel / archive 前視覺 QA） | **主線 Claude 直派 Codex GPT-5.5 low**（Bash 走 reference § Codex 派工的標準流程；**禁止** `Agent` tool with `subagent_type: screenshot-review`） | sonnet wrapper 會繞過 Step 0 自做工作（[[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。詳見 reference § screenshot-review Verify Mode Dispatch。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段） | **主線自己 scaffold `_dev-login` route + curl mint session**（**禁止**要 user 手動取 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing） | 詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |
| **Mechanical fan-out**（收集 / 掃描 / 跑指令驗證型 subagent 工作：grep 掃描、收 evidence、驗證矩陣、fleet 多 repo 盤點） | **Codex（GPT-5.5 medium~high）via 泛用 dispatcher** | Claude subagent fan-out 實測佔 CC 等價成本 17-21%/日，codex 同工作 ~1/10 成本且 fidelity 100%（PoC 實證）。dispatcher 與 template 見 reference § 泛用 Dispatcher。例外留 Claude：需要 claude.ai-connected MCP（Notion 等）、判讀 / 治理型分析（如 /oops Mode D 判讀段）、user 明確要求。 |
| **Read-heavy 長文件 / fleet 掃描**（上游 release notes 解析、跨 consumer reality matrix、pitfall 全量掃描、大 rule 改版前 baseline 重讀） | **Codex（GPT-5.5 medium）via 泛用 dispatcher** | read-heavy + structured output 是 codex 強項（中文 brief fidelity 100% 已驗證）。摘要僅作輸入，規約措辭與拍板必回主線。 |
| **Debug evidence 段**（log 完整 capture / repro script 撰寫執行 / 既定 hypothesis 的驗證迴圈） | **Codex（GPT-5.5 high）via 泛用 dispatcher** | debug 是最大消耗桶；evidence / repro / verify 是機械段，root cause 推斷與修法設計留主線。repro 必在 throwaway worktree（template 內建 guard）。 |
| **commit 0-C fix-verify loop**（pnpm check / test 修到全綠） | **Codex（GPT-5.5 high）via 泛用 dispatcher** | 機械修 lint / type / test 與 dep-upgrade 已驗證模式同構；主線同回合續跑 0-A / 0-B。詳見 commit SKILL Step 0-C。 |
| **spectra-apply Step 8a self-collect (a)(b)**（dev-login allow-list 小 mod + service_role DB query 證 data shape） | **Codex（GPT-5.5 medium）via 泛用 dispatcher** | PoC 已實證 codex 能跑完整 evidence chain；annotation 寫回 tasks.md 維持主線。詳見 spectra-apply SKILL Step 8a。 |

## Orchestration Residency（誰持有長 session — 決定層）

**核心命題**：Routing Table 決定誰**寫** code，這裡決定誰**持有長 session**——主線負擔大頭是 turn 數 × 每 turn 重讀 context，live-watch 會讓它整段燒著。依 change 特性二選一：

### Codex-primary（Codex 扛整條 session）

**進入條件**（A 或 B 命中即走）：

- **A. 純非-view change**：整條 change **沒有任何 UI view phase**（view 檔案判準同 § Spectra Apply Phase Dispatch B 類）**且** tasks.md 已定稿——工作性質是「執行已知計畫」。
- **B. 機械式 sweep**：lint fix / dep upgrade / rename / cross-file refactor / test 修復 / codemod，即使無正式 tasks.md。

**做法（change 粒度，不是 phase 粒度）**：

1. 主線**一次** dispatch 整條 change 的**所有**非 view phase 給單一 background codex（prompt 列全部 phase + acceptance + Plan-first + Commit Authorization；模板見 reference § Codex 派工的標準流程）。**NEVER** 一個一個 phase 派（phase 粒度是 Claude-primary 才用）。
2. Dispatch 後 **notification-only watch**（reference § 監看排程）——idle 等通知，**不**逐 phase cross-check、**不**短輪詢。
3. 完工通知後**一次** change 粒度 cross-check：commit 數 / format 合規、view-layer drift + scope discipline（reference § Spectra Apply Phase Dispatch Step 5）、typecheck + test。
4. 主線**自己**跑 Section 7 Design Review（永不派 codex）。
5. 進 `/commit` 0-A gate。

把關移到邊界：兩道 gate（`/commit` 0-A + archive Design Review）作用在最終 diff 上。

### Claude-primary（以下任一命中即留主線）

- **UI view 工作**（per Routing Table 永不派 codex）
- **架構 / 設計決策、需求模糊**——先 plan mode 釐清
- **安全敏感** / 需 tight review loop 的 change
- **clade routing / 規則知識**的編輯
- **路徑未知的探索式 debug**

個別 phase 仍可派 codex → 走 § Spectra Apply Phase Dispatch。

### 機械 Enforcement（residency-classify + archive-gate Check 8）

**為什麼**：本節上線 6 天實測（2026-06-11 audit），eligible change 採用率僅 1/3 — 兩條純非-view change 仍由主線自做、0 dispatch。文字規約對 routing 自律無效，故比照 Check 7 / E.1 先例補機械強制點。

- spectra-apply 開工後、任何 dispatch 決策前，**MUST** 跑 `node ~/offline/clade/vendor/scripts/residency-classify.mjs classify --change openspec/changes/<change>` 拿機械 verdict
- **MUST** 立刻 record decision：`node ~/offline/clade/vendor/scripts/residency-classify.mjs record --consumer-path . --change <change> --verdict <v> --executor <codex|claude> [--reason ...]` → 落 `.spectra/residency-ledger.jsonl`
- verdict=`codex-primary` 而決定 executor=`claude` → `--reason` 必填（record 入口會擋）
- archive-gate **Check 8** 機械驗 record 存在：缺 record → archive exit 2；正當例外加 `<!-- residency-decision: intentional, reason: ... -->` 到 tasks.md 繞過
- adoption 量測：`node ~/offline/clade/scripts/audit-codex-adoption.mjs`（clade home 稽核：verdict × executor 表 + dispatch ledger 分桶）

## Spectra Propose Handoff（決策層）

1. **MUST** 預設跳三選一 dispatch 選單（A Codex draft + 主線 cross-check／B 雙段 codex：Codex draft + codex review + 主線 final check（Fable 暫代）／C 純 Claude）。使用者**明確**指定路徑（「純 Claude propose」「不要派 codex」「用 Fable」「用 codex」等）時跳過選單直接走。詳見 `spectra-propose` Step 0
2. **MUST** 主線是 quality gate — A 的 cross-check 與 B 的 final check 都由主線 Opus 4.8 xhigh 跑，不要把所有事推給 draft runtime（codex）後直接結束
3. **NEVER** 把 cross-check / final check 的修補丟回 codex — 主線自己 Edit 修

## Spectra Apply Phase Dispatch（決策層）

> **先判 residency**（§ Orchestration Residency）：符合 Codex-primary 進入條件 → change 粒度單次 dispatch + notification-only，**不要**逐 phase 派工；以下限 **Claude-primary** 場景。

執行 `spectra-apply` 時，phase 粒度派 codex：

1. Read tasks.md，按 `## N.` 切分 phase
2. **每個 phase 三類分類**（依序判定，命中即停）：
   - **A. Design Review phase**：標題含 "Design Review" 或內容含 `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot`
     → **主線 Claude Opus 4.8 xhigh 自己做，永不派 codex**
   - **B. UI view phase**：phase 內任一 task 描述/路徑指涉 view 層檔案——`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且該 phase 沒有摻入非 view 的 frontend / backend 工作**（store / hook / API client / type / util / migration / API server）
     → **主線 Claude Opus 4.8 xhigh 自己做，永不派 codex**
   - **C. 其他 phase**：上述兩類以外（schema、migration、API server、CLI、純 backend、frontend 但非 view 的 store / hook / API client / type / util、unit test、docs）
     → **派 background codex GPT-5.5 high 做完整 phase**
3. **混雜 phase fallback**（混雜 view 與非 view 工作）：**已開工**（任一 task `[x]` 或 git history 顯示已改）→ 主線整個 phase 自己做（不重切，不派 codex）。**未開工** → **STOP**，請使用者跑 `/spectra-ingest <change>` 把 UI view tasks 切成獨立 phase；**禁止**主線自行修改 tasks.md phase 結構（屬 ingest 範圍）

C 類派工細節（prompt、marker、watch、drift 檢查、收尾驗證）見 reference § Spectra Apply Phase Dispatch（具體做法）。

## WebSearch Handoff（決策層）

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走 reference 檔的「Codex 派工的標準流程」，參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`
3. prompt 固定含：問題 + 期望輸出格式

**例外**（可直接處理）：本機檔案查詢（Read / Grep）、使用者明確要求「直接用 WebSearch」、Codex 已是當前 runtime、`WebFetch` 抓單一已知 URL（抓取不是搜尋）。

## 配額邊界（決策層）

Codex 配額兩層：primary = 5h rolling window（burst 瓶頸）、secondary = 週 window（實測 headroom 充足，非瓶頸）。

- 泛用 dispatcher 內建 quota check：primary used_percent > 85 → exit 4 不派（`--no-quota-check` 強派）
- 重 fan-out（單回合 ≥5 個 dispatch）把派工分散到 2-3 個 5h window，不要塞同一個 window
- 收到 exit 4：非急件延後到下一個 window；急件 `AskUserQuestion` 讓 user 拍板

## 為什麼集中寫在這

- 散落各 SKILL.md 會漂移；集中方便加新 rule
- consumer 投影帶 `🔒 LOCKED` banner，**禁止**本地 override

## 必禁事項

### Dispatch 入口

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 verify channel evidence collection 階段問 user 手動取 session cookie / 走 Google OAuth + DevTools 複製貼回（per [[manual-review]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]） | agent **MUST** 第一動作 = scaffold `_dev-login` route via clade cookbook，自己 mint session |
| **NEVER** 在 Claude Code session 直接呼叫 `WebSearch` 工具 | 改派背景 codex GPT-5.5 medium |
| **NEVER** 印「請開啟 Codex CLI」「Stop here」「請貼 prompt」這類純文字 handoff 訊息要使用者手動切 | 主線必須自己派背景 codex |
| **NEVER** 嘗試 `codex:rescue` / `codex:setup` plugin 路線 | 已驗證無法使用、已全清（含 `/assign`） |
| **NEVER** 在 Spectra propose 階段問 A/B（已預設 codex draft） | 除非使用者**明確**要求純 Claude propose |
| **NEVER** 在 spectra-apply Section 7（Design Review）派 codex | 主線自己做 |
| **NEVER** 在 spectra-apply 把 UI view phase（component / page / view / layout / styling）派給 codex | 主線自己做。Frontend 但非 view 的（store / hook / API client / type / util）仍走 codex |
| **NEVER** 派 codex 跑 UI view phase 時省略 prompt 內「禁止改 view 層檔案」硬指令 | 缺這條 codex 容易順手改到 .vue / .tsx |
| **NEVER** 在 spectra-apply 偵測到「混雜 phase（UI view + 非 view 摻在同 phase）且未開工」時自行修改 tasks.md 拆 phase | 該交給 `/spectra-ingest` |
| **NEVER** 在 spectra-apply 派 codex 用 medium effort | 一律 high |
| **NEVER** task 粒度派 codex（過細 round-trip） | 粒度依 residency：**Codex-primary 走 change 粒度**、**Claude-primary 走 phase 粒度**（§ Orchestration Residency） |
| **NEVER** 把符合 Codex-primary 進入條件（純非-view + tasks.md 定稿，或機械 sweep）的 change 落到逐 phase live-watch | 應 change 粒度單次 dispatch + notification-only；把關移到收尾 cross-check + `/commit` 0-A |
| **NEVER** 派 codex 跑 spectra-apply phase 而 prompt 內漏 Commit Authorization 段（一 phase 一 commit / `🧹 chore: wt <change>-phase-<N>` format / hook 必跑禁 `--no-verify` / commit 前自驗 view-layer + scope） | 缺這段 codex 會混 commit、撞 commitlint hook |
| **NEVER** 派 Codex 寫 code（spectra-propose draft / spectra-apply phase）而 prompt 漏掉 Plan-first 硬指令 | 沒 plan 主線只能從 diff 反推；codex 寫完 plan 必須立刻續跑 |
| **NEVER** 從主線用 `Agent` tool with `subagent_type: screenshot-review` 派 verify mode 工作 | sonnet wrapper 會繞過 Step 0 自做工作（pitfall 同 Routing Table）；**MUST** 主線直派 codex GPT-5.5 low via Bash；wrapper 僅留 codex CLI 不可用 fallback，**禁止**作為預設入口 |
| **NEVER** 派 general-purpose / worktree Claude subagent 自跑 playwright / agent-browser 收 verify:ui evidence 來取代 Step 8a codex dispatcher | verify:ui evidence 的**唯一**入口是 `codex-dispatch-screenshot-verify.mjs`；Claude fallback 僅限機械故障且 MUST 在對應 item 留 `UNCERTAIN(dispatcher-error)` 痕跡。2026-06-11 audit 實證：dispatcher 修復後 147 條 (verified-ui:) annotation 0 次走 codex、92 個 session 全走此 bypass 形狀 |
| **NEVER** 對 mechanical 收集 / 掃描 / 驗證型工作開 Claude subagent fan-out | 預設走泛用 dispatcher + `fanout-collect` template（例外：claude.ai-connected MCP 依賴、判讀型分析、user 明確要求 Claude） |

### Watch 行為

| NEVER | 說明 |
| --- | --- |
| **NEVER** 沉默等使用者問進度 | 收到 `<task-notification> status=completed` 必須立刻自己讀檔回報 |
| **NEVER** 派出 codex 後不啟動 Codex Watch Protocol | 「乾等盲區」是已驗證根因 |
| **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup | 必須立刻 `AskUserQuestion` 介入 |
| **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent） | 監看純粹只看進度 |
| **NEVER** 派 codex propose 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze） | 主線 = quality gate |
| **NEVER** 收到 codex 完工通知後跳過 view-layer drift 檢查（`git diff --name-only` 過濾 view 路徑） | 主要的回收 quality gate |
| **NEVER** 對主線直接 Bash 派的 codex 啟動每 3 分鐘強制 poll | 直接派預設 **notification-only**；FS poll **只**用於 subagent 中介 dispatch（reference § 跨 sandbox 可見度約束） |

### Commit 0-A

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 commit 0-A 跳過 0-A.0 `simplify` skill | reuse / 精簡盲點入口；序跑在 codex 之前 |
| **NEVER** 在 commit 0-A 把 `simplify` 跟 codex 並行 | simplify 修完才是 codex 該看的版本 |
| **NEVER** 在 commit 0-A 啟用已棄用的 `code-review` agent（Opus subagent） | 與 codex review 重疊且同為 Anthropic 模型盲點 |
| **NEVER** 改用其他模型或顛倒 codex 兩輪 effort（codex 必為 `gpt-5.5`；0-A.1 必為 `high`、0-A.2 必為 `xhigh`） | — |
| **NEVER** 在 commit 0-A 跑第 3 輪 codex | 2 輪內處理不完先 split；0-A.2 由 0-A.1 Critical / Major 條件觸發，不可無條件升級也不可跳過 |

### Runtime gate

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 Codex 端執行 `$spectra-apply` 而 prompt body 沒有 `[DELEGATED-BY-CLAUDE-CODE]` marker | **MUST** 立即 STOP 且不執行任何 `spectra` 命令（reference § Codex `$spectra-apply` Runtime Gate） |
| **NEVER** 主線派 Codex 跑 spectra apply phase 而 prompt 第一行不是 `[DELEGATED-BY-CLAUDE-CODE]` marker | 會被 Codex 端 Runtime Gate 擋掉、整個 phase dispatch 白做 |
| **NEVER** spectra-apply 開工跳過 residency-classify record | archive-gate Check 8 會在 archive 時 exit 2 擋下（補救成本遠高於開工時 30 秒 record） |

另：**NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table。
