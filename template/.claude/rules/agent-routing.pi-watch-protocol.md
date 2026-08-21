---
description: Pi 派工的標準流程模板、Pi Watch Protocol、Plan-first / Git baseline declaration、$spectra-apply Runtime Gate、screenshot-review verify mode 派工與監看、配額耗盡的 fallback 鏈全文、Spectra Propose / Apply 的 dispatch 契約；apply 階段 / 觸及 spectra change 時 path-scoped 載入——單純「要派 pi」不會自動載入本檔，MUST 依 [[agent-routing]] 的強制指針主動 Read
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', 'scripts/spectra-advanced/**', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.pi-watch-protocol.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Routing — Pi / screenshot-review Dispatch & Watch Protocol

> Reference 檔。核心 routing 規則見 [`agent-routing.md`](./agent-routing.md)。本檔聚焦實際派 Pi / screenshot-review agent 出去時的標準流程模板、watch protocol、Plan-first / Git baseline declaration 硬指令、`$spectra-apply` Runtime Gate marker 機制。

## Pi 派工的標準流程（所有 routing 共用）

派**任何** Pi 席位出去工作**一律走 `vendor/scripts/pi-dispatch.ts`**——`sol` / `luna`（provider `openai-codex`；`terra` 可解析但 2026-08-11 起 **NEVER** 派）、`sol-cursor` / `luna-cursor` / `grok-cursor`（provider `cursor`）、`grok-xai`（provider `xai`）**每一格都走這個入口**，沒有例外。

要指 `openai-codex` 那組席位時寫 **codex-pool**，那個區分只在配額鏈與計價成立；派工管道一律稱 pi。

**NEVER** 直接執行 `codex exec`、`codex review`，也不走任何 `codex:rescue` / `codex:setup` / `codex:codex-rescue` plugin 路線。

主線 Claude 自己派、自己等通知、自己讀 dispatcher JSON 回報，**禁止**叫使用者切 CLI、**禁止**「Stop here」純文字 handoff。

模板：

1. 用 **Write** 把指示寫到 `/tmp/pi-<topic>-<slug>-prompt.md`（prompt 太長不要 inline）
2. **Bash** tool（`run_in_background=true`）：

`<model-slug>` 選檔：命中 [[agent-routing]] § Routing Table 類別 → 照該列（多為 `gpt-5.6-sol`）；本次工作**原本會派 Claude subagent**（原判 `sonnet`／`haiku`）→ 依 § Claude 委派的 model 檔位 派 `gpt-5.6-luna`（sonnet→`--effort high`、haiku→`--effort low`）。判不出來 → `gpt-5.6-sol`。

   ```bash
   node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
     --brief /tmp/pi-<topic>-<slug>-prompt.md \
     --cwd <cwd> \
     --label <topic>-<slug> \
     --model <sol|sol-cursor|luna|luna-cursor|grok-xai|grok-cursor> --effort <low|medium|high|xhigh|max> \
     --route <routing-table|claude-delegate-sub|fallback-chain|manual> \
     --tier-basis <table-row|five-conjunct|adjudication|delegate-sub|quota-fallback|manual> \
     [--table-row <routing-row>] [--retry-of <prior-label>] [--chain-origin <sol|luna|grok-xai>]
   ```

   `--chain-origin` 只在 `--model grok-cursor` 這一格 **required**：luna 鏈與 grok 鏈都終止於它，
   終點的 Claude 檔位按**起點**分（luna→`haiku`、grok-xai→`sonnet`）。不帶且 `--retry-of` 也回溯不到起點時，
   dispatcher 的 exit 4 回 unresolved 而不猜檔位。其餘 model 起點唯一，不必帶。

   Dispatcher 固定用 Pi JSON mode、ephemeral session與 machine-safe extension profile，provider 由 `--model` 決定（`openai-codex` / `cursor` / `xai`）；model、effort、routing attribution與 exit code由這個入口統一驗證。MCP extension存在時由 dispatcher明確載入，interactive `cx` extension不會進 machine dispatch。

3. 立刻簡短回報 bash job ID 給使用者
4. 立刻啟動 **Pi Watch Protocol**（見下節 § 監看排程）— notification-only（主線 idle 等通知，只下**一個** ~1500s 安全網 fallback 防罕見 hang-type 失敗）。**禁止**啟動每 3 分鐘短輪詢（無謂 turn 重燒 context）。**禁止**任何 subagent 中介 dispatch（per `agent-routing.md` § Dispatch 入口）
5. 收到 `<task-notification> status=completed` → 立刻 BashOutput 讀 stdout → **先跑 Input Intercept 偵測**（per [[agent-routing.pi-input-intercept]] § 問題偵測）→ 無問題則整理結果回報；有問題則走攔截→評估→代答/升級流程；watch loop 自然終止
6. **NEVER** 沉默等使用者來問進度

各 routing 的參數差異：

| Routing | `<topic>` | `<cwd>` | reasoning effort | 預期動作 | Plan-first | Commit Prohibition |
| --- | --- | --- | --- | --- | --- | --- |
| WebSearch | `websearch` | `/tmp` | `medium` | 純讀（搜尋網頁/查文件） | 否 | N/A（不寫檔） |
| Spectra propose（draft） | `spectra-propose` | consumer repo root | `xhigh` | 寫 spec/proposal 到 `openspec/changes/<change>/`（主線之後 cross-check） | **是** | **是** |
| Spectra apply phase（非 Design Review、非 UI view） | `spectra-apply-<phase-id>` | consumer repo root | `high` | 完成單一 phase 內所有 tasks，回報 tasks.md checkbox 狀態 | **是** | **是** |

> sandbox flag 統一使用 `--dangerously-bypass-approvals-and-sandbox`，不再分 `-s read-only` / `-s workspace-write`（在背景 codex 會擋 MCP）。「預期動作」由主線在 prompt 內陳述，靠 pi 自律。

### Code review 唯一入口

**NEVER** 用 `codex review`、raw `codex exec`或一般 coding dispatcher做跨模型 review。

commit 0-A 的標準入口是 `plugins/hub-core/scripts/codex-review-safe.sh`。它由 caller凍結完整working-tree changeset，再呼叫Pi review runner；runner只開`read,grep,find,ls`，沒有bash、write、edit或MCP，因此read-only是tool allowlist契約，不靠prompt自律。

```bash
.claude/scripts/codex-review-safe.sh high
```

reasoning effort由第一個參數指定；wrapper不接受額外runtime flags。所有consumer與clade自身都走這個入口。

### Plan-first（寫 code 的派工必加）

派 Pi **寫 code / 改檔**（spectra-propose draft、spectra-apply phase）的 prompt **MUST** 內含以下硬指令（**WebSearch / review wrapper（codex-review-safe.sh）不需要** — 它們純讀不寫）：

```
Plan-first（**MUST**）：
在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：
- **要動的具體檔案**（每條一行的相對路徑）
- **每個檔案打算做什麼變動**（一句話描述）
- **預期影響範圍**（typecheck / 測試 / 其他模組 / migration / runtime 行為）

Plan 寫完後**立刻**繼續執行，**不要**停下來等使用者或主線確認。Plan 的目的是讓主線 cross-check 你的判斷，不是 review gate；中途不要徵詢同意。
```

理由：pi 在背景非互動跑、主線只能事後讀 stdout 對齊判斷。沒有 plan 時主線只能從 `git diff` 反推「pi 為什麼這樣改」，cross-check 成本高且容易漏掉「pi 漏做某個檔」這類問題。Plan 等於事前公開思路，讓主線在收尾時用 plan vs. diff 對齊就能抓到漏網之魚。

### Brief 措辭紀律（4.8-aware，寫 code 派工必加）

GPT-5.6 與 Claude 4.8 都**字面遵守指令、不外推**（Anthropic prompt best-practices 對 4.8 的明示行為）。派工 brief（給 pi 的 prompt，或 fan-out subagent 的 thin brief）**MUST**：

1. **祈使動詞要「動手」**：寫「**實作** / **修改** / **產出到 `<path>`**」，**NEVER** 用「分析 / 看看 / 評估 / 建議」這類動詞——後者會被字面理解成「只讀不寫」，回來一份報告卻沒改檔。
2. **明寫套用範圍**：要對多個對象做同一件事時，**MUST** 點名範圍（「**每個** phase 都做，不只第一個」「`app/components/` 底下**全部** `.vue`」）。4.8 不會把「修 X」默默推廣到 Y/Z，範圍含糊就只做命中的第一個。
3. **禁止 hard-code 過測試**：brief **MUST** 含一條——「**NEVER** 為了讓 test 綠而 hard-code 回傳值、跳過邏輯分支、或改測試期望值遷就實作；test 必須驗真實行為，不確定就回報而非硬湊」。pi `high` 卡住時傾向 hard-code 騙綠燈。
4. **附驗收標準**：brief 結尾 **MUST** 列「完成判準」（哪個 test 綠、哪個 endpoint 回什麼、tasks.md 哪幾條 `[x]`），讓主線 cross-check 有客觀對齊點。

### Git baseline declaration（dirty working tree 派工必加）

派 Pi 寫 code 時若 working tree **不乾淨**——有 staged/unstaged 修改、untracked 新檔或新目錄——prompt **MUST** 內含 `## Git Baseline` section，明白告訴 pi 哪些 path 是**預期既有變更**、來源是什麼、不要因此停手。

Dirty working tree 有兩種來源，**兩種都要列進 baseline**：

1. **主線操作型**：主線剛跑 `/spectra-ingest` 完成的 artifacts、剛寫進 `docs/tech-debt.md` 的 TD-NNN entry、未 commit 的 ROADMAP/HANDOFF 更新
2. **自動 hook 型**：`pnpm install` postinstall hook 觸發 `hub:bootstrap` → `sync-to-codex` 自動把 main branch 的 clade 更新同步進 worktree，產生 LOCKED projection diff（`.claude/` / `.agents/` / `AGENTS.md` / `CLAUDE.md` / `.claude/scripts/`，檔頭有 `🔒 LOCKED — managed by clade` banner）。主線沒主動操作但 working tree 仍 dirty

派工前**MUST 跑**：

```bash
git status --porcelain=v1                       # 列所有 dirty path
cat .claude/.hub-state.json | grep syncedAt     # 若新近時間戳 → 自動 hook 型 dirty
```

把輸出與本次工作範圍比對，所有「不在本次工作範圍內、但 working tree 有改動」的 path 都要列進 baseline 段。

樣板：

```
## Git Baseline（**MUST** 讀完再開工）

以下 path 是預期既有變更，不是別 session 的 WIP，**不要**因為它們而停手或反問：

主線操作產生：
- `docs/tech-debt.md` (modify) — 主線剛新增 TD-064 entry
- `openspec/changes/<change-name>/` (untracked) — 主線剛跑 `/spectra-ingest` 完成的 artifacts

hub:bootstrap 自動同步產生（請完全忽略，與本次工作無關）：
- `.claude/` `.agents/` `AGENTS.md` `CLAUDE.md` `.claude/scripts/` — 投影層由 clade 中央倉自動同步，檔頭有 🔒 LOCKED banner

你的工作範圍**只動**：<列出本次 phase 真正要動的檔案 / 目錄>
若本次工作要動的範圍與上述 baseline 有交集，以下列規則為準：<填衝突處理>
```

派工視窗保護：若派 pi 期間預期會再跑 `pnpm install` / `pnpm hub:check` 等可能觸發 sync 的動作，**先在主線跑完讓 baseline 穩定**再派 pi；不要在 pi 跑的同時讓 hub:bootstrap 又撐出新 LOCKED diff，否則 pi 會再次按 scope discipline 停手。

理由：pi 內建 scope discipline——看到工作目標範圍外的修改會合理地停下來避免越權踩到別 session WIP。兩種 dirty 來源 pi 都觀念正確：(1) 主線剛跑完 ingest / propose / TD / handoff 後 working tree 自然 dirty；(2) `pnpm install` postinstall 自動觸發 hub:bootstrap 把 main 的 clade 更新拉進來。兩種都不告知就會逼 pi 走「未知既有變更 → 停手」路徑，回來再 round-trip 重派比 prompt 多寫兩行貴得多。**禁止**把這當「pi 觀念錯」處理——它觀念是對的，是主線 prompt 沒給 git baseline。

例外：

- review wrapper（codex-review-safe.sh）與 WebSearch 不需要這段（review 的本質就是讀 dirty diff、WebSearch 純讀不動檔）
- 同一條派工 round-trip ≥ 2 次都因**同類 dirty** 停手（例：hub:bootstrap 反覆觸發 LOCKED projection 更新），且**剩餘工作是純 mechanical**（明確檔案 swap、< 5 行 edit），主線改自己做合理；但同步要 root-cause baseline 為什麼沒穩定（hub:bootstrap 重複跑？missing path？）並修，不是只把當下 task 收掉跳過教訓

### Commit Authorization（pi 派工 hard rule）

派 Pi **寫 code / 改檔** 時，prompt **MUST** 內含以下硬指令（**WebSearch / review wrapper（codex-review-safe.sh）不需要** — 它們純讀不寫）：

```
## Commit Authorization（**MUST**）

你**可以**在 worktree 內 commit，但 **MUST** 遵守規約。每完成一個 phase 的全部 tasks 後，commit 一次：

**允許**：

- 一 phase 結束 commit 一次（多檔可同一 commit）
- Selective stage：`git add -- <each scoped file path>`
- Commit：`git commit -m "🧹 chore: wt <change>-phase-<N> — <一行說明>"`（emoji-conventional commitlint 合規，pre-commit / commit-msg hook 必跑）

**禁止**：

- `git add -A` / `git add .`（會撈到 main fork 過來的 baseline）
- 跨 phase 混 commit（一個 commit 含多 phase 的改動 → 主線無法用 `git log main..HEAD` 對齊 phase 邊界）
- 改 commit message format（**MUST** 用 `🧹 chore: wt <change>-phase-<N> — <short>`，emoji + type + `wt` 主旨 subject 一體格式）
- `--no-verify`（per [[commit]] hard rule，主線/subagent/pi 一視同仁；hook 擋住代表 phase 內容有問題，必須修而非繞）
- `git push` / `git push --force`
- `git stash` / `git stash push` / `git stash pop`（中途 stash 抹掉 working tree 會繞過主線監看）
- `git commit --amend`（一 phase 一 commit、不要 amend 修飾）
- `/commit` / `/spectra-commit`（commit ceremony 在 main 跑、不在 worktree）

**Commit 前 self-check（MUST，任一條命中即 abort、NEVER commit）**：

1. **View-layer drift**：

   git diff --staged --name-only | grep -E '\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$|app/(pages|components|layouts)/|^(pages|components|layouts|views)/'

   命中 → 回報「view layer drift detected: <files>」並中止 commit。

2. **Scope discipline**：

   git diff --staged --name-only

   對比 phase 內預期落點（task → 檔案對應表）— 超出範圍 → 回報「scope drift: <files>」並中止 commit。

**Commit message format（MUST）**：

   🧹 chore: wt <change-name>-phase-<N> — <一行說明 pi 做了什麼>

範例：`🧹 chore: wt consumable-po-link-phase-3 — admin PO entry page + handler + types`

Commit 完直接停手回報，**NEVER** 自己跑下一 phase。主線會在 commit 後做 phase boundary 對齊 + view-layer drift 再驗 + scope cross-check，再決定 [接受 / reset 重派 / 中止]。
```

理由：worktree 內的 commit 在 archive merge-back 階段會被 `git merge --squash` squash 進 main 的 working tree、再走 `/commit` 0-A Pi review + 0-B Design Review + 0-C check 才進 main HEAD。所以 worktree 內 pi 自 commit **沒有跳過 review** 的風險（commit 在 squash 時就消失、不會留在 main history）。

仍 enforce 的 guardrail 純粹是 phase boundary 對齊（一 phase 一 commit、message format 機械化解析）+ drift 早攔截（pi 自驗比主線事後 reset 便宜）。Win：主線收到完工通知後直接 inspect → 派下一 phase，不必停下來做 staging。

例外：

- review wrapper（codex-review-safe.sh）與 WebSearch 不寫檔，本節不適用
- 對 `claude` type subagent（如 `/spectra-ingest` 在 /wt 內派出的 wt subagent）規約相同（`🧹 chore: wt …` 前綴 + selective stage + self-check + hook 必跑），per worktree-default.md §5

## 泛用 Dispatcher（pi-dispatch.ts）

**定位**：對已有 cookbook template 的派工場景，用 `~/offline/clade/vendor/scripts/pi-dispatch.ts` 取代手組 prompt — 它把上面標準流程的固定成分（marker / flag 組 / stdin 餵 prompt / 無 pipe redirect / last-message JSON 解析）機械化成一個 node 呼叫，並內建手組 prompt 沒有的 quota check 與 telemetry。**template 已覆蓋的場景一律走 dispatcher；手寫 prompt 僅限 template 未覆蓋的新場景**（寫完若會重複用，回 clade 補 template）。

```bash
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/pi-offload/templates/<name>.template.md \
  --var task='...' --var acceptance='...' --var git_baseline="$(git status --porcelain | head -20)" \
  --var allowed_paths='...' \
  --label <topic-slug> --effort <low|medium|high|xhigh> \
  --route <routing-table|claude-delegate-sub|fallback-chain|manual> \
  --tier-basis <table-row|five-conjunct|adjudication|delegate-sub|quota-fallback|manual> \
  [--table-row <列名>] \
  [--cwd <dir>] [--budget <分鐘>] [--output-schema <schema.json>] [--retry-of <label>]
```

### Routing threshold 與 Claude Agent dispatch gate

Main-thread 同一 prompt segment 的第 3 個高信心 readonly Bash、第 5 個 distinct textual Read，或第一次 Read 501+ 行文字檔會在執行前 block，訊息帶 `decision_id`。Gate 只計高信心事件；compound Bash 一次只計一筆，mutation／build／test／unknown command 不計，含 `agent_id` 的 child hook event 本輪全部 skip。

同一 helper 也攔直接 `Agent(subagent_type: Explore|general-purpose, model: haiku|sonnet)`（省略 `subagent_type` 時視為預設 `general-purpose`）：第一次呼叫即建立 `claude-agent-dispatch` decision，不等 Read／Bash threshold。這條只攔主線顯式降檔委派；其他 agent type、model 省略（繼承主線）與 Opus 不在此 gate 的機械範圍。

Pending decision 只接受下列三種 standalone resolution；一般 Bash／Read／同型 Agent retry 會持續 block：

```bash
# 工作仍是 threshold trigger 本身：照 trigger 填 mechanical-fanout 或 read-heavy-scan
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --decision-id <rgd_...> --model gemini --effort low \
  --route routing-table --tier-basis table-row --table-row <trigger> \
  --template <template.md> --var task='...' --var acceptance='...' \
  --var allowed_paths='...' --label <topic-slug>

# claude-agent-dispatch：原判 Haiku 用 low；原判 Sonnet 用 high
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --decision-id <rgd_...> --model gemini --effort <low|high> \
  --route claude-delegate-sub --tier-basis delegate-sub \
  --template <template.md> --var task='...' --var acceptance='...' \
  --var allowed_paths='...' --label <topic-slug>

# 只有 Routing Table 已列明的 Claude 例外才 waiver
node ~/offline/clade/vendor/scripts/pi-routing-gate.ts waive \
  --decision-id <rgd_...> --reason <waiver-enum> [--note '...']

# dispatcher 已留下最新 exit 3／4 outcome 後，授權 Claude fallback；
# claude-agent-dispatch 的 Luna→Sol 兩次 exit 2 則用 delegate-escalation-failed
node ~/offline/clade/vendor/scripts/pi-routing-gate.ts fallback \
  --decision-id <rgd_...> \
  --reason <dispatcher-mechanical-failure|quota-exhausted|delegate-escalation-failed>
```

工作若已收斂成另一個**更具體**的 Routing Table row，可把 dispatch 的 `--table-row`、`--model` 與 `--effort` 改成該列的值；gate 只接受共用 policy 中已知且有單一 concrete Pi model 的 row。`spectra` 這類 conditional row沒有單一 model，不能拿來結案。Exact trigger仍固定 `luna low`，**NEVER** 以 specific-row 出口改名繞過同一份工作。

Waiver enum 固定為 `claude-mcp-required`、`parent-context-required`、`governance-adjudication`、`ui-view-implementation`、`user-explicit-claude-agent`、`user-explicit-mainline`、`wording-contract-output`、`visual-design-review`、`safety-or-irreversible`、`self-verification`；沒有 `other` 或 free-text bypass。`claude-agent-dispatch` decision 只接受其中 `claude-mcp-required`、`parent-context-required`、`ui-view-implementation`、`user-explicit-claude-agent` 四種，避免拿治理／措辭／複驗理由替普通掃描開洞。`parent-context-required` 專給必須繼承主線 context 的 `subagent_type: fork`——它照樣 arm，只是結案理由是這一條，**NEVER** 讓它靜默略過 gate。一般 threshold decision 的 dispatcher exit `0`／`2` 會留下 terminal receipt 並 release；`claude-agent-dispatch` 的 Luna exit `2` 留 pending 並把下一次 model 鎖成 Sol，同 effort 的 Sol 再 exit `2` 後才接受 `delegate-escalation-failed` fallback receipt。exit `3`／`4` 都留 pending，分別只配 `dispatcher-mechanical-failure`／`quota-exhausted`。`fallback` 命令寫入的事件是 `fallback-authorized`：它只表示 runtime不可用後**允許** Claude接手，不宣稱 fallback工作已完成。Dry-run／exit `1` 不消費 decision。下一個 UserPromptSubmit 會把未結案 decision 記為 orphan，再開始新 segment。

Enforcement authority 是 `~/.claude/clade-routing-gate/receipts.jsonl`；`~/.pi/agent/clade/dispatch-ledger.jsonl` 是現行 fail-open usage／observability telemetry，legacy `~/.codex/dispatch-ledger.jsonl` 只供歷史報表，**NEVER** 用 telemetry 缺列推翻已成功落盤的 receipt。每次 live判定會先用 unique receipt重建 `latestAttempt`，並把單一 terminal receipt materialize回 stale state；同 `eventId`重播是 benign，兩個不同 terminal resolution與未完成的 orphan segment transition會 fail-closed。這使 receipt-first／state-second 的 crash window可恢復，不會重跑已成功的 Pi dispatch。

Fail-open／fail-closed 邊界以 helper是否在 Claude Code外層 deadline內回傳為準：segment identity 尚未初始化、中央 helper缺件時 diagnostic fail-open；state 一旦建立，helper回傳的 corrupt state、lock／atomic write／receipt failure、session／row／model／effort mismatch一律 fail-closed。Claude Code外層 command hook timeout或 helper根本無法啟動時，hook output會被丟棄並回到正常 permission flow，仍是 residual fail-open；正常 permission flow **不等於**無條件 auto-allow。事後結案跑 `node scripts/audit-pi-adoption.ts`；usage report不讀 receipt。

**`--route` 必填**（缺就 exit 1，2026-08-12 起）。它是成功指標的分母——`route=claude-delegate-sub`
的 dispatch 中 luna 佔比。填法：走本檔 § Routing Table 某一列 → `routing-table`；走 § Claude 委派的
model 檔位 轉派 → `claude-delegate-sub`；走 § 配額耗盡時的 fallback 紀律 → `fallback-chain`；
以上皆非的臨時派工 → **顯式**帶 `manual`。**NEVER** 因為不確定就一律填 `manual`——那讓分母恆為 0，
正是 2026-08-12 全天 11 筆 dispatch 全落 `manual`、政策無法覆核的成因。

**`--tier-basis` 必填**（缺就 exit 1，2026-08-13 起）。`--route` 解掉的是「這筆走哪條政策」，
本欄解掉的是「那條政策對 model 的結論有沒有被執行」——兩者不可互相推導，`routing-table` 底下
既有 sol 列也有 luna 列。六個值：

| 值 | 用在 | 對 `--model` 的約束 |
| --- | --- | --- |
| `table-row` | [[agent-routing]] § Routing Table 該列已列明檔位，照列派 | **MUST 再帶 `--table-row <列名>`**，約束由該列列明的 model 決定 |
| `five-conjunct` | 該表類別內**自行**降檔，五條連言全中 | 必須 `gemini` |
| `adjudication` | 需裁決 → 不降，回 sol | 必須 `sol` |
| `delegate-sub` | § Claude 委派的 model 檔位 轉派 | 必須 `gemini`（exit 2 升 sol；exit 4 回 luna） |
| `quota-fallback` | § 配額耗盡時的 fallback 紀律 | 無（降級鏈決定） |
| `manual` | 臨時手動派工 | 無 |

dispatcher 會把 `--tier-basis` × `--model` × `--route` 交叉檢查，自相矛盾的組合當場 exit 1
（宣告 `five-conjunct` 卻派 sol、宣告 `adjudication` 卻派 luna、`route` 與 basis 對不起來）。
**NEVER** 改宣告去遷就已經打好的 `--model`——判準變了就換一個 basis，那是兩件不同的事。

`table-row` 的 `--table-row <列名>` **同樣缺就 exit 1**（2026-08-13 起）。列名是 [[agent-routing]]
§ Routing Table 每列開頭 〔`如此標示`〕 的 slug，dispatcher 拿該列列明的 model 交叉檢查。
**NEVER** 略過它：`table-row` 原本是六個值裡唯一對 model 零約束的，於是宣告它成了**查表姿勢做足、
派哪個 model 都不受檢查**的最省力路徑——2026-08-13 `v1-annual-leave-scan` 命中 `read-heavy-scan`
列（該列列明 luna）卻派 sol，`--tier-basis table-row` 照樣通過。說不出列名 = 沒查表，**MUST** 換一個
basis，**NEVER** 隨手挑一個列名湊過去。

重試前一筆時 **MUST** 帶 `--retry-of <被重試的 label>`，**NEVER** 用 `<label>2` / `<label>3` 這種
命名法表達重試——命名慣例不是資料，事後判不出是否命中「luna 回 exit 2 → 升 `sol` 重派一次」。
`--tier-basis delegate-sub` 配 `--model sol` 就是靠這個欄位才合法（它是那條升檔規則的唯一出口），
沒帶 `--retry-of` 一律 exit 1。

**Template registry**（對照表與各 template 的必填 var 見 `~/offline/clade/vendor/snippets/pi-offload/README.md`）：

| Template | 場景 | 建議 effort |
| --- | --- | --- |
| `fanout-analyze` | 蒐集命令清單派工前能列全時的 fan-out：主線跑完命令，只派分析（必填 `evidence`） | low |
| `fanout-collect` | 蒐集命令清單派工前**無法**列全（命令 N 的對象取決於 N-1 輸出）的掃描 / 驗證型 fan-out | low |
| `read-heavy-scan` | 長文件 / fleet 多 repo 掃描摘要 | low |
| `debug-evidence` | debug 拆段：log capture / repro / hypothesis 驗證矩陣 | high |
| `fix-verify-loop` | commit 0-C：跑 check → 機械修 → loop 到全綠 | high |
| `self-collect-evidence` | spectra-apply Step 8a (a)(b)：dev-login allow-list + DB query evidence | medium |

**Exit code 契約**（caller 必須分流，不可一律 fallback）：

- `0` — 跑完且 result 可解析：讀 stdout JSON 的 `result` 續流程
- `2` — pi 跑完但業務 fail（`result.status === 'fail'`）：**NEVER** 換 Claude 重做同 brief（同 brief 同樣會撞）、**NEVER** 原樣重派；依 result 內容決定修補或上報
- `3` — 機械故障（pi 不存在 / spawn error / timeout / 無 parseable JSON）：唯一允許 Claude fallback 的情形，且 MUST 留下可審計痕跡（per 各 skill 對應段）
- `4` — quota 擋，**兩種來源同一個 code**：派工前的 gate（primary used_percent > 85），或 pi **跑到一半**回報 usage limit（pre-gate 讀的是上一個 session 的快照，window 在那之後被吃滿、或 rate_limits 讀不到而 fail-open 放行時就會這樣）。後者的 payload 帶 `detected: 'runtime'` 與 `resets_at_human`（pi 給的是散文日期不是 epoch）。處置相同：非急件延後到下一個 window、依 `next_tier` 換 tier；急件 `AskUserQuestion` 讓 user 拍板（`--no-quota-check` 強派）
  - **`3` 與 `4` 的下一步相反，NEVER 混用**：`3` 是「這次壞了，可以再試」，`4` 是「這個 window 內都別再試」。mid-run 撞配額若被報成 `3`，每一輪都會再燒一次 dispatch 去重新發現同一件事（2026-08-06 實測：配額 reset 在三天後，而輸出寫的是 `no parseable JSON`）

**內建行為**：Pi `--no-session --no-extensions` machine mode、explicit MCP extension、token discipline system prompt、routing metadata validation、telemetry append 到 `~/.pi/agent/clade/dispatch-ledger.jsonl`（fail-open；`scripts/audit-pi-adoption.ts` 靠它量 adoption）。Pi目前沒有authoritative pre-dispatch quota snapshot，因此precheck明示unavailable並fail-open；runtime quota仍固定映射exit 4。

**Token discipline 是 runtime 內建，template / brief NEVER 各自重寫一份**：`vendor/pi/system/token-discipline.md`（codebase-memory 優先於 grep ＋ rtk 包裹重輸出指令）由 `runPi()` 以 `--append-system-prompt` 附掛到**每一發**有工具的 dispatch，四個入口（`pi-dispatch.ts` / `pi-dispatch-screenshot-verify.ts` / `pi-dispatch-pre-handoff-check.ts` / `pi-review.ts`）一致生效，`toolProfile: 'none'` 除外。主線 Claude 是靠 harness 的 SessionStart hook 與 Bash 改寫 hook 拿到這兩條，**Pi 上沒有等價機制**——2026-08-19 實測：全歷史 dispatch 3415 次 bash 只有 460 次走 rtk，同時仍有 raw `git` 657、`ls` 229、`pnpm` 143。

**readonly profile 的 `--tools` allowlist MUST 含 codebase-memory 工具名**：pi 的 allowlist 同時作用於 built-in、extension 與 MCP 工具，所以 `review-readonly` / `analysis-readonly` 少列 `mcp_codebase_memory_*` = MCP extension 載了也一次都叫不到（2026-08-19 實測：`commit-0a1-review-r61` 整輪只有 `read`）。清單在 `CODEBASE_MEMORY_READONLY_TOOLS`（`vendor/scripts/lib/pi-runtime.ts`），`index_repository` 刻意不在列。

**`--output-schema`**：codex 0.138+ 支援以 JSON Schema 約束最終回覆。新 dispatch 場景**預設提供 schema 檔**，取代脆弱的「stdout 結尾 JSON 摘要」約定；既有 dispatcher（screenshot-verify / pre-handoff-check）維持現行契約不回頭改。

**Watch**：dispatcher 屬「主線直接 Bash 派」路徑；取得 `<task-id>` 後，同一 turn 記錄 owner / deadline 並排單一 1500–1800s `ASYNC_KEEPALIVE_CONTROL` inert safety net（見下方 § 監看排程）。控制 turn 只准查 task status與 lifecycle 分流，**禁止** 180s 短輪詢、讀 output tail或重播原 dispatch。

## Pi Watch Protocol（防止主線乾等與卡住盲區）

**核心命題**：派出 pi 後**主線不能單純等 `<task-notification>`**。pi 中途可能 `fetch failed`、sandbox 拒絕、互動 prompt、或長時間靜默；若沒有監看，主線完全不知道進度，使用者也只能空等。

### 跨 sandbox 可見度約束 v2

適用於**判定不是自己派出的那些 pi 派工 的死活**——典型是主線想知道 `/wt` Form 3 / Form 4 的 worktree subagent 派出的 pi 派工 跑到哪了。

**NEVER** 用 `ps` / `pgrep` / `/proc` 判定不是自己派出的 pi 派工的死活。

理由**不是**「看不到」：**`ps` / `pgrep` / `/proc` 的輸出不承載租戶資訊**——**有**命中不代表目標活著（可能是探針指令自己那行 shell，或別 session 的同名進程），**沒**命中也不代表它死了（取樣截斷）。兩個方向都是零訊號，而三者外觀完全相同。2026-08-03 <consumer-b> `migrate-scrap-entry-into-shipment-form` 實測：主線用同一個 `ps` 探針對同一個目標連續三次判錯。

> 2026-07-03 廢除本節時寫的理由是「sandbox 隔離，主線**必然看不到**」。那句話在當前 harness 已被上述實測推翻（主線與 subagent 共用 `/proc`，看得到），但**結論不變**——看得到而分不出租戶，比看不到更危險：後者會讓人去找別的訊號，前者讓人拿著錯答案繼續走。

**判定死活只認自帶租戶鍵的訊號**：

| 情境 | 唯一合法訊號 |
| --- | --- |
| 這個 pi 派工 是**你自己**派的 | 你 `Bash(run_in_background)` 拿到的 **jobId** —— `BashOutput(<jobId>)` 與 `<task-notification>`。**NEVER** 改用 `ps` 文字比對認領：pi 的 argv 不含 tenant 欄位 |
| 這個 pi 派工是**別層**派的（主線看 worktree subagent 的 pi 派工） | 訊號本身含**本次 change / phase 的 slug** 才合法：`/tmp/pi-phase-*-stdout.log` 這類含 slug 的落檔、worktree 的 `git log` 是否長出 `🧹 chore: wt <change>-phase-<N>`、`tasks.md` 的 `[x]` count。**process table 不含 slug，故永不合法** |

**判準一句話：訊號合法 ⟺ 訊號本身認得出這是哪一個 change / phase 的 pi 派工。**

問進度要 `SendMessage({to: <agent-id>})` 讓該編排者在自家 sandbox 回報，**NEVER** 自己去掃 process table 替它回答。

上述檔案訊號只在使用者主動問進度、或 completed result 需要 cross-check 時讀；generic async keepalive safety net **NEVER** 讀它們。安全網只查 harness task 狀態，理由見下方 § 監看排程。

> 歷史 pitfall：`docs/pitfalls/2026-05-18-subagent-background-bash-invisible-from-main-ps.md`（v1 的「看不到」形狀）。v2 的「看得到但分不出租戶」形狀見 `pitfall-wt-form3-resurrects-banned-subagent-codex-path`。

### 監看排程（notification-only）

Pi 由**該層編排者**在其自身 sandbox 內直接 Bash `run_in_background` 派出（薄中介仍全面禁止，per `agent-routing.md` § Dispatch 入口）。因此 watch 只有一條路徑：notification-only —— 主線派的由主線 watch，Form 3 / Form 4 worktree subagent 派的由該 subagent watch，**每一個編排者都對自己派出的 pi 跑完整本節流程**。

`<task-notification>` 與 BashOutput 在**派出它的那個 sandbox** 內可靠；常見失敗（`fetch failed` / auth）= job **exit** → background bash 完成 → 通知**立刻**觸發。等通知期間該編排者 idle = 零 turn = 零 cache_read。

| 時機 | 動作 |
| --- | --- |
| 派出後**立刻** | **不**下短輪詢。記下 background Bash `taskId`、`owner=pi-watch` 與有限 deadline，下一個 1200–1800s safety net 使用 [[agent-routing]] § Generic async keepalive prompt 的 canonical control message |
| 收到 `<task-notification status=completed>` | 停 wakeup，先以 task id claim；claim 成功才 BashOutput 讀 stdout → cross-check → 回報 |
| 安全網 fallback 觸發（仍沒收到通知） | 只依 `TaskOutput(block=false)` 走 canonical control 分流：terminal 才停 wakeup、claim 並排 `ASYNC_LIFECYCLE_HANDOFF task=<id> owner=pi-watch cause=terminal`；running 到 deadline 或未知狀態保留 pending ownership，改排 `ASYNC_DEADLINE_INTERVENTION`，**不得**收割或重派 |

> **為什麼安全網用長間隔而非 180s**：notification-only 的常態是「主線 idle 等通知」= 零 turn。短輪詢會強制主線頻繁醒來重讀整段 context；安全網買的是 cache 存活與遺失通知兜底，不是 pi progress telemetry。
>
> 本證據決定：Pi safety net 可用長 interval，但不得超過 cache-keepalive 上限。
> 本證據不決定：其他 async 路徑的 interval、deadline 或是否可查 task status。

### 安全網 control turn（hard boundary）

安全網 wakeup 的 allowlist 以 [[agent-routing]] § Generic keepalive 醒來只做控制面動作 為準：只可 `TaskOutput(block=false)`、重排 / 停 wakeup、排 handoff。**NEVER** 讀 BashOutput tail 判健康、執行原 pi 任務、或做任何 mutation。

`ASYNC_LIFECYCLE_HANDOFF` 與 native notification 只在 terminal 時共用 task-id claim；claim 成功的正常 turn 才讀 stdout / stderr、cross-check 並分類。stdout / stderr 命中 `fetch failed`、sandbox / permission / auth error、`request_user_input is not supported in exec mode` 或 blocker 語意 → 依 [[agent-routing.pi-input-intercept]] 與下方介入契約處理。

### 介入觸發

completed result 顯示阻塞、或 harness 明確回報 failed / cancelled 時：attended mode **MUST** 立刻用 `AskUserQuestion` 呈現至少 [重派 / 中止]；unattended / headless mode **NEVER** 問，改以完整 blocker 與選項 packaging，並安全結束該 path。`ASYNC_DEADLINE_INTERVENTION` 的 attended 選項可包含 [繼續等 / 中止]：選「繼續等」**MUST** 寫入新的有限 deadline，保持 `lifecycle=pending`，並重新 arm canonical inert control message；選中止則先 `TaskStop`，確認 terminal 才收割。**NEVER** 自行 kill 或調整 prompt。

permission classifier 另要求 specific shared-action consent 時，推薦選項的 description MUST 放完整具名範圍，選取即授權；**NEVER** 要 user 手打或貼完整授權句（SoT：[[agent-routing]] § Shared-action specific consent UX）。

### `ScheduleWakeup` 用法守則

Pi 一律由該層編排者直接 Bash 派 → notification-only，`ScheduleWakeup` 只用於 generic async keepalive 安全網：

| 情境 | 建議值 |
| --- | --- |
| **安全網 fallback（預設）** | **`1200`–`1800`**，prompt = canonical inert control message |
| harness task 仍 running | 以完全相同的 interval 與 inert prompt 重排 |

**180s 的具名例外（窮舉，其餘一律禁止）**：`commit` gate 0-A.1 的 Pi review、`dep-upgrade` outdated-mode 的 low-risk 升版 review。兩者的共同 predicate 是**主線在同一段時間跑並行軸、且結果一到就要接著用**——短 interval 買的是並行軸的銜接，不是 progress telemetry；prompt 仍 **MUST** 是 canonical inert control message，控制 turn 一樣不得讀 output。不在這份清單上的路徑用 `1200`–`1800`。

**禁止** `< 60`（runtime clamp 也會擋）。**上限 `3300`（MUST）**：這個 fallback 同時承擔 [[agent-routing]] § 主線靜默上限 的 cache-keepalive 職責，所以 pi 路徑**不**另外排第二個 wakeup，也 **NEVER** 拉長到 3300 以上。

`reason` 欄位**必須**具體描述 control 對象，例如「kiosk-multilingual pi keepalive」，**NEVER** 寫「waiting」「monitoring pi」這種空泛字眼；原任務內容只留在已存在的 background task，NEVER 複製進 wakeup prompt。

### 與「不要把工作往後放」禁令的關係

全域 CLAUDE.md 規定**禁止**把工作排到未來（不主動推薦 `/schedule`、`/loop`、「N 週後再做」）。本 protocol 的 `ScheduleWakeup` 屬於**主動監看**，不是延後工作 — 它存在的目的是**縮短**「主線發現問題的時間」，不是把責任往後推。兩者方向相反，**不衝突**。

判別準則：

- 合法用途 → 派出 background job 後維持 harness task lifecycle、遺失通知兜底與既有結果收尾
- 仍禁止 → 把當下可處理的事推遲到未來、為「等使用者反應」排 follow-up、用 schedule 填充看似貼心的提醒

### 監看期間的紀律

- **NEVER** 在 wakeup control turn 中跑探索動作（grep / 額外 Read / 開新 subagent）或原任務 — 只做 harness lifecycle control
- **NEVER** 在 watch 中途自行決定殺掉 / 重派 pi — completed result 顯示 blocker 後必須先 AskUserQuestion
- **MUST** 收到 `<task-notification>` 或收割到 completed result 後停止 ScheduleWakeup（否則 wakeup 會在 pi 已結束後重複觸發）

## Spectra Routing Table

從 [[agent-routing]] § Routing Table 移出（2026-07-31）——這五列只在 spectra flow 內成立，主檔留一列 stub 指這裡。**UI view phase 與 Design Review 都永不外派（主線 Opus 5 xhigh 自己做）**、**propose 的 cross-check / final check 一律主線跑**這兩條契約主檔仍帶著。

**派工時 `--table-row` 要填哪一列**：本節的類別名不是 row 名。裸 `--table-row spectra` 在 `TABLE_ROW_POLICIES` 是 `model: null`（因為下表五列檔位各異，一個 row 表達不了），dispatcher 一律拒絕。對照表：

| 本表類別 | `--table-row` |
| --- | --- |
| propose draft（選項 A / B 的 pi 段）、ingest draft | `spectra-artifact-draft`（sol max） |
| apply 非 view phase | `spectra-phase-implementation`（sol high） |
| apply 已封閉 phase 的 read-only 抽取 | `spectra-phase-prescan`（gemini low） |
| pre-handoff E.1 收集 | `spectra-prehandoff-collect`（grok-xai medium） |
| pre-handoff E.1 判定 | `spectra-prehandoff-judge`（sol xhigh） |

主線 cross-check / final check / Design Review **不派 pi**，沒有對應 row。`test/table-row-recipe-audit.test.ts` 機械驗證 clade 內所有 recipe 與本表一致。

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Spectra `propose` 階段（draft）** | **使用者選單三選一**：A Pi GPT-5.6-sol max draft（預設/推薦）／ B 三模型交叉：Claude Fable 5 xhigh draft ＋ Pi GPT-5.6-sol max review／ C 純 Claude | 預設跳三選一選單；使用者明確指定路徑時跳過。詳見 `spectra-propose` Step 0。 |
| **Spectra `propose` cross-check / final check** | **主線 Claude Fable 5 xhigh** | 主線 = quality gate（A 的 cross-check、B 的 final check 都由主線跑），不只是 dispatcher。 |
| **Spectra `apply`（非 Design Review、非 UI view phase，phase 粒度）** | **Pi GPT-5.6-sol high** | medium 漏 schema drift 風險高；phase 粒度避免 round-trip。 |
| **Spectra `apply` UI view phase（component / page / view / layout / styling）+ Section 7（Design Review）** | **主線 Claude Opus 5 xhigh 自己做，永不派 pi**（UI view 實作與 Design Review 都是；實作完主線照跑 Step 6c / 6d 與 Design Review gate） | 視覺 / 互動 / a11y 與 Design skill 緊耦合，實作與品質判定分不開。非 view 的 frontend 不在此範圍，仍走 sol（範圍同 § Spectra Apply Phase Dispatch C 類）。 |
| **spectra-apply Step 8a self-collect (a)(b)**（dev-login allow-list 小 mod + service_role DB query 證 data shape） | **Pi `--model sol --effort low` via 泛用 dispatcher** | PoC 已實證 pi 能跑完整 evidence chain；annotation 寫回 tasks.md 維持主線。詳見 spectra-apply SKILL Step 8a。 |

## Orchestration Residency — 機械 Enforcement（residency-classify + archive-gate Check 8）

從 [[agent-routing]] § Orchestration Residency 移出（2026-07-31）。Residency 的**判定條件**（Codex-primary A/B 進入條件、Claude-primary 五條）留在主檔；本節是它的機械強制步驟，只在 spectra-apply 開工時用得到。

**為什麼**：該節上線 6 天實測（2026-06-11 audit），eligible change 採用率僅 1/3 — 兩條純非-view change 仍由主線自做、0 dispatch。文字規約對 routing 自律無效，故比照 Check 7 / E.1 先例補機械強制點。

- spectra-apply 開工後、任何 dispatch 決策前，**MUST** 跑 `node ~/offline/clade/vendor/scripts/residency-classify.ts classify --change openspec/changes/<change>` 拿機械 verdict
- **MUST** 立刻 record decision：`node ~/offline/clade/vendor/scripts/residency-classify.ts record --consumer-path . --change <change> --verdict <v> --executor <codex|claude> [--reason ...]` → 落 `.spectra/residency-ledger.jsonl`
- verdict=`codex-primary` 而決定 executor=`claude` → `--reason` 必填（record 入口會擋）
- archive-gate **Check 8** 機械驗 record 存在：缺 record → archive exit 2；正當例外加 `<!-- residency-decision: intentional, reason: ... -->` 到 tasks.md 繞過
- adoption 量測：`node ~/offline/clade/scripts/audit-pi-adoption.ts`（clade home 稽核：verdict × executor 表 + dispatch ledger 分桶）

## Spectra Propose Handoff（具體做法）

### 決策層契約（2026-08-19 從 [[agent-routing]] 下推，TD-540）


1. **MUST** 預設跳三選一 dispatch 選單（A Pi draft + 主線 cross-check／B 三模型交叉：Fable draft + Pi review + 主線 final check／C 純 Claude）。使用者**明確**指定路徑（「純 Claude propose」「不要派 pi」「用 Fable」「用 pi」等）時跳過選單直接走。詳見 `spectra-propose` Step 0
2. **MUST** 主線是 quality gate — A 的 cross-check 與 B 的 final check 都由主線 Fable 5 xhigh 跑
3. **NEVER** 把 cross-check / final check 的修補丟回 pi — 主線自己 Edit 修

Claude Code session 收到 spectra propose 請求時：

1. **NEVER** 用 AskUserQuestion 問 A/B（除非使用者**明確**要求「純 Claude propose」或「不要派 pi」）
2. **MUST** 預設走「Pi draft + 主線 cross-check」流程：
   1. 主線解析 change name + requirement
   2. 派 background pi GPT-5.6-sol max draft（走「Pi 派工的標準流程」）
   3. 收到 `<task-notification status=completed>` 後，主線 **MUST** 依序：
      - Read pi 產出的 proposal.md / design.md / tasks.md
      - 跑 `bash scripts/spectra-advanced/post-propose-check.sh <change>`（檢查 User Journeys / Affected Entity Matrix / Implementation Risk Plan / Design Review 7 步）
      - 跑 `bash scripts/spectra-advanced/design-inject.sh <change>`（若 UI scope，提醒 7 步 template）
      - **若 Design Review section 缺**：主線**自己**直接 Edit tasks.md 補完整 7 步 template（**不要**回 pi 修，太慢）
      - 跑 `spectra analyze <change> --json` 確認無 Critical/Warning
   4. 結束後 `spectra park <change>`，回報 artifacts list + cross-check 結果
3. **MUST** 主線是 quality gate — 不要把所有事推給 pi 後直接結束

詳細流程見 `plugins/hub-core/skills/spectra-propose/SKILL.md` Step 0。

## Spectra Apply Phase Dispatch（具體做法）

### 決策層契約（2026-08-19 從 [[agent-routing]] 下推，TD-540）


> **先判 residency**（§ Orchestration Residency）：符合 Codex-primary 進入條件 → change 粒度單次 dispatch + notification-only，**不要**逐 phase 派工；以下限 **Claude-primary** 場景。

執行 `spectra-apply` 時 phase 粒度派 pi。**三條契約**：

1. **Design Review phase 與 UI view phase 一律主線 Opus 5 xhigh 自己做，永不外派**——**NEVER** 派 Pi 任一 model，**NEVER** 派 Claude subagent，**NEVER** 因為 phase 大、時間晚、管線現成就轉派（UI view 實作完主線照跑該 phase 的機械檢查與 Design Review gate）。其他 phase（schema / migration / API server / CLI / 純 backend / 非 view 的 frontend / unit test / docs）以泛用 dispatcher 的 `spectra-phase-implementation` row 派 background Pi Sol high；**每一個**符合封閉來源 extraction predicate 的 prescan 才可另走 `spectra-phase-prescan` Gemini low，且不得取代 Sol 實作
2. **混雜 phase**（同一 phase 摻了 view 與非 view）：**已開工** → 主線整個 phase 自己做，不重切、不派 pi；**未開工** → **STOP** 請使用者跑 `/spectra-ingest <change>` 重切
3. **禁止**主線自行修改 tasks.md 的 phase 結構（屬 ingest 範圍）

A/B/C 三類的完整判定條件（含 view 層檔案路徑清單）與 C 類派工細節（共用 template／schema、dispatcher metadata、watch、drift 檢查、收尾驗證）見 reference § Spectra Apply Phase Dispatch（具體做法）。

執行 `spectra-apply` 時，phase 粒度派 pi 的具體 dispatch 步驟：

1. Read tasks.md，按 `## N.` 切分 phase
2. **每個 phase 三類分類**（依序判定，命中即停）：
   - **A. Design Review phase**：標題含 "Design Review" 或內容含 `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot`
     → **主線 Claude Opus 5 xhigh 自己做，永不派 pi**
   - **B. UI view phase**：phase 內任一 task 描述/路徑指涉 view 層檔案——`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且該 phase 沒有摻入非 view 的 frontend / backend 工作**（store / hook / API client / type / util / migration / API server）
     → **主線 Claude Opus 5 xhigh 自己做，永不派 pi**。實作完、該 phase commit / 標 done 之前，照跑 SKILL Step 6c / 6d 檢查與 Design Review gate
   - **C. 其他 phase**：上述兩類以外（schema、migration、API server、CLI、純 backend、frontend 但非 view 的 store / hook / API client / type / util、unit test、docs）
     → **派 background pi GPT-5.6-sol high 做完整 phase**
3. **混雜 phase fallback**（A、B 都不是純 view、又混雜 view 與非 view 工作）：
   - **看該 phase 是否已開工**（任一 task `[x]` 或 git history 顯示 phase 內檔案已被改）：
     - **已開工** → **主線整個 phase 自己做**（safety fallback；不重切，不派 pi）
     - **未開工** → **STOP**，回覆使用者：「phase `<N>. <title>` 同時混雜 UI view 與非 UI 工作，違反新版 Phase Dispatch 規則。請改跑 `/spectra-ingest <change>` 把 UI view tasks 與其他 tasks 切成獨立 phase 後再 `/spectra-apply`。」**禁止**主線自行修改 tasks.md phase 結構（這屬 ingest 範圍，避免 propose / apply 邊界混淆）
4. 每個 C 類（Pi）派工：
   - prompt **第一行 MUST** 是 `[DELEGATED-BY-CLAUDE-CODE]` marker（Codex 端 Runtime Gate 會驗，缺 marker 會被擋掉，見下節）
   - prompt 內容：phase 標題、該 phase 全部 tasks、相關 design.md / specs / tasks 段落、acceptance criteria、`spectra task done <change> <task-id>` 完成標記指令
   - prompt 內**MUST**附帶硬指令：「**禁止**修改 view 層檔案（`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`）；若 task 需要 view 層改動，回報 'view layer change required, defer to main thread' 並跳過該 task」
   - `<topic>=spectra-apply-<phase-id>`、`<cwd>=consumer repo root`、`-c model_reasoning_effort=high`
5. 收到 `<task-notification status=completed>` 後，主線 **MUST**（pi 已在 worktree 自 commit per § Commit Authorization）：
   - Read pi stdout 的 `PHASE_X_RESULT` + Plan section（事前公開的思路）
   - Read tasks.md 確認該 phase 所有 checkbox 已勾
   - **Phase boundary 對齊**：`git -C <wt> log main..HEAD --oneline` — confirm exactly one new commit per dispatched phase, format `🧹 chore: wt <change>-phase-<N> — ...`。多 commit / missing commit / format 不符 → **AskUserQuestion**：[1] 主線 squash pi 的多 commits / [2] `git -C <wt> reset --soft main` 退 staging 重派 / [3] 中止
   - **View-layer drift double-check**：pi 端 self-check 命中時應已 abort，主線此處再驗一次保險：
     ```bash
     git -C <wt> diff main..HEAD --name-only \
       -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' \
          'app/pages/**' 'app/components/**' 'app/layouts/**' \
          'pages/**' 'components/**' 'layouts/**' 'views/**'
     ```
     有任何 view 層 file 被 pi 動過 → **AskUserQuestion**：[1] `git -C <wt> reset --soft main` 退 staging + 主線剔除 view 改動 + 重派 pi / [2] 接受並依 § Spectra Apply Phase Dispatch B 類形狀由主線重跑該 view 改動 / [3] 中止
   - **Scope discipline cross-check**：`git -C <wt> diff main..HEAD --name-only` 對比 prompt 內 scope 宣告；超出範圍 → AskUserQuestion 處理
   - **Sanity check**（typecheck、相關 test）
   - 若有遺漏 → **AskUserQuestion**：[1] 主線在 worktree 內 commit 補丁 / [2] reset 重派 pi / [3] 中止
6. 全部 phases 完成後，主線**自己**跑 Section 7 Design Review（不派出去）

## screenshot-review Verify Mode Dispatch & Watch Protocol

**核心命題**：派出 `screenshot-review` agent 用 `mode: verify` 後**主線不能單純等回報**。Agent 在 agent-browser 內可能：撞 emptiness preflight、卡 selector、無限 retry、單一 long bash call 期間 SendMessage 叫不動。歷史案例（add-pass-fail-inspection-type）verify agent 跑 7 小時無回報 — 「乾等盲區」對 verify mode 跟對 pi 一樣致命。

Agent 端的對應規範（hard budget、checkpoint、fail-fast、progress.json schema）寫在 `plugins/hub-core/agents/screenshot-review.md` § Verify Mode；本節定義**主線派工 + 監看**規範。

### 派工 Brief 必含項（hard rule）

主線派 `screenshot-review mode: verify` **MUST** 在 brief 內列出：

1. `mode: verify`
2. Change name / dev server URL / screenshots 輸出路徑
3. 未勾 `[verify:auto]` items 清單（含 description、預期 expected behavior）
4. 對應實作檔案路徑（主線預消化過的）— **NEVER** 只丟 change name 讓 agent 自己 grep
5. **Hard budget: 60 min**（明示寫進 brief，agent 端 SKILL.md 也有但 brief 仍須提醒）
6. **Checkpoint cadence**：每完成 item 或每 15 min（取較短者）寫 `progress.json` + 跑一個 cheap tool call return main loop
7. **Fail-fast 條件**：登入失敗 / fixture 缺且無 plan / DOM selector 3 次找不到 / 單 item > 5min / click 後 DOM 連續 2 次無預期變化（詳見 `screenshot-review.md` § Fail-Fast 條件）
8. **單 Bash call ≤ 1 語義動作**（詳見 `screenshot-review.md` § 為什麼單一 long Bash call 會 break SendMessage）
9. **progress.json 路徑**：`screenshots/<env>/<change-name>/progress.json`
10. **回報格式**：每 item PASS / FAIL / UNCERTAIN + evidence（network / dom / screenshot path）

### Watch Protocol

派出後（無論 `run_in_background` true / false）主線 **MUST**：

| 時機 | 動作 |
| --- | --- |
| 派出後**立即** | 記下 `progress.json` 預期路徑 + 派工時間（ISO） |
| 每 15 min | Read `progress.json` — 這是讀靜態檔，不是 poll agent（不違反「do NOT poll agent progress」規則） |
| `progress.json` 連續 2 次無更新（30 min stale） | `SendMessage` 詢問進度 — 等下一個 checkpoint window |
| `progress.json` 連續 3 次無更新（45 min stale） | **AskUserQuestion**：[1] 繼續等 N 分 / [2] TaskStop 重派 / [3] 升級成 `[review:ui]`，**禁止**自決定 kill |
| 到 60 min hard budget | **AskUserQuestion**：[1] 繼續延 N 分 / [2] 接受 partial 結果（已 PASS items 寫 annotation，剩餘升級）/ [3] TaskStop |
| 收到 task-notification 或 agent 回傳 | 走既有結束流程，**不再** Read progress.json（避免在 agent 結束後重複觸發） |

### 健康判斷（每次 Read progress.json 必跑）

| 訊號 | 判定 | 下次動作 |
| --- | --- | --- |
| `last_update` 在 5 分鐘內 + `items_done` 有新增 | 健康 | 15 min 後再讀 |
| `last_update` 在 5 分鐘內 + 沒新增但 `items_in_progress` 變化 | 健康(推進中) | 15 min 後再讀 |
| `last_update` 超過 15 分鐘無更新 | 輕度可疑 | 立即 `SendMessage` 詢問 + 15 min 後再讀 |
| `blockers` 有新條目 | 阻塞 | 立即 `AskUserQuestion` 走升級流程 |
| `items_done` 含 `status: "UNCERTAIN(time-budget-exhausted)"` | 已超時自我中止 | 立即整理 partial 結果回報 user |

### 與 Pi Watch Protocol 的差別

| 軸 | Pi Watch | screenshot-review Verify Watch |
| --- | --- | --- |
| 進度來源 | completion notification；terminal / deadline handoff 才讀既有 result | `progress.json`（agent 主動寫盤） |
| 介入工具 | terminal / deadline handoff 後 `AskUserQuestion` | `SendMessage` 詢問 → `TaskStop` |
| Wakeup 機制 | `ScheduleWakeup` 1200–1800s 的 task-aware control wakeup（SoT：[[agent-routing]] § Generic async keepalive prompt） | 不一定需要 ScheduleWakeup — 主線在執行其他工作時主動 Read 即可；長時間無其他工作時可用 `ScheduleWakeup(900)` 標 progress.json 檢查 |
| Hard timeout | dispatch 時寫入 deadline；deadline handoff → AskUserQuestion | 60 min hard budget(agent 自我中止) + 45 min stale → AskUserQuestion |

### 必禁事項

- **NEVER** 派 verify mode 後不啟動 Watch Protocol — 重演 add-pass-fail-inspection-type 7 小時無回報的根因
- **NEVER** 自決定 TaskStop verify agent — 必須先 AskUserQuestion(除非 agent 已自我宣告 time-budget-exhausted)
- **NEVER** 把 progress.json read 想成 poll agent — 它是 read static file，agent 在另一條 loop 寫盤；不違反 polling 規則
- **NEVER** brief 漏掉 Hard budget / Checkpoint cadence / Fail-fast / 單 call ≤ 1 語義動作 — 缺任一條都會把 agent 推向歷史失控模式
- **NEVER** 把多個 verify item round-trip 包進同一個 Bash call（多個 `agent-browser` 命令串 `&&`）後派出去 — agent 端 SKILL 已明訂禁止，但 brief 內提供的範例 / 模板也不能違反

### Dispatcher provenance 機械 backstop（2026-08-11 起）

`pi-dispatch-screenshot-verify.ts` 每次成功收尾都往 `<consumer>/.spectra/verify-ui-dispatch-ledger.jsonl` 落一筆 receipt（`change` → `itemIds` → `ts` → `exit` → `ok`，**欄位順序固定**，Check 9 靠有序雙 literal grep 比對）。archive-gate Check 9 逐 `[verify:ui]` item 驗，四條 pass 條件擇一即可：對得上 receipt ／ annotation 帶 `UNCERTAIN(dispatcher-error)` ／ tasks.md 有 `<!-- verify-ui-dispatch: intentional, reason: … -->` ／ annotation 的 ISO 日期早於 gate 落地日（存量豁免）。都不中 → block（exit 2）。

- receipt 寫入是 **fail-closed**：寫不進去就吐 `UNCERTAIN(dispatcher-error)` 並 exit 1。**NEVER** 照 `appendDispatchLedger` 那條 telemetry ledger 的 fail-open 寫法——那會產生沒有人知道成因的 false negative
- **NEVER** 把 Check 9 的 onset 改成「receipt 檔存在才驗」：這個 gate 要抓的失敗模式就是「dispatcher 從未被呼叫」，那個世界裡 receipt 檔永遠不存在，fail-open 等於讓最壞情境永久靜默通過。存量豁免走**日期切點**，不走檔案存在性
- **邊界**：receipt 是主線可 append 的明文 jsonl。Check 9 擋的是 **drift**（忘了走 dispatcher），**NEVER** 是對抗性偽造。**NEVER** 拿 gate 通過宣稱 evidence 來源已被證實

## Codex `$spectra-apply` Runtime Gate

**核心命題**：`$spectra-apply` 在 Codex 端不允許由使用者直接觸發。Codex 進入 spectra-apply 流程**必須**是 Claude Code 主線派工的結果——Codex 是執行手，不是 quality gate。

### 為什麼擋

| 風險 | 說明 |
| --- | --- |
| 跳過 claim | Codex 直接跑容易略過 `work-claims.md` 規定的「先 claim 再做 active change」流程 |
| 跳過 Design Review 回收 | spectra-apply 的 Design Review phase 必須由主線 Claude Opus 5 自己做（見 `agent-routing.md` § Routing Table）；Codex 直接跑會把 Design Review phase 一起做掉，Design 品質降級 |
| 失去 cross-check | 主線是 quality gate（typecheck / git diff / tasks.md checkbox 確認）；Codex 直接跑沒人 cross-check |

### Marker 機制

主線派 Pi 跑 spectra apply phase 時，prompt **第一行 MUST 是 `[DELEGATED-BY-CLAUDE-CODE]`**（見上節 Spectra Apply Phase Dispatch Step 4）。

Codex session 收到 `$spectra-apply`（或任何要它執行 spectra-apply 流程的請求）時，**MUST** 第一件事檢查 prompt body 是否含 `[DELEGATED-BY-CLAUDE-CODE]` marker：

- **有 marker** → 正常執行 spectra-apply skill
- **沒 marker** → 立即 STOP、**不執行任何 `spectra` 命令**、不修改任何檔案，回覆使用者：

  > `$spectra-apply` 只能由 Claude Code 主線派工執行。請改在 Claude Code 跑 `/spectra-apply`(主線會自動把非 Design Review phase 派給 Codex 處理，並在 prompt 內加 `[DELEGATED-BY-CLAUDE-CODE]` marker)。

### 設計限制

純 prompt-level 自律 gate，不是硬鎖：

- 設計目標是擋「使用者沒想清楚就在 Codex 喊 `$spectra-apply`」這種非預期觸發
- 使用者本人若刻意把 marker 貼進 prompt 強行 bypass 是有意行為，不在這個 gate 設計範圍
- 真正的 hard enforce 需要動 spectra CLI 本身（驗 stdin/env），但 spectra 不在 clade 治理範圍

### 與其他 spectra 入口的關係

本 gate **只**作用於 `$spectra-apply`(最容易踩到 claim / Design Review 跳過坑的入口)。其他 `$spectra-*` 在 Pi 端的限制策略不在本節範圍——若未來發現類似問題，比照本節設計獨立加 gate。

## 配額耗盡時的 fallback 紀律（全文）

> 從 [[agent-routing]] 同名 § 下推（2026-08-19，TD-540）。always-load 側留 thin pointer ＋ payload
> 算不出來的三條 NEVER；**要新增或改動任何一跳 MUST 讀完本節**。

配額耗盡（exit 4）**MUST** 依工作原本的檔位走對應鏈，命中即停。**NEVER** 把 Sol 的活降成 Luna——那是拿修舊系統的座位去接 flagship 工作。

**適用範圍是所有 pi 呼叫點，不只 dispatcher 派工**——含 `/commit` 0-A.1 的跨模型 review gate（該 gate 的具體分支見 commit skill 的 gates.md § 0-A.1）。review gate 尤其吃這條：它的**存在理由**就是不能由主線同池模型自審，所以「撞額度就改派 Claude subagent 補位」形式上補了位、實質上讓 gate 變空。

**但 review gate 目前走不了 `-cursor` 這一跳**：TD-520 已確認 cursor 池的模型同 UID 且有 unrestricted Shell，而 review 的 prompt 內嵌待審 changeset。在拿到 OS 層隔離前，0-A.1 撞配額的處置是主線自 review ＋ 明示 gate 未達成 ＋ 登記待補，**不是**換池。這是「鏈的形狀正確、但這一跳對這個用途不安全」，不是降級鏈本身有問題。

限制範圍是餘下的兩個 `-cursor` 跳（`sol-cursor`、`luna-cursor`）；luna 鏈的 `grok-xai` 跳能不能承接 0-A.1 **尚未評估**，
**NEVER** 從「它不是 cursor」推論「review gate 可以走它」。

```
Sol      → sol-cursor（cursor/gpt-5.6-sol@272k）→ Opus 主線
Gemini   → luna → luna-cursor（cursor/gpt-5.6-luna@272k）→ grok-xai（xai/grok-4.6）→ Claude Haiku
Luna     → luna-cursor → grok-xai → Claude Haiku   # 第一手只在 Gemini hop 不可用時
Grok-xai → grok-cursor（cursor/grok-4.6）→ Claude Sonnet
```

**鏈上的每一跳都是換配額池，不是降檔。** 判準是那一跳有**獨立計量**的配額，不是「它是同一個 model」。

**`grok-cursor` 只在 grok 鏈出現，NEVER 接在 luna 鏈後面**（2026-08-19 Charles 拍板）。成因：Cursor 那一跳
經 Cursor API key 取用，計入 Ultra 方案的 **`Other Models`** bucket（2026-08-19 Charles 實測確認；
on-demand spending 已關，用完就是硬停），**不是**先前規約寫的「`composer + grok` 獨立閒置 bucket」。
`Other Models` 是 Claude / GPT / Gemini 共用的那個 $400 桶——**派一發 `grok-cursor` 就是從同一個桶裡
扣**，而訂閱內含、專給 Cursor Grok 與 Composer 的 `Cursor Models` bucket 走 API key 根本碰不到。luna 鏈的最後一個換池機會因此是 `grok-xai`（xAI OAuth，完全獨立），
再耗盡就進 Claude 終點。**NEVER** 從「grok 鏈還有 `grok-cursor` 這一跳」推論 luna 鏈也能用它。

**跨 model 家族的跳只有 luna 鏈有，是具名例外不是通則。** 新增跨家族跳 MUST Charles 逐鏈拍板，
准入三條連言是**申請門檻**，**NEVER** 由它自動導出（必要條件不是充分條件）；逐條判準與取證見
rationale § luna 鏈的跨家族跳。**sol 鏈第 2 條不中**，且 flagship 工作與 `spectra-phase-implementation`
的 NEVER 轉 grok 是**獨立 veto、不進連言協商**，那條 NEVER **含 fallback 路徑，配額耗盡不是豁免條件**。
sol 鏈維持兩跳，**NEVER** 跨去 grok、**更 NEVER** 降成 luna——「luna 鏈都插了」不是理由。

**終點的 Claude 檔位按鏈的「起點」對齊，不是按耗盡的那一格**：`grok-xai` 是兩條鏈共用的一格，
luna 起點 → 在這格就終止、接 `haiku`；grok 起點 → 續走 `grok-cursor`、耗盡才接 `sonnet`。
dispatcher 對 `grok-xai` 這格 required `--chain-origin`（**起點決定的是下一跳，不只是終點檔位**），
起點不可解時 `next_tier` 回 null 並明說 unresolved 而**不猜**。

**grok 接手 luna 鏈時的補償控制**：grok 有已取證的 fail-open（前置契約未滿足時自報 `status: pass`，
見 § Routing Table 的 `spectra-phase-implementation` 列）。dispatcher 對 `--route fallback-chain` 的 grok
dispatch 注入 fail-closed 段，要求回覆帶一行 `PRECONDITIONS_VERIFIED:`，**並機械檢查它在不在**——
自報 pass 但缺 attestation 一律改判 exit 2。prompt 側只是第一層（用 prompt 修「不遵守 prompt」是同構的），
機械檢查才是控制；主線收回時仍 MUST 實核 diff。**NEVER** 拿這條 fail-open 當「所以該退回 Claude」的理由，
**也 NEVER** 把 gate 改成「pass ∧ diff 空 → 改判」（scan／extraction 的空 diff 正是正確結果）。

**降 effort 不是降級鏈的一步**：配額按 **model** 記，Sol 撞 usage limit 時 `--effort low` 重試撞的是**同一個** limit。effort 分級是品質 / 成本維度，**NEVER** 拿它當配額耗盡的應對。

1. **Sol exit 4 → `--model sol-cursor` 換池**（`cursor/gpt-5.6-sol`，`--route fallback-chain --tier-basis quota-fallback --retry-of <sol-label>`）；**sol-cursor 再 exit 4 才回 Opus 主線**。record reason 含 `quota-exhausted`。**NEVER** `--model luna` 或 `--model gemini` 重試——換池不是降檔，降檔才是。
2. **Gemini exit 4／catalog 無 `gemini-3.7-flash`／OAuth 未就緒 → `--model luna --route fallback-chain --tier-basis quota-fallback --retry-of <gemini-label>`**。**NEVER** 靜默改用舊 Flash。Gemini origin 在 `resolveChainOrigin` 視為 luna-class（終點仍 Haiku）。
3. **Luna exit 4 → 換池到 Cursor**：`--model luna-cursor --route fallback-chain --tier-basis quota-fallback --retry-of <luna-label>`。這是同一檔智力、另一個配額池，不是降檔。
4. **luna-cursor exit 4 → `--model grok-xai --chain-origin luna`** 同 effort 重派（`--route fallback-chain --tier-basis quota-fallback --retry-of <luna-cursor-label>`）。**`--chain-origin` 在這格 MUST 帶**——`grok-xai` 是兩條鏈共用的一格，起點決定它耗盡後是終止還是續走 `grok-cursor`，不帶就判不出來。
5. **grok-xai exit 4（luna 鏈）→ 這條鏈到此為止**，才動 Claude subagent，且**只接 `haiku`**（顯式帶，per § Subagent 回報契約第 4 條），**NEVER** 升 `sonnet`。**NEVER** 在這裡續派 `--model grok-cursor`——那一跳只屬於 grok 鏈，理由見上方 `grok-cursor` 段。
6. **Grok 鏈自己的路徑**（`web-search` / `screenshot-review-verify` 兩列）：`grok-xai` exit 4 → `--model grok-cursor --chain-origin grok-xai` 重派一次；再 exit 4 才動 Claude subagent，且**只接 `sonnet`**，**NEVER** 降 `haiku`。
7. Claude 接走時 session 結尾 **MUST** 回報「本 session 因配額耗盡，由 Claude 執行 N 個本應外派的 change」；有 runtime reset 資訊再附上，沒有就明說 unavailable。
