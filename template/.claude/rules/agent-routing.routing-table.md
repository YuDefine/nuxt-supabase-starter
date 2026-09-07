---
description: Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準留在 [[agent-routing]] § Routing Table，本檔只承載查表用的列。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] § Routing Table 的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.routing-table.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Agent Routing — Routing Table（對照資料層）

**Pi 派工的 model 維合法值**：`astra`、`sol`、`gemini`、`luna`、`luna-cursor`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。同一 tier 的 `-cursor` 變體是**換配額池、不換檔位**，只在配額降級鏈上出現。External-web 第一手的 bare `gemini` 解析到 Gemini CLI provider；**NEVER** 改傳 Cursor catalog 的完整 `gemini-3.8-flash` slug 冒充同一跳。

> 本檔是 [[agent-routing]] § Routing Table 的下推對照表。**判準留在該節**（合法 model 值、
> `*-cursor` 的路徑可見性、workspace mutation 的 admission、`--route`／`--tier-basis`／
> `--table-row` 的記帳義務、以及每一條硬禁令）；本檔只回答「這類工作查出來是哪個 model、哪個
> effort、為什麼」。取證與跑分在 [[agent-routing.routing-table-rationale]]。

## effort 檔位對照

GPT worker 的 transport 依 [[agent-routing]] § Session transport boundary：Codex 主線 → 任一 GPT 可用原生 agent；每個非 Codex 主線的 GPT 外派一律走 Pi。`sol`／`gpt-5.6-sol` 解析到真正的 GPT-5.6 Sol，`astra`／`gpt-6-astra` 解析到 GPT-6 Astra；兩者不互為 alias。未命中具名列的一般外派**由派工者顯式選** Luna；dispatcher 自己**不預設模型**，未帶 `--model` 一律 fail closed（`test/pi-dispatch.test.ts` 的 `unspecified Pi model fails closed instead of defaulting`）。已命中具名列時依該列。

| 檔位 | 工作角色 |
| --- | --- |
| `--model luna --effort medium` | 一般非 UI 實作、repro／evidence、依既定規格完成修改與驗證 |
| `--model sol --effort high` | 複雜非 UI 實作、schema／API／跨檔 phase，以及實作模型的修復升級 |
| `--model astra --effort medium` | 詳細計畫、根因／架構決策、獨立 code／security review；不承接實作或修復迴圈 |
| `--model astra --effort low` | 已屬 planning／decision／review 的有界初判；最終 gate 的 effort 仍依具名列 |
| `--model gemini`（具名列或機械改寫） | 具名列照列派；其餘須規格明確、來源正規化、低風險、可機械驗證、另有語意 gate。業務失敗的實作升級走 Sol；未解決的決策可送 Astra，修改仍交回實作者 |
| Claude Opus | 每一個 UI view 實作與 Design Review；由既有 Claude 工作流執行，GPT／Pi 不承接 UI |

**Astra 用途白名單**：`planning`、`decision`、`review`。具名列由共用 policy 推導；manual Astra 須帶 `--task-role` 與 `--workspace-access readonly`，未分類、實作、evidence、工具協調與一般 mutation 一律拒絕。`spectra-artifact-draft` 是既有的計畫文件寫入列，範圍限其 artifact contract；一般 detailed-planning 回傳計畫，由實作者落 carrier。Astra 的判斷結果不構成接手修改程式碼的授權。

配額不足依 dispatcher 的角色相容終端處置；Sol 不改派 Astra 做實作，GPT 不改走 cx 或 Claude Code；Codex 主線的 GPT 原生 agent 分支依 transport 表。訂閱配額倍率未知，不以 API 單價承諾節省比例。

## 互動 session transport

`canonical-clade-publish` 與 `session-continuation` 使用 Claude Code `claude-opus-5`、`medium`，machine policy 在 `pi-routing-policy.ts` 的 `SESSION_TRANSPORT_POLICY`。帳號選擇只選訂閱來源；模型與 effort 由此列給定並傳入 argv。Pi worker 仍依下表選擇。

## 工作類別對照

