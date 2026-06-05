<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Agent Routing

**核心命題**：不是所有工作都該由當前 agent / model 直接做。當某類工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。

此規則優先於個別 skill 內嵌的工具呼叫指示。

> 本檔是 routing 主規則（無 frontmatter，每個 session 必載入）。詳細的 Codex 派工模板、Codex / screenshot-review Watch Protocol、Plan-first / Git baseline declaration、`$spectra-apply` Runtime Gate 詳述拆到 path-scoped reference：[`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md)。

## Routing Table

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Web search**（網頁搜尋、即時資料、外部資訊查詢） | **Codex（GPT-5.5 medium）** | 搜尋型查詢適合中等思考預算 + Codex 的搜尋整合；不浪費 Claude Code 的 context 與 token。 |
| **Code review（commit 0-A）** | **(1) `simplify`（reuse / 精簡 / efficiency / altitude） + (2) `codex review --uncommitted` high（GPT-5.5），(3) 0-A.1 出 Critical / Major 時條件升 codex xhigh** | simplify 補 reuse / 精簡盲點 + codex 跨模型抓 bug / 邏輯 / 安全；high 一輪覆蓋多數情境，Critical / Major 才升 xhigh 深驗。詳見 `.claude/skills/commit/SKILL.md` Step 0-A。 |
| **Spectra `propose` 階段（draft）** | **預設 Codex GPT-5.5 xhigh draft，無 A/B 詢問**（除非使用者明確要求純 Claude） | propose 是抽象決策 + 高思考預算工作；codex xhigh draft + 主線 cross-check 比擇一執行更穩。詳見 `spectra-propose` Step 0。 |
| **Spectra `propose` cross-check** | **主線 Claude Opus 4.8 xhigh** | codex 回後主線必跑：post-propose-check + design-inject + 主線補 Design Review 7 步 template + spectra analyze。主線 = quality gate，不只是 dispatcher。 |
| **Spectra `apply`（非 Design Review、非 UI view phase，phase 粒度）** | **Codex GPT-5.5 high**（不要 medium） | mechanical 寫 code 用 high 夠；medium 漏 schema drift / cross-file refactor / enum exhaustiveness 風險高。phase 粒度避免大量 round-trip。 |
| **Spectra `apply` UI view phase（component / page / view / layout / styling）** | **主線 Claude Opus 4.8 xhigh，永不派 codex** | UI view 層的視覺 / 互動 / a11y 細節需要與 Design skill 緊耦合，Codex 在此領域 tooling 弱。Frontend 但非 view 的工作（store / hook / API client / type / util）不在此範圍，仍走 codex。 |
| **Spectra `apply` Section 7（Design Review）** | **主線 Claude Opus 4.8 xhigh，永不派 codex** | Design skill（`/impeccable *` / `/design improve` / `/impeccable audit` / review-screenshot）是 Claude Code 一等公民，Codex 在此領域 tooling 弱。 |
| **`screenshot-review` verify mode**（spectra-apply Step 8a `[verify:ui]` channel、`/spectra-archive` 前視覺 QA、verify-channel 補拍 screenshot） | **主線 Claude 直派 Codex GPT-5.5 low**（用 Bash 走 `agent-routing.codex-watch-protocol.md` § Codex 派工的標準流程；**禁止** `Agent` tool with `subagent_type: screenshot-review` — sonnet wrapper 已多次驗證自做工作繞過 codex dispatch） | sonnet wrapper 反覆無法 enforce Step 0 字面身份檢查（2026-05-19 align-shipments-rls-auth + 2026-05-23 warehouse Re-Design 兩起 incident），主線直派 codex 是唯一可靠路徑。詳見 [`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md) § screenshot-review Verify Mode Dispatch + [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段 agent 需要 admin / fixture / per-role session cookie 跑 `[verify:api]` curl 或 `[verify:ui]` browser auth） | **主線自己 scaffold `_dev-login` route via clade cookbook + curl mint session**（**禁止**要求 user 走 Google OAuth + DevTools 複製 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing — 別走 lazy grep） | Cookie 取得是 agent autonomy 範圍內可解的事；clade 已備 canonical pattern（`rules/modules/auth/<auth-module>/dev-login.md` + `vendor/snippets/dev-auth/templates/` + `vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs` detection helper + `scripts/audit-dev-login-adoption.mjs` audit signal）+ 4/6 consumer reference impl (<consumer-b> legacy / <consumer-a> monorepo / <consumer-d> canonical / <consumer-c> better-auth-post)。詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first hard rule + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |

## Orchestration Residency（誰持有長 session — 決定層）

**核心命題**：上面 Routing Table 決定誰**寫** code，但沒決定誰**持有那條長 session**。實測負擔的大頭不是 output（一個月才 ~300M），是**主線 turn 數 × 每 turn 重讀的 context**——重倉每個 tool call 平均重讀 250-270K context，dispatch 後逐 phase live-watch + cross-check 會讓主線整段 codex 工作期間 context 全程燒著（光「每 3 分鐘強制 poll」一個月就製造 ~4,700 個主線 turn）。所以除了「誰寫」，必須再決定「誰扛 session 殘留」。

依 change 特性二選一：

### Codex-primary（Codex 扛整條執行 session，主線只在邊界把關）

**進入條件**（A 或 B 命中即走）：

- **A. 純非-view change**：整條 change **沒有任何 UI view phase**（無 `.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`）**且** tasks.md 已定稿（post-ingest / post-propose，phase 切分清楚）——工作性質是「執行已知計畫」。
- **B. 機械式 sweep**：lint fix / dep upgrade / rename / cross-file refactor / test 修復 / codemod，即使無正式 tasks.md。

**做法（change 粒度，不是 phase 粒度）**：

1. 主線**一次** dispatch 整條 change 的**所有**非 view phase 給單一 background codex（prompt 列全部 phase + 各自 acceptance + Plan-first + Commit Authorization；codex 逐 phase 自 commit，per reference § Commit Authorization）。**NEVER** 一個一個 phase 派（phase 粒度是 Claude-primary 才用）。
2. Dispatch 後走 **notification-only watch**（見 reference § 監看排程「主線直接 Bash 派」路徑）——主線 idle 等通知，**不**逐 phase cross-check、**不**每 3 分鐘短輪詢。
3. 收到 `<task-notification status=completed>` 後，主線**一次**做 change 粒度 cross-check：
   - `git -C <wt> log main..HEAD --oneline` —— phase 數 = dispatch 的 phase 數、每條 commit format 合規
   - View-layer drift double-check + Scope discipline cross-check（同 reference § Spectra Apply Phase Dispatch Step 5）
   - typecheck + 相關 test
4. 主線**自己**跑 Section 7 Design Review（永不派 codex）。
5. 進 `/commit` 0-A gate（simplify + codex review + 主線 cross-check）。

**把關沒被拿掉，只是從「全程貼身監看」移到「邊界檢視最終產物」**——對齊 staff engineer review PR（review 成品，不是盯打字）。真正的兩道 gate（`/commit` 0-A + archive 時 Design Review）作用在最終 squashed diff 上，與誰 orchestrate 無關。

### Claude-primary（主線持有 session — 以下任一命中即留主線）

- **UI view 工作**（視覺 / 互動 / a11y，per Routing Table 永不派 codex）
- **架構 / 設計決策、需求模糊**——先 plan mode 釐清，不是「執行已知計畫」
- **安全敏感**、需要 tight review loop 的 change
- **clade routing / 規則知識**的編輯（主線才有 routing context）
- **路徑未知的探索式 debug**（不知道要改哪、邊查邊改）

Claude-primary 下若個別 phase 仍要派 codex，走下面 § Spectra Apply Phase Dispatch（phase 粒度 + watch）；watch 規範見 reference 檔。

## Spectra Propose Handoff（決策層）

Claude Code session 收到 spectra propose 請求時：

1. **NEVER** 用 AskUserQuestion 問 A/B（除非使用者**明確**要求「純 Claude propose」或「不要派 codex」）
2. **MUST** 預設走「Codex draft + 主線 cross-check」流程（具體步驟與 codex 派工模板見 reference `agent-routing.codex-watch-protocol.md` § Codex 派工的標準流程）
3. **MUST** 主線是 quality gate — 不要把所有事推給 codex 後直接結束

詳細流程見 `plugins/hub-core/skills/spectra-propose/SKILL.md` Step 0。

## Spectra Apply Phase Dispatch（決策層）

> **先判 residency**（見 § Orchestration Residency）：若整條 change 符合 Codex-primary 進入條件（純非-view + tasks.md 定稿，或機械 sweep），優先走 Codex-primary 的 **change 粒度單次 dispatch + notification-only**，**不要**落到下面逐 phase 派工。下面的 phase 粒度 dispatch 是 **Claude-primary** 場景（change 含 view phase、需逐 phase 把關、或混雜）才用。

執行 `spectra-apply` 時（Claude-primary 場景），phase 粒度派 codex：

1. Read tasks.md，按 `## N.` 切分 phase
2. **每個 phase 三類分類**（依序判定，命中即停）：
   - **A. Design Review phase**：標題含 "Design Review" 或內容含 `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot`
     → **主線 Claude Opus 4.8 xhigh 自己做，永不派 codex**
   - **B. UI view phase**：phase 內任一 task 描述/路徑指涉 view 層檔案——`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且該 phase 沒有摻入非 view 的 frontend / backend 工作**（store / hook / API client / type / util / migration / API server）
     → **主線 Claude Opus 4.8 xhigh 自己做，永不派 codex**
   - **C. 其他 phase**：上述兩類以外（schema、migration、API server、CLI、純 backend、frontend 但非 view 的 store / hook / API client / type / util、unit test、docs）
     → **派 background codex GPT-5.5 high 做完整 phase**
3. **混雜 phase fallback**（A、B 都不是純 view、又混雜 view 與非 view 工作）：
   - **看該 phase 是否已開工**（任一 task `[x]` 或 git history 顯示 phase 內檔案已被改）：
     - **已開工** → **主線整個 phase 自己做**（safety fallback；不重切，不派 codex）
     - **未開工** → **STOP**，回覆使用者：「phase `<N>. <title>` 同時混雜 UI view 與非 UI 工作，違反新版 Phase Dispatch 規則。請改跑 `/spectra-ingest <change>` 把 UI view tasks 與其他 tasks 切成獨立 phase 後再 `/spectra-apply`。」**禁止**主線自行修改 tasks.md phase 結構（這屬 ingest 範圍，避免 propose / apply 邊界混淆）

每個 C 類（codex）派工的 prompt 內容、`[DELEGATED-BY-CLAUDE-CODE]` marker、watch protocol、view-layer drift 檢查、收尾驗證流程詳述見 reference 檔的「Codex 派工的標準流程」與「Spectra Apply Phase Dispatch（具體做法）」段。

## WebSearch Handoff（決策層）

Claude Code session 內偵測到「需要 WebSearch」時：

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走 reference 檔的「Codex 派工的標準流程」，參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`
3. prompt 內容固定包含：要查的問題 + 期望輸出格式（連結 / 摘要 / 條列重點）

### 例外（仍可在當前 session 直接處理）

- **本機檔案 / 已下載文件**內容查詢——用 Read / Grep 即可，不算 web search
- **使用者明確要求** 「直接用 WebSearch」——尊重使用者指令
- **Codex 本身就是當前 runtime**——已經在對的位置，不需要 handoff
- **`WebFetch` 抓單一已知 URL**——這是抓取，不是搜尋；可直接做

## 為什麼集中寫在這

- 跨 skill / 跨情境的 routing 規則散落在各 SKILL.md 會漂移
- 集中一處方便加新 routing rule（例如未來 image gen / long-doc summary 的最佳 runtime）
- consumer 端 `.claude/rules/agent-routing.md` 帶 `🔒 LOCKED` banner，**禁止**本地 override

## 必禁事項

- **NEVER** 在 verify channel evidence collection 階段問 user 手動取 session cookie / 走 Google OAuth + DevTools 複製貼回（per [[manual-review]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]）— agent **MUST** 第一動作 = scaffold `_dev-login` route via clade cookbook (`rules/modules/auth/<auth-module>/dev-login.md` + `vendor/snippets/dev-auth/templates/`)，自己 mint session
- **NEVER** 在 Claude Code session 直接呼叫 `WebSearch` 工具（改派背景 codex GPT-5.5 medium）
- **NEVER** 印「請開啟 Codex CLI」「Stop here」「請貼 prompt」這類純文字 handoff 訊息要使用者手動切 — 主線必須自己派背景 codex
- **NEVER** 嘗試 `codex:rescue` / `codex:setup` plugin 路線（已驗證無法使用，2026-04-29 已 uninstall + 全清；`/assign` skill 也已於 2026-05-02 移除）
- **NEVER** 沉默等使用者問進度；收到 `<task-notification> status=completed` 必須立刻自己讀檔回報
- **NEVER** 派出 codex 後不啟動 Codex Watch Protocol — 「乾等盲區」是已驗證會吃使用者體驗的根因
- **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup — 必須立刻 `AskUserQuestion` 介入
- **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent）— 監看純粹只看進度
- **NEVER** 在 Spectra propose 階段問 A/B（已預設 codex draft）— 除非使用者**明確**要求純 Claude propose
- **NEVER** 派 codex propose 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze）
- **NEVER** 在 spectra-apply Section 7（Design Review）派 codex — 主線自己做
- **NEVER** 在 spectra-apply 把 UI view phase（component / page / view / layout / styling）派給 codex — 主線自己做。Frontend 但非 view 的（store / hook / API client / type / util）仍走 codex
- **NEVER** 派 codex 跑 UI view phase 時省略 prompt 內「禁止改 view 層檔案」硬指令 — 缺這條 codex 容易順手改到 .vue / .tsx
- **NEVER** 收到 codex 完工通知後跳過 view-layer drift 檢查（`git diff --name-only` 過濾 view 路徑） — 是主要的回收 quality gate
- **NEVER** 在 spectra-apply 偵測到「混雜 phase（UI view + 非 view 摻在同 phase）且未開工」時自行修改 tasks.md 拆 phase — 該交給 `/spectra-ingest` 處理（apply / propose / ingest 邊界要清楚）
- **NEVER** 在 spectra-apply 派 codex 用 medium effort — 一律用 high（medium 漏 schema drift 風險高）
- **NEVER** task 粒度派 codex（過細 round-trip）。粒度依 residency 決定：**Codex-primary 走 change 粒度**（一次派整條 change 全部非 view phase）、**Claude-primary 走 phase 粒度**——兩者都不在 task 粒度（見 § Orchestration Residency）
- **NEVER** 把符合 Codex-primary 進入條件（純非-view + tasks.md 定稿，或機械 sweep）的 change 落到逐 phase live-watch — 那是 Claude-primary 才用的模式；純非-view change 應 change 粒度單次 dispatch + notification-only（見 § Orchestration Residency）。把關移到收尾 cross-check + `/commit` 0-A，不在過程貼身監看
- **NEVER** 對主線直接 Bash 派的 codex 啟動每 3 分鐘強制 poll — 直接 dispatch 路徑預設 **notification-only**（`<task-notification>` + BashOutput 在主線 sandbox 可靠，`fetch failed` 等常見失敗會讓 codex exit → 立刻觸發通知）。每 3 分鐘 FS poll **只**用於 subagent 中介 dispatch（cross-sandbox 通知可能 silent miss，見 reference § 跨 sandbox 可見度約束 失敗模式 2）
- **NEVER** 派 codex 跑 spectra-apply phase 而 prompt 內漏 Commit Authorization 段（一 phase 一 commit / `🧹 chore: wt <change>-phase-<N>` format / hook 必跑禁 `--no-verify` / commit 前自驗 view-layer + scope）— 缺這段 codex 不知道格式、會混 commit 或撞 commitlint hook，主線難對齊 phase 邊界
- **NEVER** 派 Codex 寫 code（spectra-propose draft / spectra-apply phase）而 prompt 漏掉 Plan-first 硬指令 — 沒有 plan 主線只能從 diff 反推 codex 意圖，cross-check 成本高且容易漏掉「codex 漏做某檔」。Plan 是事前公開思路，不是 review gate（codex 寫完 plan 必須立刻續跑，不停下來）
- **NEVER** 在 commit 0-A 跳過 0-A.0 `simplify` skill —— simplify 是 reuse / 精簡 / efficiency / altitude 盲點的入口，必須序跑在 codex 之前
- **NEVER** 在 commit 0-A 把 `simplify` 跟 codex 並行 —— simplify 修完才是 codex 應該看的版本
- **NEVER** 在 commit 0-A 啟用已棄用的 `code-review` agent（Opus subagent）—— 職責與 codex review 高度重疊且同為 Anthropic 模型盲點
- **NEVER** 改用其他模型或顛倒 codex 兩輪 effort（codex 必為 `gpt-5.5`；0-A.1 必為 `high`、0-A.2 必為 `xhigh`）
- **NEVER** 在 commit 0-A 跑第 3 輪 codex —— 2 輪內處理不完代表變更太大，應先 split；0-A.2 由 0-A.1 的 Critical / Major 條件觸發，不可無條件升級也不可因抓到 Critical / Major 而跳過
- **NEVER** 在 Codex 端執行 `$spectra-apply` 而 prompt body 沒有 `[DELEGATED-BY-CLAUDE-CODE]` marker — **MUST** 立即 STOP 且不執行任何 `spectra` 命令（見 reference 檔的「Codex `$spectra-apply` Runtime Gate」）
- **NEVER** 主線派 Codex 跑 spectra apply phase 而 prompt 第一行不是 `[DELEGATED-BY-CLAUDE-CODE]` marker — 會被 Codex 端 Runtime Gate 擋掉、整個 phase dispatch 白做
- **NEVER** 從主線用 `Agent` tool with `subagent_type: screenshot-review` 派 verify mode 工作 — sonnet wrapper 已多次驗證會繞過 Step 0 字面身份檢查、自做工作（2026-05-19 align-shipments-rls-auth + 2026-05-23 warehouse Re-Design 兩起 incident）。**MUST** 主線直派 codex GPT-5.5 low via Bash background，走 [`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md) § Codex 派工的標準流程 + § screenshot-review Verify Mode Dispatch。Sonnet wrapper 路徑保留**僅給** codex CLI 不可用的 fallback 場景，**禁止**作為預設入口。
- **NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table
