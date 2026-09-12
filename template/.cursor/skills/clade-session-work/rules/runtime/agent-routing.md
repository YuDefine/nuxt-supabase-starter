<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/agent-routing.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor native routing transport

## Cursor runtime 主線 residency

**適用 predicate**（命中任一，本節就約束本檔其餘委派指示）：系統提示自稱 Cursor；Task tool 的 model 清單含 `claude-opus-5` / `composer-2.5` / `gpt-5.6-sol` / `grok-4.5`；env 有 `CURSOR_SESSION_ID` 或 `CURSOR_TRACE_ID`。

**Iron Law：本 session 的執行 model 維持 Grok 4.6。違反字面就是違反精神。**

**Nuxt UI／Nuxt Content 實作**使用 Cursor 原生 Task／Agent 的 **Composer 2.5**：當次 catalog 必須提供對應的 model ID，brief 明列 `ui-implementation` 與 Nuxt UI／Content scope；選 catalog 中實際存在的 Composer 2.5 ID，不自行拼接 `-fast` 或其他 suffix。該 bounded worker 不改變 Grok 主線 residency。

其餘 Task／Agent 沿 Grok 4.6；省略 `model`（inherit 主線）與 `cursor-grok-4.6-high` 同家族合法。**NEVER** 把 Cursor Task 設成 `claude-*` 或 GPT 模型來代替對應 runtime。Pi 承載的 Cursor pool 仍禁止 mutation，不能藉 Composer UI 例外解除隔離。

Nuxt 本體走 `nuxt-core-implementation` Pi Sol xhigh，其餘 UI view 走 `ui-view-implementation` Herdr Opus 5 medium。其他模型依具名列使用以下載體：

1. **Pi 具名工作（含 Gemini screenshot review）** → `vendor/scripts/pi-dispatch.ts`。predicate：`command -v pi` 成功，且該次 `--model` 沒被 dispatcher 以 exit 3（runtime）或 exit 4（配額）當場拒絕；失敗只走該列已定義的 fallback，Gemini screenshot review 保留 blocker。
2. **Claude 具名工作** → Herdr create-only：`node vendor/scripts/herdr-session-handoff.ts --cwd <abs> --label <label> --prompt-file <brief> --model <slug> --effort <level> --route <route> --tier-basis <basis> --launcher cc` 或 `--launcher ccw`，並加 `--coordinate`。`--model` 必填：要 child 跑特定 model 就給 slug，brief 正文寫「用 Opus 5」child 做不到。**NEVER** `--relay`。clade / YuDefine 工作預設 `ccw`，其餘 `cc`。Cursor 沒有 `CLADE_CLAUDE_LAUNCHER`，缺 `--launcher` 會 `unsupported_launcher`。 **NEVER `--launcher pi`**：create 一律拒（Pi 新工作走 `pi-dispatch.ts`），Cursor 池連 relay 都拒。`/commit` 走 `~/.cursor/skills/commit/SKILL.md`（主線跑完整 ceremony；0-A.2 Fable 缺 pane 就先開 pane，不是停點）。缺 pane／helper 還沒建 session → **MUST 再開一次**，不是寫 BLOCKED。

Cursor 派出 Herdr 之後 MUST `--coordinate` 或 `--coordinate-resume` 等到 correlated `--complete`，再收回 child pane 並繼續；NEVER `--relay`。切片逾時會回 `coordination_pending`，主線立刻 `--coordinate-resume <dispatch_id>`，**不得**把 idle/done 當完成、也不得直接 `herdr pane close`。這不是 `/handoff`：主線繼續工作，**NEVER** 輸出「目前這裡收工」。

**NEVER** 把「Routing Table 寫 Agent tool Claude」讀成「Cursor Task 設 `model=claude-opus-5`」。那是 Claude Code 的 Agent tool，不是 Cursor 的 Task catalog。screenshot review 走第 1 條 Pi Gemini 3.8 Flash；Design Review、UI 詳細計畫與截圖符合性走第 2 條 `--model claude-opus-5 --effort medium`，每次帶 `--route routing-table --tier-basis table-row --table-row <design-review|ui-detailed-planning|screenshot-match-analysis>`，依實際工作選一列。

全域注入走 Cursor **User Rules**（Customize → Rules，「Cursor 主線只留 Grok 4.6」）。專案 `.cursor/rules/` 只罩該 repo；**NEVER** 靠 consumer `CLAUDE.md` snippet 當全域通道——那會讓 Claude Code session 付 always-load 預算。

### Cursor 環境的 browser 載體（hard rule）

命中本節 predicate（或 env 有 `CURSOR_AGENT=1` / `CURSOR_SESSION_ID` / `CURSOR_TRACE_ID` / `CURSOR_CONVERSATION_ID`；工具清單含 `cursor-app-control` / `cursor-ide-browser`）時：

- 開網頁 **MUST** 走 Mac Cursor 的 `cursor-ide-browser`（`browser_tabs` → `browser_navigate` → 既有 tab 先 `browser_lock` → snapshot / 點 / 填 → 結束才 unlock）。這是 IDE browser，不是系統瀏覽器。
- **NEVER** 用 `open_resource` 開 `https://`：那會打開外部／系統瀏覽器，是錯的載體。
- **NEVER** 因 clade routing gate、`agent-browser` 措辭、或 § External web retrieval 的「NEVER 直接 WebSearch」改走 Playwright / `agent-browser`。Google 會趕到 `accounts.google.com` 且 URL 含 `signin/rejected`。`cursor-ide-browser` **不是** `WebSearch` / `WebFetch`。
- 開 Google / Tailscale 登入頁 **MUST** 留 Cursor 主線。**NEVER** 派沒有 `cursor-ide-browser` MCP 的 Task / subagent 去假裝操控 Chromium。
- 主線 catalog 沒有該 MCP 時：報缺載體，**NEVER** 改走 `open_resource` 或 `agent-browser`，**NEVER** 複製 `~/.cursor/projects/*/mcps/cursor-ide-browser/`（假陽性），**NEVER** 寫進 `~/.cursor/mcp.json`（內建 server 寫不出來）。本機 `127.0.0.1` callback 才要 port forward。
- **Clade routing gate / Pi handshake NEVER 讓 Cursor 主線無法呼叫 `cursor-ide-browser`。** 豁免清單與 fail-open 契約在 `plugins/hub-core/hooks/pre-tool-routing-gate.sh` 檔頭，由 `test/pi-routing-gate.test.ts` 釘住。

非 Cursor（Claude Code 等）才走 `agent-browser`。

The common routing predicates remain binding for every Cursor Task or Herdr handoff. The Cursor catalog and IDE browser are native surfaces only when the current session exposes them.

Opus 5 無法執行 Design Review、UI 詳細計畫或截圖符合性時，記錄實際失敗原因並沿 routing table 原工作列改派 GPT-5.6 Sol（effort: high）；原 gate 與圖片存取要求維持，Sol 再失敗就保留 blocker。