列名是每列開頭 〔`如此標示`〕 的 slug，`--tier-basis table-row` 時逐字填進 `--table-row`。

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| 〔`non-ui-implementation`〕 **一般非 UI 實作** | **Pi `--model luna --effort medium`** | 一份 brief 包含修改、測試、修復與交付；已有 Gemini 機械列的工作沿用該列。 |
| 〔`non-ui-implementation-escalate`〕 **複雜非 UI 實作／修復升級** | **Pi `--model sol --effort high`** | 承接跨檔語意與一般實作者無法收斂的修復；仍需決策時只把決策題送 Astra。 |
| 〔`implementation-decision`〕 **實作中的根因／方案裁決** | **Pi `--model astra --effort medium`** | 唯讀分析已收集的證據，交付根因、修法限制與驗收條件，修改交回實作者。 |
| 〔`detailed-planning`〕 **詳細實作計畫** | **Pi `--model astra --effort medium`** | 唯讀產出可交付的計畫：範圍、介面、依賴、task→file 與驗收；由實作者落盤與執行。 |
| 〔`dep-upgrade-first-pass`〕 **dep-upgrade 首輪升版**（Outdated／Fleet） | **Pi `--model grok-xai --effort low`** | mutation；配額／provider 不可用 → bare `gemini` 同 effort（Gemini 3.8 Flash），再不可用就停止回報 blocker，不接 Sonnet。 |
| 〔`dep-upgrade-research`〕 **dep-upgrade 失敗後研究重試**（Outdated／Fleet） | **Pi `--model grok-xai --effort high`** | 與首輪共用 mutation fallback：Grok → Gemini → 停止；保留主線複驗與 research 失敗回報。 |
| 〔`web-search`〕 **External web retrieval**（`WebSearch`／`WebFetch`） | **Pi bare `gemini low` → linked `luna low` → matching receipt 才放行同種 built-in tool** | 兩支工具共用 machine row；查不到就回「查不到」。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`code-review`〕 **Code review（commit 0-A）** | **simplify → 合格獨立跨模型 reviewer → Critical／Major 條件觸發深度 review 與跨模型裁決** | 資格與證據見 commit `review-policy.md`；Pi 基準使用 GPT-6-astra medium，實際模型差異依主持者身分判定。 |
| 〔`spectra`〕 **Spectra `propose` / `apply` 各階段（draft / cross-check / phase 粒度 / UI view phase）** | 見 reference § Spectra Routing Table | spectra 專屬 routing 在 path-scoped reference（碰 `openspec/changes/**` 時載入）。**不變的契約**：UI view phase 與 Design Review 依主規則的**視覺品質資格與 bounded phase** 判定，change carrier 保持原 session；propose 的 cross-check / final check **一律主線跑**。 |
| 〔`spectra-phase-implementation`〕 **Spectra Apply Class C phase 語意實作** | **Pi `--model sol --effort high` via 泛用 dispatcher** | schema／migration／API／backend／非 view frontend phase 的預設 carrier；Plan-first、task→file、view guard、scope、one-phase-one-commit 與 L0–L2 gate 不因 carrier 統一而放寬。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`spectra-phase-prescan`〕 **Spectra Apply 已封閉 phase 的 read-only fact extraction** | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 只抽事實不做裁決，矛盾回 `needs_reconciliation`；範圍與 exit 4 分流見 reference § Spectra Routing Table。 |
| 〔`spectra-mechanical-substep`〕 **Spectra Apply pilot marker 指定的 deterministic mutation** | **Pi `--model gemini --effort low` via 泛用 dispatcher** | eligible 判準與 shadow candidate 分流見 reference § Spectra Routing Table。 |
| 〔`screenshot-review-verify`〕 **`screenshot-review` 全部模式**（`[verify:ui]` channel / archive 前視覺 QA / commit 0-B / ad-hoc 截圖） | **target-specific review/session carrier** | 2026-08-22 Charles 拍板收回外派，四個模式一律適用。收回理由與 pitfall 對照見 reference § Spectra Routing Table 與 [[review-gui-surface]] § 為什麼只准 Claude subagent。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`screenshot-match-analysis`〕 **截圖 vs item 要求的匹配判定**（`[verify:ui]` 收集完成後的 gate） | **Pi `--model astra --effort medium` via 泛用 dispatcher** | 收集與判定是兩個角色。留 astra 的理由是**樣本不足以轉**，不是 grok 守不住；取證與轉列條件見 reference § Spectra Routing Table。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段） | **主線自己 scaffold `_dev-login` route + curl mint session**（**禁止**要 user 手動取 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing） | 詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |
| 〔`mechanical-fanout`〕 **Mechanical fan-out**（收集 / 掃描 / 跑指令驗證：grep 掃描、收 evidence、驗證矩陣、fleet 多 repo 盤點）。**不限委派**：主線**準備自己跑** ≥3 條唯讀指令（`grep`／`git log`／`jq`／一次性解析腳本）彙整成事實表就已命中 | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 第 3 個高信心 readonly Bash 前建立 pending decision（結案見 reference § Routing threshold gate）。命令清單列得全 → `fanout-analyze`，列不全 → `fanout-collect`。例外留 Claude：需 claude.ai-connected MCP、判讀／治理型分析、user 明確要求。exit 4 → luna。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`copywriting-draft`〕 **行銷／產品對外文案的草稿與變體生成**（標題變體、商品描述、社群貼文、EDM、SEO meta、landing page 段落初稿）。**只收候選素材**：主線會整份重寫才走本列 | **Pi `--model gemini --effort low` via 泛用 dispatcher**（`gemini-3.8-flash`）。**exit 2／3／4 一律直接回本 task 主線自己寫** | 繁中語感、台灣慣用語與品牌 tone 的最終判定留主線。**本列只涵蓋行銷／產品對外文案**：規約措辭、commit message、技術文件、PR 描述、對外報告一律留主線（per § 派不派 不外派清單）。降檔救不回語感，所以不進配額鏈——成本論證見 rationale。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`notion-ops`〕 **Notion 讀寫**（`ntn api` 查詢／建頁／改狀態／comment；`/notion-ticket` outbound、`/notion-board` inbound、spectra-notion-coupling 狀態推進） | **Pi `--model gemini --effort high` via 泛用 dispatcher**。**exit 2／3／4 → `--model luna` 同 effort**（`--route fallback-chain --tier-basis quota-fallback --retry-of <label>`，**不帶** `--table-row`）。luna 再失敗 → 本 task 主線。luna 的 exit 4 payload 會寫 `next_tier: luna-cursor`——**本列忽略該格，直接回主線**（payload SoT 的具名例外） | ntn 是 CLI，gemini／luna 做得到；cursor 池 `$HOME` 是空 tmpfs，拿不到 `~/.config/notion/auth.json`。仍只靠 claude.ai MCP 才做得到的殘集不走本列、留主線。客戶看得到的 ticket 正文是**定稿措辭**：Pi 起草後主線 MUST 收斂重寫才寫入。Board scan／status patch／query 是事實表，不必重寫。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`read-heavy-scan`〕 **封閉來源的 fact extraction**（長文件 / fleet 掃描中的固定欄位抽取）。**不限委派**：主線準備自己讀 ≥5 個檔或任一 >500 行長文件時先觸發 gate；只有 source list 已封閉、欄位固定、每筆要求 location + raw value、且不需 identity/status/relevance 裁決才走本列 | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 第 5 個 distinct textual Read 或第一次 Read 501+ 行文字檔前建立 pending decision（結案見 reference § Routing threshold gate）。來源矛盾只准回 `needs-reconciliation`，主線改派 `exploration-prescan` grok-xai low。摘要只作輸入，規約措辭與拍板回主線。exit 4 → luna。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`debug-evidence`〕 **Debug evidence 段**（log 完整 capture / repro script 撰寫執行 / 既定 hypothesis 的驗證迴圈） | **Pi `--model luna --effort medium` via 泛用 dispatcher** | evidence / repro / verify 是機械段，root cause 推斷與修法設計留主線。repro 必在 throwaway worktree（template 內建 guard）。 |
| 〔`commit-0c-fix-verify`〕 **commit 0-C fix-verify loop**（pnpm check / test 修到全綠） | **Pi `--model grok-xai --effort high` via 泛用 dispatcher**（`xai/grok-4.6`）。同一 dispatch 最多 **2** 輪 check→fix（`--var max_iterations=2`）。本列是 workspace mutation；exit 4 **MUST** 照 capability-aware payload 跳過 `grok-cursor` 並進〔`commit-0c-fix-verify-escalate`〕Sol 升級列 | 機械修 lint / type / test。grok 無 class-conditional 取證，用次數上限接住；主線重跑 check **不信自報**。見 commit SKILL Step 0-C。 |
| 〔`commit-0c-fix-verify-escalate`〕 **commit 0-C grok 次數用盡後的 Sol 升級** | **Pi `--model sol --effort high` via 泛用 dispatcher** | 只在 grok 2 輪後仍紅、grok 報 pass 但主線重跑仍紅、或 grok 兩池都 exit 4 時進。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`security-review`〕 **Security review**（`/security-review` skill / commit 前安全檢查） | **最終 gate：Pi `--model astra --effort medium`**。候選 finding 的 pre-triage 可先跑 `--effort low`，但**收斂判定 MUST 使用 medium** | **本列不以任何佔比為依據**。 **本列另有硬禁令**，見 [[agent-routing]] § Routing 硬禁令。 |
| 〔`exploration-prescan`〕 **Exploration / reconciliation pre-scan**（「依賴什麼」「進度如何」「還有什麼要做」「N 張 change 狀態」或來源矛盾後對帳） | **Pi `--model grok-cursor --effort low` via 泛用 dispatcher**（`cursor/grok-4.6`）。exit 4 → Claude `sonnet`，主線消費 structured summary | 任一命中即走本列：未知路徑探索、跨檔 identity matching、partial completion／status 推斷、evidence relevance 判斷、git/history/state reconciliation、來源衝突裁決。固定輸出矩陣不會把這些語意工作變成 extraction，**所以不降 Luna**。檔位沿革見 rationale。主線拿 summary 做判斷，不自己逐檔 Read。 |
| 〔`handoff-scan`〕 **Handoff scan 段**（`/handoff` Mode B 的 scan：讀 HANDOFF.md + git log + openspec + tasks + git status 產出 outstanding 清單） | **Pi `--model grok-cursor --effort low` via 泛用 dispatcher**（`cursor/grok-4.6`）。exit 4 → Claude `sonnet`，主線消費 scan report 做決策 | 四個來源可能互相矛盾，判「已 commit / 部分完成 / 被工作樹取代」是**狀態 reconciliation** 不是格式化——**這是它不能降 Luna 的原因**。檔位沿革見 rationale。主線只看 report 做 routing。 |
| 〔`task-planning-prescan`〕 **Task-planning pre-scan**（「我需要做什麼」「接下來做什麼」「處理 N 張 change」的規劃 session 前置 scan） | **Pi `--model grok-cursor --effort low` via 泛用 dispatcher**（`cursor/grok-4.6`）。exit 4 → Claude `sonnet`，主線消費 structured report | 產出 per-change status matrix。矩陣格式固定**不代表**語意判定機械化——identity matching、partial completion、衝突裁決都在裡面，**故不降 Luna**。檔位沿革見 rationale。主線拿 matrix 做排序 / 決策。 |
| 〔`bugfix-evidence`〕 **Bug-fix evidence 段**（error log capture / stack trace 解析 / repro script 撰寫執行 / hypothesis 驗證迴圈） | **Pi `--model luna --effort medium` via 泛用 dispatcher**（強化：非 Debug evidence 段，而是整個 bug-fix session 的 investigation 段） | investigation / evidence / repro 是機械段；root cause 推斷與修法設計留主線。**MUST** 在 bug-fix session 開工時就判：evidence 與 repro 交 Pi 實作者；需要根因裁決時整理證據走 `implementation-decision`，判斷完成後回到實作鏈。 |
| 〔`publish-prescan`〕 **clade publish/propagate pre-scan**（publish 前 dirty file 分組判斷：讀 `git status` + `git diff` 各 file 內容 + 辨識 logical group） | **Pi `--model grok-cursor --effort low` via 泛用 dispatcher**（`cursor/grok-4.6`）。exit 4 → Claude `sonnet`，主線消費分組建議後 selective commit | commit grouping 要推斷修改意圖、耦合、依賴順序與可獨立回退性——**讀取命令少不等於決策機械化**；可派的只有 pre-scan 的 reading 段。檔位沿革見 rationale。 |
