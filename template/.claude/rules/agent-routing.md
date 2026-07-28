<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Routing

**核心命題**：當工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。本規則優先於個別 skill 內嵌的工具呼叫指示。

> 本檔是 routing 主規則（每 session 必載入）。派工模板、Watch Protocol、Plan-first / Git baseline、Runtime Gate 詳述見 [`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md)（下稱 reference）。

## Routing Table

> **Codex 派工是 (model, effort) 二維**，不是只選 effort。三檔共用同一個 7 天配額池，選檔位看下列六維，**NEVER** 只看「這個工作重不重要」或「迴圈長不長」：
>
> 規格清晰度／搜尋空間與分支度／語意跨度（跨檔・矛盾來源）／錯誤成本不對稱性／可驗證性／mutation blast radius
>
> | 檔位 | 何時用 |
> | --- | --- |
> | `--model terra` | **預設檔**。一般工具協調、read-heavy synthesis、有限探索、小型可驗證修改 |
> | `--model sol` | 命中任一即用，**即使迴圈很短**：高模糊度／高漏報成本／跨域衝突裁決／廣泛 mutation／結果本身就是最終品質或安全 gate |
> | `--model luna` | 規格完全明確 **且** 來源已正規化 **且** 低風險 **且** 輸出可機械驗證 **且** 錯誤能被後續獨立 gate 接住——**五條全中**才用 |
>
> **NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。只有下游具備**獨立且夠強的語意 gate** 才可降檔。
>
> **跑分**（官方值，經 Codex Sol 覆核）：Terminal-Bench 2.1 Sol 88.8 / Terra 87.4 / Luna 84.7；SWE-bench Pro Sol 64.6 / Terra 63.4 / Luna 62.7。**兩者都是 agentic benchmark**（SWE-bench Pro 用 SWE-Agent scaffold，不是單次產碼），所以 aggregate 差距（Sol–Terra 僅 1.4pp）**不足以**單獨推導 routing boundary——要看 class-conditional 差距：SEC-Bench Pro Sol 71.2 vs Terra 57.7、ExploitBench 73.5 vs 52.9，安全類差距是通用類的 10 倍以上。
>
> ⚠️ **配額權重 UNKNOWN**：5:2.5:1 已確認是 API 價格與 purchased-credit rate card，但**訂閱內含配額**的 per-model debit multiplier 官方未公布，且官方列的每 5h 訊息估算範圍（Sol 75–450 / Terra 100–550 / Luna 250–1400）不呈現乾淨反比。**降檔究竟省多少配額目前無法量化**——`NEVER` 把 5:2.5:1 當成已證實的配額比寫進任何計算。

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Web search**（即時資料 / 外部資訊查詢） | **Codex `--model terra --effort medium`** | 搜尋 + 整合，非長迴圈。 |
| **Code review（commit 0-A）** | **(1) `simplify` + (2) `codex exec` review high（GPT-5.6-sol，經 codex-review-safe.sh），(3) 0-A.1 出 Critical / Major 時條件升 xhigh** | 跨模型互補盲點。詳見 `.claude/skills/commit/SKILL.md` Step 0-A。 |
| **Spectra `propose` 階段（draft）** | **使用者選單三選一**：A Codex GPT-5.6-sol max draft（預設/推薦）／ B 三模型交叉：Claude Fable 5 xhigh draft ＋ Codex GPT-5.6-sol max review／ C 純 Claude | 預設跳三選一選單；使用者明確指定路徑時跳過。詳見 `spectra-propose` Step 0。 |
| **Spectra `propose` cross-check / final check** | **主線 Claude Fable 5 xhigh** | 主線 = quality gate（A 的 cross-check、B 的 final check 都由主線跑），不只是 dispatcher。 |
| **Spectra `apply`（非 Design Review、非 UI view phase，phase 粒度）** | **Codex GPT-5.6-sol high** | medium 漏 schema drift 風險高；phase 粒度避免 round-trip。 |
| **Spectra `apply` UI view phase（component / page / view / layout / styling）+ Section 7（Design Review）** | **主線 Claude Opus 5 xhigh，永不派 codex** | 視覺 / 互動 / a11y 與 Design skill 緊耦合，Codex tooling 弱。非 view 的 frontend 不在此範圍，仍走 codex（範圍同 § Phase Dispatch C 類）。 |
| **`screenshot-review` verify mode**（`[verify:ui]` channel / archive 前視覺 QA） | **主線 Claude 直派 Codex GPT-5.6-sol low**（Bash 走 reference § Codex 派工的標準流程；**禁止** `Agent` tool with `subagent_type: screenshot-review`） | sonnet wrapper 會繞過 Step 0 自做工作（[[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。wrapper **僅**在 codex CLI 不可用時作 fallback，**禁止**當預設入口。詳見 reference § screenshot-review Verify Mode Dispatch。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段） | **主線自己 scaffold `_dev-login` route + curl mint session**（**禁止**要 user 手動取 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing） | 詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |
| **Mechanical fan-out**（收集 / 掃描 / 跑指令驗證型 subagent 工作：grep 掃描、收 evidence、驗證矩陣、fleet 多 repo 盤點） | **Codex `--model terra --effort medium` via 泛用 dispatcher** | Claude subagent fan-out 實測佔 CC 等價成本 17-21%/日，codex 同工作 ~1/10 成本且 fidelity 100%（PoC 實證）。走泛用 dispatcher + `fanout-collect` template（見 reference § 泛用 Dispatcher）。例外留 Claude：需要 claude.ai-connected MCP（Notion 等）、判讀 / 治理型分析（如 /oops Mode D 判讀段）、user 明確要求。 |
| **Read-heavy 長文件 / fleet 掃描**（上游 release notes 解析、跨 consumer reality matrix、pitfall 全量掃描、大 rule 改版前 baseline 重讀） | **Codex `--model terra --effort medium` via 泛用 dispatcher** | read-heavy + structured output 是 codex 強項（中文 brief fidelity 100% 已驗證）。摘要僅作輸入，規約措辭與拍板必回主線。 |
| **Debug evidence 段**（log 完整 capture / repro script 撰寫執行 / 既定 hypothesis 的驗證迴圈） | **Codex `--model sol --effort high` via 泛用 dispatcher** | debug 是最大消耗桶；evidence / repro / verify 是機械段，root cause 推斷與修法設計留主線。repro 必在 throwaway worktree（template 內建 guard）。 |
| **commit 0-C fix-verify loop**（pnpm check / test 修到全綠） | **Codex `--model sol --effort high` via 泛用 dispatcher** | 機械修 lint / type / test 與 dep-upgrade 已驗證模式同構；主線同回合續跑 0-A / 0-B。詳見 commit SKILL Step 0-C。 |
| **spectra-apply Step 8a self-collect (a)(b)**（dev-login allow-list 小 mod + service_role DB query 證 data shape） | **Codex `--model terra --effort medium` via 泛用 dispatcher** | PoC 已實證 codex 能跑完整 evidence chain；annotation 寫回 tasks.md 維持主線。詳見 spectra-apply SKILL Step 8a。 |
| **Security review**（`/security-review` skill / commit 前安全檢查） | **最終 gate：Codex `--model sol --effort medium`**。候選 finding 的 pre-triage 可先跑 `--model terra`，但**收斂判定 MUST 回 Sol** | **NEVER** 因為「零互動 / structured diff → structured findings」就把安全 gate 當 pattern matching 降檔——漏報成本不對稱，且 class-conditional 差距遠大於通用 benchmark：SEC-Bench Pro Sol 71.2 vs Terra 57.7、ExploitBench 73.5 vs 52.9（通用類 Sol–Terra 只差 1.4pp）。30 天實測佔 72% Claude session 數但僅 15% events — session 啟動成本是主要浪費。 |
| **Exploration / research pre-scan**（「依賴什麼」「進度如何」「還有什麼要做」「N 張 change 狀態」等 read-heavy 探索） | **Codex `--model terra --effort medium` via 泛用 dispatcher**，主線消費 structured summary | 「依賴什麼」要探索未知路徑、跨檔追蹤、裁決哪些 evidence 相關——是有限探索，不是 extraction，所以是 Terra 不是 Luna。主線拿 summary 做判斷 / 規劃，不自己逐檔 Read。30 天實測佔 11.5% events。 |
| **Handoff scan 段**（`/handoff` Mode B 的 scan：讀 HANDOFF.md + git log + openspec + tasks + git status 產出 outstanding 清單） | **Codex `--model terra --effort medium` via 泛用 dispatcher**，主線消費 scan report 做決策 | 四個來源（HANDOFF / git log / tasks / git status）可能互相矛盾，判斷某條 task 是否已 commit、部分完成或被工作樹取代是**狀態 reconciliation**，不是格式化——這是它不能降 Luna 的原因。主線只看 report、做 routing / 推薦。30 天實測 29 sessions、4.7% events。 |
| **Task-planning pre-scan**（「我需要做什麼」「接下來做什麼」「處理 N 張 change」的規劃 session 前置 scan） | **Codex `--model terra --effort medium` via 泛用 dispatcher**，主線消費 structured report | scan openspec/changes/ + HANDOFF.md + git status + tasks/ 產出 per-change status matrix。矩陣格式固定**不代表**語意判定是機械式的——identity matching、partial completion、衝突證據裁決都在裡面，故 Terra 不 Luna。主線拿 matrix 做排序 / 決策。 |
| **Bug-fix evidence 段**（error log capture / stack trace 解析 / repro script 撰寫執行 / hypothesis 驗證迴圈） | **Codex `--model sol --effort high` via 泛用 dispatcher**（強化：非 Debug evidence 段，而是整個 bug-fix session 的 investigation 段） | 30 天實測 19 個 bug-fix session 全由 Claude 跑（既有 Debug evidence rule 未落實）。investigation / evidence / repro 是機械段；root cause 推斷 + 修法設計留主線。**MUST** 在 bug-fix session 開工時先判斷：可分離的 evidence 段派 Codex，不可分離的留主線但 MUST 在 session 結尾回報未派 Codex 的理由。 |
| **clade publish/propagate pre-scan**（publish 前 dirty file 分組判斷：讀 `git status` + `git diff` 各 file 內容 + 辨識 logical group） | **Codex `--model terra --effort medium` via 泛用 dispatcher**，主線消費分組建議後 selective commit | commit grouping 要推斷修改意圖、耦合、依賴順序與可獨立回退性——讀取命令少不等於決策機械化。publish SOP 中 `vp check → git commit → publish.mjs → push --tags → propagate.mjs` 是固定序列，但 pre-scan「dirty file 分幾組、每組 commit message 怎麼寫」的 reading 段可以 Codex。 |

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

1. **MUST** 預設跳三選一 dispatch 選單（A Codex draft + 主線 cross-check／B 三模型交叉：Fable draft + Codex review + 主線 final check／C 純 Claude）。使用者**明確**指定路徑（「純 Claude propose」「不要派 codex」「用 Fable」「用 codex」等）時跳過選單直接走。詳見 `spectra-propose` Step 0
2. **MUST** 主線是 quality gate — A 的 cross-check 與 B 的 final check 都由主線 Fable 5 xhigh 跑，不要把所有事推給 draft runtime（codex）後直接結束
3. **NEVER** 把 cross-check / final check 的修補丟回 codex — 主線自己 Edit 修

## Spectra Apply Phase Dispatch（決策層）

> **先判 residency**（§ Orchestration Residency）：符合 Codex-primary 進入條件 → change 粒度單次 dispatch + notification-only，**不要**逐 phase 派工；以下限 **Claude-primary** 場景。

執行 `spectra-apply` 時，phase 粒度派 codex：

1. Read tasks.md，按 `## N.` 切分 phase
2. **每個 phase 三類分類**（依序判定，命中即停）：
   - **A. Design Review phase**：標題含 "Design Review" 或內容含 `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot`
     → **主線 Claude Opus 5 xhigh 自己做，永不派 codex**
   - **B. UI view phase**：phase 內任一 task 描述/路徑指涉 view 層檔案——`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且該 phase 沒有摻入非 view 的 frontend / backend 工作**（store / hook / API client / type / util / migration / API server）
     → **主線 Claude Opus 5 xhigh 自己做，永不派 codex**
   - **C. 其他 phase**：上述兩類以外（schema、migration、API server、CLI、純 backend、frontend 但非 view 的 store / hook / API client / type / util、unit test、docs）
     → **派 background codex GPT-5.6-sol high 做完整 phase**
3. **混雜 phase fallback**（混雜 view 與非 view 工作）：**已開工**（任一 task `[x]` 或 git history 顯示已改）→ 主線整個 phase 自己做（不重切，不派 codex）。**未開工** → **STOP**，請使用者跑 `/spectra-ingest <change>` 把 UI view tasks 切成獨立 phase；**禁止**主線自行修改 tasks.md phase 結構（屬 ingest 範圍）

C 類派工細節（prompt、marker、watch、drift 檢查、收尾驗證）見 reference § Spectra Apply Phase Dispatch（具體做法）。

## WebSearch Handoff（決策層）

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走 reference 檔的「Codex 派工的標準流程」，參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`
3. prompt 固定含：問題 + 期望輸出格式

**例外清單是窮舉的**（可直接處理）：本機檔案查詢（Read / Grep）、使用者明確要求「直接用 WebSearch」、Codex 已是當前 runtime、`WebFetch` 抓單一已知 URL（抓取不是搜尋）。**不在這四條上的一律 handoff** —— 查詢多簡單、使用者多趕時間、codex 啟動開銷多不成比例，都不構成第五條例外。

**NEVER 拿本規約的 rationale 推翻本規約的字面。**「成本/品質最佳化」是這條規則存在的理由，不是可以就地自我豁免的判準 —— 照那個推法，任何一次 handoff 都論證得成「這次不划算」。下表開脫句逐字取自 2026-07-26 micro-test（`vendor/snippets/rule-authoring/scenarios/websearch-direct-call.md`，5 reps 有 2 次照下面的路走）：

| 實測開脫 | 為什麼不成立 |
| --- | --- |
| 「這是一句話的事實查詢，Codex dispatch 的啟動開銷遠超 WebSearch 的 5 秒」 | 查詢的大小不在例外清單上。「夠不夠 trivial」由誰認定，正是這條規則要消除的裁量空間 |
| 「routing rule 的精神是成本/品質最佳化，不是在 trivial lookup 上製造延遲」 | 用精神推翻字面 = 自行新增第五條例外。要動例外清單就來改本檔，不要在單次決策裡就地豁免 |
| 「01:52 要睡的人不該等 codex spin-up」 | 時間壓力不是例外。使用者要直接用 WebSearch 可以明說 —— 那是第二條例外，沒明說就不算 |

## 配額邊界（決策層）

Codex 配額**只有一層**：primary = **7 天 rolling window**（`window_minutes: 10080`），secondary 實測為 `null`（不存在，**不要**指望第二層緩衝）。

> 本節數值於 2026-07-28 對 `~/.codex/sessions/**/rollout-*.jsonl` 的 `rate_limits` payload 實測校正。先前寫「primary = 5h rolling window」是錯的，連帶使「分散到多個 window」與「reset ≤30 分鐘則延後」兩條策略從未可能生效。改本節數值前 MUST 重新實測，不要憑印象改回。

- 泛用 dispatcher 內建 quota check：primary used_percent > 85 → exit 4 不派（`--no-quota-check` 強派）
- **一週只有一個池**——`NEVER` 規劃「把派工分散到不同 window」，7 天內沒有第二個 window 可分散。要降配額壓力只能降 model 檔位（§ Routing Table 的 model 欄）或減少 dispatch 次數
- quota check 讀的是**最近一次 codex session 的最後記錄值**，不是即時查詢。session 檔數天沒更新時，`used_percent` 是舊快照——判讀前先看 `resets_at` 是否已過期
- 收到 exit 4：**先讀 `resets_at`**（`date -d @<ts>`）。reset 距今通常是**天**級，不是分鐘級
  - 工作可延後到 reset 後 → 延後，並明確告知 user 確切 reset 時間
  - 不可延後 → 走 § 配額耗盡時的 fallback 紀律的降級鏈，**不要**直接讓 Opus 主線接走

### 最小 dispatch 門檻（避免瑣碎 override）

codex-primary verdict 但 ≤2 個 file 的瑣碎 fix（typo / 單行 bug / config tweak）→ Claude 直接做，**不需要**走 residency 判定 + dispatch 流程。residency-classify 的 verdict 仍照跑（歸檔 Check 8 需要 record），但 executor=claude 的 reason 填 `trivial-threshold`，不算 override 違規。

**判定標準**：`git diff --stat` 影響 ≤2 files **且** 預估改動 ≤20 行 **且** 不涉及 migration / auth / RLS / permission 路徑。超過任一門檻 → 照原 routing 走 Codex。

### 配額耗盡時的 fallback 紀律

配額耗盡（exit 1 / exit 4）**NEVER** 直接跳到 Opus 主線接走——那是拿最貴的檔位接最便宜的活。**MUST** 依序試降級鏈，命中即停：

```
Sol → Terra → Luna → Claude Sonnet subagent → Claude Haiku subagent → Opus 主線
      └─ 同一個 Codex 池，但權重較低 ─┘   └─ 換池，吃 Claude 額度 ─┘
```

1. **先降 Codex 檔位**：`--model terra` 重試，再不行 `--model luna`。三檔共用同一個 7 天池但按權重扣，低檔位在高檔位耗盡後**通常仍可派**
2. **再換池**：Codex 三檔全滿才動 Claude subagent（`model` 顯式帶 `sonnet` / `haiku`，per § Subagent 回報契約第 4 條）
3. **最後才是主線**：上述全不可行時 Opus 主線接走，且 record reason 含 `quota-exhausted` + `date -d @<resets_at>` 換算出的確切 reset 時間
4. Claude 接走時 session 結尾 **MUST** 回報「本 session 因配額耗盡由 Claude 執行 N 個 codex-primary change，reset 時間 `<YYYY-MM-DD HH:MM>`」

**NEVER** 把「工作性質適合 Sol」當作跳過降級鏈的理由——配額耗盡時的選擇不是「Sol vs Terra」，是「Terra vs 完全做不了」。品質顧慮寫進 report 交 user 判讀，不是拒絕降級的依據。

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——Agent tool 開的 Claude subagent、泛用 dispatcher 派的 codex、[[subagent-dev]] 的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約。實測反例:dispatch prompt 42k chars、99% 是貼上的歷史。
4. **Model 顯式指定**：Agent tool dispatch MUST 顯式帶 `model`——省略 = 靜默繼承主線（通常最貴檔）。選檔原則「**turn count beats token price**」：多步驟工作用最低檔常花 2-3× turns 反而更貴；brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔。

## 為什麼集中寫在這

- 散落各 SKILL.md 會漂移；集中方便加新 rule
- consumer 投影帶 `🔒 LOCKED` banner，**禁止**本地 override

## 必禁事項

> **入表判準**：本節只收「上面正向段沒有的**可觀察 predicate**」——prompt 必含的字串、具名 script、數值門檻、已驗證的失敗模式。凡是把 Routing Table / § Orchestration Residency / § Phase Dispatch 已經講過的事再吼一次的，**不進本節**（複述會隨正向段改動靜默過期，且稀釋真正帶新資訊的條目）。

### Dispatch 入口

| NEVER | 說明 |
| --- | --- |
| **NEVER** 印「請開啟 Codex CLI」「Stop here」「請貼 prompt」這類純文字 handoff 訊息要使用者手動切 | 主線必須自己派背景 codex |
| **NEVER** 嘗試 `codex:rescue` / `codex:setup` plugin 路線 | 已驗證無法使用、已全清（含 `/assign`） |
| **NEVER** 派 codex 跑 UI view phase 時省略 prompt 內「禁止改 view 層檔案」硬指令 | 缺這條 codex 容易順手改到 .vue / .tsx |
| **NEVER** 派 codex 跑 spectra-apply phase 而 prompt 內漏 Commit Authorization 段（一 phase 一 commit / `🧹 chore: wt <change>-phase-<N>` format / hook 必跑禁 `--no-verify` / commit 前自驗 view-layer + scope） | 缺這段 codex 會混 commit、撞 commitlint hook |
| **NEVER** 派 Codex 寫 code（spectra-propose draft / spectra-apply phase）而 prompt 漏掉 Plan-first 硬指令 | 沒 plan 主線只能從 diff 反推；codex 寫完 plan 必須立刻續跑 |
| **NEVER** 派 general-purpose / worktree Claude subagent 自跑 playwright / agent-browser 收 verify:ui evidence 來取代 Step 8a codex dispatcher | verify:ui evidence 的**唯一**入口是 `codex-dispatch-screenshot-verify.mjs`；Claude fallback 僅限機械故障且 MUST 在對應 item 留 `UNCERTAIN(dispatcher-error)` 痕跡。2026-06-11 audit 實證：dispatcher 修復後 147 條 (verified-ui:) annotation 0 次走 codex、92 個 session 全走此 bypass 形狀 |
| **NEVER** 讓任何 Claude subagent（Agent tool 開出的子代理）在其 sandbox 內呼叫 codex CLI | Codex **一律**由主線直接 Bash `run_in_background` 派工（含泛用 dispatcher）。subagent 中介有兩個已驗證失敗模式：(1) false positive panic — 主線 `ps aux` 看不到 cross-sandbox process 誤判死亡；(2) false negative silent miss — codex 完成但 subagent 未 surface 通知，主線乾等 5-15 分鐘。直接 Bash：通知可靠（同 sandbox）、context 消耗零、失敗診斷同 sandbox。 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（openspec / HANDOFF / git log / docs）超過 3 個 source file | 先派 Codex medium pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |

### Watch 行為

| NEVER | 說明 |
| --- | --- |
| **NEVER** 沉默等使用者問進度 | 收到 `<task-notification> status=completed` 必須立刻自己讀檔回報 |
| **NEVER** 派出 codex 後不啟動 Codex Watch Protocol | 「乾等盲區」是已驗證根因 |
| **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup | 必須立刻 `AskUserQuestion` 介入 |
| **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent） | 監看純粹只看進度 |
| **NEVER** 派 codex propose 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze） | 主線 = quality gate |
| **NEVER** 收到 codex 完工通知後跳過 view-layer drift 檢查（`git diff --name-only` 過濾 view 路徑） | 主要的回收 quality gate |
| **NEVER** 對主線直接 Bash 派的 codex 啟動每 3 分鐘強制 poll | 直接派預設 **notification-only** + 單一 ~1500s 安全網 fallback。subagent 中介 dispatch 已全面禁止（§ Dispatch 入口） |

### Commit 0-A

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 commit 0-A 把 `simplify` 跟 codex 並行 | simplify 修完才是 codex 該看的版本 |
| **NEVER** 在 commit 0-A 啟用已棄用的 `code-review` agent（Opus subagent） | 與 codex review 重疊且同為 Anthropic 模型盲點 |
| **NEVER** 在 commit 0-A 跑第 3 輪 codex | 2 輪內處理不完先 split；0-A.2 由 0-A.1 Critical / Major 條件觸發，不可無條件升級也不可跳過 |

### Runtime gate

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 Codex 端執行 `$spectra-apply` 而 prompt body 沒有 `[DELEGATED-BY-CLAUDE-CODE]` marker | **MUST** 立即 STOP 且不執行任何 `spectra` 命令（reference § Codex `$spectra-apply` Runtime Gate） |
| **NEVER** 主線派 Codex 跑 spectra apply phase 而 prompt 第一行不是 `[DELEGATED-BY-CLAUDE-CODE]` marker | 會被 Codex 端 Runtime Gate 擋掉、整個 phase dispatch 白做 |

另：**NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table。
