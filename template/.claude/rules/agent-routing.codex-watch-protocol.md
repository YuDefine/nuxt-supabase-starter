---
description: Codex 派工的標準流程模板、Codex Watch Protocol、Plan-first / Git baseline declaration、$spectra-apply Runtime Gate、screenshot-review verify mode 派工與監看；apply 階段或派 codex 時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', 'scripts/spectra-advanced/**', '.claude/agents/**', '.claude/skills/spectra-*/**', '.claude/skills/commit/SKILL.md', 'screenshots/**/progress.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.codex-watch-protocol.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Routing — Codex / screenshot-review Dispatch & Watch Protocol

> Reference 檔。核心 routing 規則見 [`agent-routing.md`](./agent-routing.md)。本檔聚焦實際派 Codex / screenshot-review agent 出去時的標準流程模板、watch protocol、Plan-first / Git baseline declaration 硬指令、`$spectra-apply` Runtime Gate marker 機制。

## Codex 派工的標準流程（所有 routing 共用）

派 Codex 出去工作**一律走原生 `codex` CLI + background bash**——**禁止**任何 `codex:rescue` / `codex:setup` / `codex:codex-rescue` plugin 路線（已驗證無法使用）。

主線 Claude 自己派、自己等通知、自己讀檔回報，**禁止**叫使用者切到 Codex CLI、**禁止**「Stop here」純文字 handoff。

模板：

1. 用 **Write** 把指示寫到 `/tmp/codex-<topic>-<slug>-prompt.md`（prompt 太長不要 inline）
2. **Bash** tool（`run_in_background=true`）：

   ```bash
   cd <cwd> && codex exec \
     --model gpt-5.6-sol \
     --dangerously-bypass-approvals-and-sandbox \
     --skip-git-repo-check \
     -c model_reasoning_effort=<medium|high|xhigh> \
     < /tmp/codex-<topic>-<slug>-prompt.md 2>&1
   ```

   > ⚠️ `--dangerously-bypass-approvals-and-sandbox` 在背景非互動 codex 是**必要**的，不是偷懶 — codex `exec` 沒人可批准時，sandbox 為非 `danger-full-access` 的 MCP tool call 全部會被自動回 `user cancelled`（codebase-memory-mcp 等都會死）。Codex 官方文檔 `agent-approvals-security` 把這個 flag 與 `-s danger-full-access` 並列為「非互動信任環境」的標準寫法。**禁止**把它換回 `-s read-only` / `-s workspace-write` — 那會讓 codex 失去 MCP 能力（`approval_mode = "auto"` 在 `mcp_servers.*` 不是合法 codex config key，無法作為替代）。

3. 立刻簡短回報 bash job ID 給使用者
4. 立刻啟動 **Codex Watch Protocol**（見下節 § 監看排程）— notification-only（主線 idle 等通知，只下**一個** ~1500s 安全網 fallback 防罕見 hang-type 失敗）。**禁止**啟動每 3 分鐘短輪詢（無謂 turn 重燒 context）。**禁止**任何 subagent 中介 dispatch（per `agent-routing.md` § Dispatch 入口）
5. 收到 `<task-notification> status=completed` → 立刻 BashOutput 讀 stdout → 整理結果回報；watch loop 自然終止
6. **NEVER** 沉默等使用者來問進度

各 routing 的參數差異：

| Routing | `<topic>` | `<cwd>` | reasoning effort | 預期動作 | Plan-first | Commit Prohibition |
| --- | --- | --- | --- | --- | --- | --- |
| WebSearch | `websearch` | `/tmp` | `medium` | 純讀（搜尋網頁/查文件） | 否 | N/A（不寫檔） |
| Spectra propose（draft） | `spectra-propose` | consumer repo root | `xhigh` | 寫 spec/proposal 到 `openspec/changes/<change>/`（主線之後 cross-check） | **是** | **是** |
| Spectra apply phase（非 Design Review、非 UI view） | `spectra-apply-<phase-id>` | consumer repo root | `high` | 完成單一 phase 內所有 tasks，回報 tasks.md checkbox 狀態 | **是** | **是** |

> sandbox flag 統一使用 `--dangerously-bypass-approvals-and-sandbox`，不再分 `-s read-only` / `-s workspace-write`（在背景 codex 會擋 MCP）。「預期動作」由主線在 prompt 內陳述，靠 codex 自律。

### `codex review` 禁用（改用 `codex exec` + review prompt）

**NEVER** 用 `codex review --uncommitted`（或 `--base`、`--commit`）做跨模型 review。

**根因**：`codex review` 硬編碼 `workspace-write` sandbox，無法透過 `-c` 覆寫。此 sandbox 模式會讓 `~/.codex/config.toml` 註冊的 MCP server（如 `codebase-memory-mcp`）在 `list_projects` 呼叫永久 hang — MCP 進程寫回 response 但 sandbox 管線未正確傳遞。`codex exec --dangerously-bypass-approvals-and-sandbox`（`danger-full-access` sandbox）則完全正常。

commit 0-A 的標準入口是 `plugins/hub-core/scripts/codex-review-safe.sh`（封裝本節替代做法）。

**替代做法**：用 `codex exec` + review prompt 取代：

```bash
# 1. 收集 diff
git diff --cached > /tmp/codex-review-diff.patch
git diff >> /tmp/codex-review-diff.patch
git ls-files --others --exclude-standard | while read f; do
  echo "=== NEW FILE: $f ===" >> /tmp/codex-review-diff.patch
  head -200 "$f" >> /tmp/codex-review-diff.patch
done

# 2. 用 codex exec 跑 review
echo "Review the following uncommitted changes for bugs, security issues, and correctness problems. Output prioritized findings with severity [P1-P3], file path, and line range. If no issues, output 'No issues found.'

$(cat /tmp/codex-review-diff.patch)" | \
codex exec \
  --model gpt-5.6-sol \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  -c model_reasoning_effort=high \
  --ephemeral \
  --disable memories 2>&1
```

- 已驗證 MCP 全部正常（`list_projects`、`get_code_snippet`、`search_graph` 均 completed）
- review 一律走 `codex exec`；reasoning effort 用 `-c model_reasoning_effort=<level>` 指定

### Plan-first（寫 code 的派工必加）

派 Codex **寫 code / 改檔**（spectra-propose draft、spectra-apply phase）的 prompt **MUST** 內含以下硬指令（**WebSearch / review 用途的 `codex exec`（codex-review-safe.sh）不需要** — 它們純讀不寫）：

```
Plan-first（**MUST**）：
在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：
- **要動的具體檔案**（每條一行的相對路徑）
- **每個檔案打算做什麼變動**（一句話描述）
- **預期影響範圍**（typecheck / 測試 / 其他模組 / migration / runtime 行為）

Plan 寫完後**立刻**繼續執行，**不要**停下來等使用者或主線確認。Plan 的目的是讓主線 cross-check 你的判斷，不是 review gate；中途不要徵詢同意。
```

理由：codex 在背景非互動跑、主線只能事後讀 stdout 對齊判斷。沒有 plan 時主線只能從 `git diff` 反推「codex 為什麼這樣改」，cross-check 成本高且容易漏掉「codex 漏做某個檔」這類問題。Plan 等於事前公開思路，讓主線在收尾時用 plan vs. diff 對齊就能抓到漏網之魚。

### Brief 措辭紀律（4.8-aware，寫 code 派工必加）

GPT-5.5 與 Claude 4.8 都**字面遵守指令、不外推**（Anthropic prompt best-practices 對 4.8 的明示行為）。派工 brief（給 codex 的 prompt，或 fan-out subagent 的 thin brief）**MUST**：

1. **祈使動詞要「動手」**：寫「**實作** / **修改** / **產出到 `<path>`**」，**NEVER** 用「分析 / 看看 / 評估 / 建議」這類動詞——後者會被字面理解成「只讀不寫」，回來一份報告卻沒改檔。
2. **明寫套用範圍**：要對多個對象做同一件事時，**MUST** 點名範圍（「**每個** phase 都做，不只第一個」「`app/components/` 底下**全部** `.vue`」）。4.8 不會把「修 X」默默推廣到 Y/Z，範圍含糊就只做命中的第一個。
3. **禁止 hard-code 過測試**：brief **MUST** 含一條——「**NEVER** 為了讓 test 綠而 hard-code 回傳值、跳過邏輯分支、或改測試期望值遷就實作；test 必須驗真實行為，不確定就回報而非硬湊」。codex `high` 卡住時傾向 hard-code 騙綠燈。
4. **附驗收標準**：brief 結尾 **MUST** 列「完成判準」（哪個 test 綠、哪個 endpoint 回什麼、tasks.md 哪幾條 `[x]`），讓主線 cross-check 有客觀對齊點。

### Git baseline declaration（dirty working tree 派工必加）

派 Codex 寫 code 時若 working tree **不乾淨**——有 staged/unstaged 修改、untracked 新檔或新目錄——prompt **MUST** 內含 `## Git Baseline` section，明白告訴 codex 哪些 path 是**預期既有變更**、來源是什麼、不要因此停手。

Dirty working tree 有兩種來源，**兩種都要列進 baseline**：

1. **主線操作型**：主線剛跑 `/spectra-ingest` 完成的 artifacts、剛寫進 `docs/tech-debt.md` 的 TD-NNN entry、未 commit 的 ROADMAP/HANDOFF 更新
2. **自動 hook 型**：`pnpm install` postinstall hook 觸發 `hub:bootstrap` → `sync-to-agents` 自動把 main branch 的 clade 更新同步進 worktree，產生 LOCKED projection diff（`.claude/` / `.agents/` / `AGENTS.md` / `CLAUDE.md` / `.claude/scripts/`，檔頭有 `🔒 LOCKED — managed by clade` banner）。主線沒主動操作但 working tree 仍 dirty

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

派工視窗保護：若派 codex 期間預期會再跑 `pnpm install` / `pnpm hub:check` 等可能觸發 sync 的動作，**先在主線跑完讓 baseline 穩定**再派 codex；不要在 codex 跑的同時讓 hub:bootstrap 又撐出新 LOCKED diff，否則 codex 會再次按 scope discipline 停手。

理由：codex 內建 scope discipline——看到工作目標範圍外的修改會合理地停下來避免越權踩到別 session WIP。兩種 dirty 來源 codex 都觀念正確：(1) 主線剛跑完 ingest / propose / TD / handoff 後 working tree 自然 dirty；(2) `pnpm install` postinstall 自動觸發 hub:bootstrap 把 main 的 clade 更新拉進來。兩種都不告知就會逼 codex 走「未知既有變更 → 停手」路徑，回來再 round-trip 重派比 prompt 多寫兩行貴得多。**禁止**把這當「codex 觀念錯」處理——它觀念是對的，是主線 prompt 沒給 git baseline。

例外：

- review 用途的 `codex exec`（codex-review-safe.sh）與 WebSearch 不需要這段（review 的本質就是讀 dirty diff、WebSearch 純讀不動檔）
- 同一條派工 round-trip ≥ 2 次都因**同類 dirty** 停手（例：hub:bootstrap 反覆觸發 LOCKED projection 更新），且**剩餘工作是純 mechanical**（明確檔案 swap、< 5 行 edit），主線改自己做合理；但同步要 root-cause baseline 為什麼沒穩定（hub:bootstrap 重複跑？missing path？）並修，不是只把當下 task 收掉跳過教訓

### Commit Authorization（codex 派工 hard rule）

派 Codex **寫 code / 改檔** 時，prompt **MUST** 內含以下硬指令（**WebSearch / review 用途的 `codex exec`（codex-review-safe.sh）不需要** — 它們純讀不寫）：

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
- `--no-verify`（per [[commit]] hard rule，主線/subagent/codex 一視同仁；hook 擋住代表 phase 內容有問題，必須修而非繞）
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

   🧹 chore: wt <change-name>-phase-<N> — <一行說明 codex 做了什麼>

範例：`🧹 chore: wt consumable-po-link-phase-3 — admin PO entry page + handler + types`

Commit 完直接停手回報，**NEVER** 自己跑下一 phase。主線會在 commit 後做 phase boundary 對齊 + view-layer drift 再驗 + scope cross-check，再決定 [接受 / reset 重派 / 中止]。
```

理由：worktree 內的 commit 在 archive merge-back 階段會被 `git merge --squash` squash 進 main 的 working tree、再走 `/commit` 0-A `codex exec` review + 0-B Design Review + 0-C check 才進 main HEAD。所以 worktree 內 codex 自 commit **沒有跳過 review** 的風險（commit 在 squash 時就消失、不會留在 main history）。

仍 enforce 的 guardrail 純粹是 phase boundary 對齊（一 phase 一 commit、message format 機械化解析）+ drift 早攔截（codex 自驗比主線事後 reset 便宜）。Win：主線收到完工通知後直接 inspect → 派下一 phase，不必停下來做 staging。

例外：

- review 用途的 `codex exec`（codex-review-safe.sh）與 WebSearch 不寫檔，本節不適用
- 對 `claude` type subagent（如 `/spectra-ingest` 在 /wt 內派出的 wt subagent）規約相同（`🧹 chore: wt …` 前綴 + selective stage + self-check + hook 必跑），per worktree-default.md §5

## 泛用 Dispatcher（codex-dispatch.mjs）

**定位**：對已有 cookbook template 的派工場景，用 `~/offline/clade/vendor/scripts/codex-dispatch.mjs` 取代手組 prompt — 它把上面標準流程的固定成分（marker / flag 組 / stdin 餵 prompt / 無 pipe redirect / last-message JSON 解析）機械化成一個 node 呼叫，並內建手組 prompt 沒有的 quota check 與 telemetry。**template 已覆蓋的場景一律走 dispatcher；手寫 prompt 僅限 template 未覆蓋的新場景**（寫完若會重複用，回 clade 補 template）。

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.mjs \
  --template ~/offline/clade/vendor/snippets/codex-offload/templates/<name>.template.md \
  --var task='...' --var acceptance='...' --var git_baseline="$(git status --porcelain | head -20)" \
  --var allowed_paths='...' \
  --label <topic-slug> --effort <low|medium|high|xhigh> [--cwd <dir>] [--budget <分鐘>] \
  [--output-schema <schema.json>]
```

**Template registry**（對照表與各 template 的必填 var 見 `~/offline/clade/vendor/snippets/codex-offload/README.md`）：

| Template | 場景 | 建議 effort |
| --- | --- | --- |
| `fanout-collect` | mechanical 收集 / 掃描 / 驗證型 fan-out（取代 Claude subagent fan-out） | medium |
| `read-heavy-scan` | 長文件 / fleet 多 repo 掃描摘要 | medium |
| `debug-evidence` | debug 拆段：log capture / repro / hypothesis 驗證矩陣 | high |
| `fix-verify-loop` | commit 0-C：跑 check → 機械修 → loop 到全綠 | high |
| `self-collect-evidence` | spectra-apply Step 8a (a)(b)：dev-login allow-list + DB query evidence | medium |

**Exit code 契約**（caller 必須分流，不可一律 fallback）：

- `0` — 跑完且 result 可解析：讀 stdout JSON 的 `result` 續流程
- `2` — codex 跑完但業務 fail（`result.status === 'fail'`）：**NEVER** 換 Claude 重做同 brief（同 brief 同樣會撞）、**NEVER** 原樣重派；依 result 內容決定修補或上報
- `3` — 機械故障（codex 不存在 / spawn error / timeout / 無 parseable JSON）：唯一允許 Claude fallback 的情形，且 MUST 留下可審計痕跡（per 各 skill 對應段）
- `4` — quota 擋（5h window primary used_percent > 85）：非急件延後到下一個 window；急件 `AskUserQuestion` 讓 user 拍板（`--no-quota-check` 強派）

**內建行為**：`--ephemeral --disable memories`（memories 91MB 死循環地雷，恆關）、quota check（預設開）、telemetry append 到 `~/.codex/dispatch-ledger.jsonl`（fail-open；`scripts/audit-codex-adoption.mjs` 靠它量 adoption）。

**`--output-schema`**：codex 0.138+ 支援以 JSON Schema 約束最終回覆。新 dispatch 場景**預設提供 schema 檔**，取代脆弱的「stdout 結尾 JSON 摘要」約定；既有 dispatcher（screenshot-verify / pre-handoff-check）維持現行契約不回頭改。

**Watch**：dispatcher 屬「主線直接 Bash 派」路徑 → notification-only + 單一 ScheduleWakeup(1500-1800) 安全網（見下方 § 監看排程），**禁止** 180s 短輪詢。

## Codex Watch Protocol（防止主線乾等與卡住盲區）

**核心命題**：派出 codex 後**主線不能單純等 `<task-notification>`**。codex 中途可能 `fetch failed`、sandbox 拒絕、互動 prompt、或長時間靜默；若沒有監看，主線完全不知道進度，使用者也只能空等。

### ~~跨 sandbox 可見度約束~~ — 已廢除（2026-07-03）

**subagent 中介派 codex 已全面禁止**（`agent-routing.md` § Dispatch 入口）。codex 一律由主線直接 Bash `run_in_background` 派工，`<task-notification>` / BashOutput / `ps` 都在同一 sandbox 內可靠。

本節原先文件化的兩個失敗模式（false positive panic + false negative silent miss）正是禁止 subagent 中介的根據——消除路徑本身就消除了兩個失敗模式。

> 歷史 pitfall 保留供考古：`docs/pitfalls/2026-05-18-subagent-background-bash-invisible-from-main-ps.md`

### 監看排程（notification-only）

Codex **一律**由主線直接 Bash `run_in_background` 派工（**禁止** subagent 中介 dispatch，per `agent-routing.md` § Dispatch 入口）。因此 watch 只有一條路徑：notification-only。

`<task-notification>` 與 BashOutput 都在主線 sandbox 內可靠；常見失敗（`fetch failed` / auth）= job **exit** → background bash 完成 → 通知**立刻**觸發。等通知期間主線 idle = 零 turn = 零 cache_read。

| 時機 | 動作 |
| --- | --- |
| 派出後**立刻** | **不**下短輪詢。只下**一個**安全網 fallback：`ScheduleWakeup(1500, "codex <topic> <slug> 安全網檢查 — 預期靠 task-notification 收尾")`（~25 分） |
| 收到 `<task-notification status=completed>` | 立刻 BashOutput 讀 stdout → cross-check → 回報；後續 fallback 自然作廢（**不再** wakeup） |
| 安全網 fallback 觸發（仍沒收到通知） | BashOutput 讀 tail → 套「健康判斷」：健康/即將完成 → 再下一個 ~1500s fallback；阻塞/卡住 → 跳「介入觸發」 |
| 任何時點累計 ≥ 30 min 未完成 | **MUST** `AskUserQuestion` [繼續等 / kill 重派 / 中止] |

> **為什麼安全網用長間隔而非 180s**：notification-only 的常態是「主線 idle 等通知」= 零 turn。短輪詢（180s）會強制主線每 3 分鐘醒來重讀整段 context（重倉 ~270K/turn）——那正是要消除的負擔來源。直接 dispatch 的**常見失敗是 exit-type**（`fetch failed` / auth fail → codex 退出 → bash 完成 → 通知即時觸發，主線馬上讀錯誤 tail）；安全網 fallback 只防罕見的 **hang-type**（codex 卡住 never exit、never notify），25 分鐘醒一次足夠（一次 cache miss vs 每 3 分鐘一次 cache read，便宜得多）。

### 健康判斷（每次 wakeup 必跑）

讀 BashOutput tail，依末尾訊號決定下一步：

| 訊號 | 判定 | 下次 wakeup |
| --- | --- | --- |
| 末尾持續有新 `exec` 行、`succeeded in`、`tokens used` 或 diff 輸出 | 健康 | `180` 秒（3 分，cache 內；使用者要求上限） |
| 末尾出現 `Codex Report` 或 `tokens used:` 後無新行 | 即將完成 | `60` 秒（cache 內，便宜） |
| 末尾 60s+ 無新輸出（看 BashOutput timestamp） | 輕度可疑 | `120` 秒；連續兩次無輸出 → 視為卡住，跳「介入觸發」 |
| 末尾出現 `fetch failed` / `sandbox: rejected` / `Permission denied` / `EACCES` / 認證失敗 | 阻塞 | **立刻**跳「介入觸發」，不再 wakeup |
| 末尾出現互動 prompt（`Continue?`、`y/N`、`Press Enter`、`waiting for input`） | 異常（codex sandbox 不該有） | **立刻**跳「介入觸發」 |
| codex 自我宣告 blocker（「無法繼續」「需要使用者決定」「missing context」等） | 阻塞 | **立刻**跳「介入觸發」 |

### 介入觸發（用 AskUserQuestion）

偵測到阻塞或卡住時，**MUST** 立刻向使用者開問題，**禁止**自行 kill 或調整 prompt：

```
codex 跑了 N 分鐘，目前狀態：<一句話卡點>

末尾輸出（≤10 行）：
<tail>

要怎麼處理？
[1] 繼續等 N 分 — 主線再 wakeup 看一次
[2] kill <jobId> 後重派（請告知 prompt 要怎麼調整）
[3] 直接中止
```

選項數量與內容可依情境調整，但**必須**包含至少 [繼續等 / kill 重派 / 中止] 三類其中兩類。

### `ScheduleWakeup` 用法守則

Codex 一律由主線直接 Bash 派 → notification-only，`ScheduleWakeup` 只用於安全網 fallback：

| 情境 | 建議值 |
| --- | --- |
| **安全網 fallback（預設）** | **`1200`–`1800`**（超 cache TTL；這是「codex 死了卻沒發通知」的兜底，**不是** active watch） |
| 即將完成 / 等通知收尾 | `60`–`120`（cache 內） |

**禁止** `< 60`（runtime clamp 也會擋）。安全網 fallback 用 `1200`–`1800` 是正確的——不是 active watch，是 hang-type 失敗的兜底；用 180s 短輪詢反而把要消除的 per-turn 重讀加回來。

`reason` 欄位**必須**具體：例如「kiosk-multilingual codex 進度檢查（已派出 3 分）」，**NEVER** 寫「waiting」「monitoring codex」這種空泛字眼。

### 與「不要把工作往後放」禁令的關係

全域 CLAUDE.md 規定**禁止**把工作排到未來（不主動推薦 `/schedule`、`/loop`、「N 週後再做」）。本 protocol 的 `ScheduleWakeup` 屬於**主動監看**，不是延後工作 — 它存在的目的是**縮短**「主線發現問題的時間」，不是把責任往後推。兩者方向相反，**不衝突**。

判別準則：

- 合法用途 → 派出 background job 後監看其進度、卡住偵測、收尾通知
- 仍禁止 → 把當下可處理的事推遲到未來、為「等使用者反應」排 follow-up、用 schedule 填充看似貼心的提醒

### 監看期間的紀律

- **NEVER** 在 wakeup loop 中跑與監看無關的探索動作（grep / 額外 Read / 開新 subagent）— 監看就是監看
- **NEVER** 在 watch 中途自行決定殺掉 / 重派 codex — 必須先 AskUserQuestion
- **NEVER** 看到健康訊號就提早終止 watch loop（例如「應該快好了」直接放著） — 必須跑到收到 `<task-notification>` 為止
- **MUST** 收到 `<task-notification>` 後**不再** ScheduleWakeup（否則 wakeup 會在 codex 已結束後重複觸發）

## Spectra Propose Handoff（具體做法）

Claude Code session 收到 spectra propose 請求時：

1. **NEVER** 用 AskUserQuestion 問 A/B（除非使用者**明確**要求「純 Claude propose」或「不要派 codex」）
2. **MUST** 預設走「Codex draft + 主線 cross-check」流程：
   1. 主線解析 change name + requirement
   2. 派 background codex GPT-5.5 xhigh draft（走「Codex 派工的標準流程」）
   3. 收到 `<task-notification status=completed>` 後，主線 **MUST** 依序：
      - Read codex 產出的 proposal.md / design.md / tasks.md
      - 跑 `bash scripts/spectra-advanced/post-propose-check.sh <change>`（檢查 User Journeys / Affected Entity Matrix / Implementation Risk Plan / Design Review 7 步）
      - 跑 `bash scripts/spectra-advanced/design-inject.sh <change>`（若 UI scope，提醒 7 步 template）
      - **若 Design Review section 缺**：主線**自己**直接 Edit tasks.md 補完整 7 步 template（**不要**回 codex 修，太慢）
      - 跑 `spectra analyze <change> --json` 確認無 Critical/Warning
   4. 結束後 `spectra park <change>`，回報 artifacts list + cross-check 結果
3. **MUST** 主線是 quality gate — 不要把所有事推給 codex 後直接結束

詳細流程見 `plugins/hub-core/skills/spectra-propose/SKILL.md` Step 0。

## Spectra Apply Phase Dispatch（具體做法）

執行 `spectra-apply` 時，phase 粒度派 codex 的具體 dispatch 步驟：

1. Read tasks.md，按 `## N.` 切分 phase
2. **每個 phase 三類分類**（依序判定，命中即停 — 詳見 `agent-routing.md` § Spectra Apply Phase Dispatch 決策層 A/B/C 三類定義）
3. **混雜 phase fallback**（A、B 都不是純 view、又混雜 view 與非 view 工作）：
   - **看該 phase 是否已開工**（任一 task `[x]` 或 git history 顯示 phase 內檔案已被改）：
     - **已開工** → **主線整個 phase 自己做**（safety fallback；不重切，不派 codex）
     - **未開工** → **STOP**，回覆使用者：「phase `<N>. <title>` 同時混雜 UI view 與非 UI 工作，違反新版 Phase Dispatch 規則。請改跑 `/spectra-ingest <change>` 把 UI view tasks 與其他 tasks 切成獨立 phase 後再 `/spectra-apply`。」**禁止**主線自行修改 tasks.md phase 結構（這屬 ingest 範圍，避免 propose / apply 邊界混淆）
4. 每個 C 類（codex）派工：
   - prompt **第一行 MUST** 是 `[DELEGATED-BY-CLAUDE-CODE]` marker（Codex 端 Runtime Gate 會驗，缺 marker 會被擋掉，見下節）
   - prompt 內容：phase 標題、該 phase 全部 tasks、相關 design.md / specs / tasks 段落、acceptance criteria、`spectra task done <change> <task-id>` 完成標記指令
   - prompt 內**MUST**附帶硬指令：「**禁止**修改 view 層檔案（`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`）；若 task 需要 view 層改動，回報 'view layer change required, defer to main thread' 並跳過該 task」
   - `<topic>=spectra-apply-<phase-id>`、`<cwd>=consumer repo root`、`-c model_reasoning_effort=high`
5. 收到 `<task-notification status=completed>` 後，主線 **MUST**（codex 已在 worktree 自 commit per § Commit Authorization）：
   - Read codex stdout 的 `PHASE_X_RESULT` + Plan section（事前公開的思路）
   - Read tasks.md 確認該 phase 所有 checkbox 已勾
   - **Phase boundary 對齊**：`git -C <wt> log main..HEAD --oneline` — confirm exactly one new commit per dispatched phase, format `🧹 chore: wt <change>-phase-<N> — ...`。多 commit / missing commit / format 不符 → **AskUserQuestion**：[1] 主線 squash codex 的多 commits / [2] `git -C <wt> reset --soft main` 退 staging 重派 / [3] 中止
   - **View-layer drift double-check**：codex 端 self-check 命中時應已 abort，主線此處再驗一次保險：
     ```bash
     git -C <wt> diff main..HEAD --name-only \
       -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' \
          'app/pages/**' 'app/components/**' 'app/layouts/**' \
          'pages/**' 'components/**' 'layouts/**' 'views/**'
     ```
     有任何 view 層 file 被 codex 動過 → **AskUserQuestion**：[1] `git -C <wt> reset --soft main` 退 staging + 主線剔除 view 改動 + 重派 codex / [2] 接受並由主線自己重跑該 view phase / [3] 中止
   - **Scope discipline cross-check**：`git -C <wt> diff main..HEAD --name-only` 對比 prompt 內 scope 宣告；超出範圍 → AskUserQuestion 處理
   - **Sanity check**（typecheck、相關 test）
   - 若有遺漏 → **AskUserQuestion**：[1] 主線在 worktree 內 commit 補丁 / [2] reset 重派 codex / [3] 中止
6. 全部 phases 完成後，主線**自己**跑 Section 7 Design Review（不派出去）

## screenshot-review Verify Mode Dispatch & Watch Protocol

**核心命題**：派出 `screenshot-review` agent 用 `mode: verify` 後**主線不能單純等回報**。Agent 在 agent-browser 內可能：撞 emptiness preflight、卡 selector、無限 retry、單一 long bash call 期間 SendMessage 叫不動。歷史案例（add-pass-fail-inspection-type）verify agent 跑 7 小時無回報 — 「乾等盲區」對 verify mode 跟對 codex 一樣致命。

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

### 與 Codex Watch Protocol 的差別

| 軸 | Codex Watch | screenshot-review Verify Watch |
| --- | --- | --- |
| 進度來源 | `BashOutput` tail（codex stdout） | `progress.json`（agent 主動寫盤） |
| 介入工具 | `kill <jobId>` | `SendMessage` 詢問 → `TaskStop` |
| Wakeup 機制 | `ScheduleWakeup`（≤ 180s 上限）| 不一定需要 ScheduleWakeup — 主線在執行其他工作時主動 Read 即可；長時間無其他工作時可用 `ScheduleWakeup(900)` 標 progress.json 檢查 |
| Hard timeout | 30 min 累計 → AskUserQuestion | 60 min hard budget(agent 自我中止) + 45 min stale → AskUserQuestion |

### 必禁事項

- **NEVER** 派 verify mode 後不啟動 Watch Protocol — 重演 add-pass-fail-inspection-type 7 小時無回報的根因
- **NEVER** 自決定 TaskStop verify agent — 必須先 AskUserQuestion(除非 agent 已自我宣告 time-budget-exhausted)
- **NEVER** 把 progress.json read 想成 poll agent — 它是 read static file，agent 在另一條 loop 寫盤；不違反 polling 規則
- **NEVER** brief 漏掉 Hard budget / Checkpoint cadence / Fail-fast / 單 call ≤ 1 語義動作 — 缺任一條都會把 agent 推向歷史失控模式
- **NEVER** 把多個 verify item round-trip 包進同一個 Bash call（多個 `agent-browser` 命令串 `&&`）後派出去 — agent 端 SKILL 已明訂禁止，但 brief 內提供的範例 / 模板也不能違反

## Codex `$spectra-apply` Runtime Gate

**核心命題**：`$spectra-apply` 在 Codex 端不允許由使用者直接觸發。Codex 進入 spectra-apply 流程**必須**是 Claude Code 主線派工的結果——Codex 是執行手，不是 quality gate。

### 為什麼擋

| 風險 | 說明 |
| --- | --- |
| 跳過 claim | Codex 直接跑容易略過 `work-claims.md` 規定的「先 claim 再做 active change」流程 |
| 跳過 Design Review 回收 | spectra-apply 的 Design Review phase 必須由主線 Claude Opus 4.8 自己做（見 `agent-routing.md` § Routing Table）；Codex 直接跑會把 Design Review phase 一起做掉，Design 品質降級 |
| 失去 cross-check | 主線是 quality gate（typecheck / git diff / tasks.md checkbox 確認）；Codex 直接跑沒人 cross-check |

### Marker 機制

主線派 Codex 跑 spectra apply phase 時，prompt **第一行 MUST 是 `[DELEGATED-BY-CLAUDE-CODE]`**（見上節 Spectra Apply Phase Dispatch Step 4）。

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

本 gate **只**作用於 `$spectra-apply`(最容易踩到 claim / Design Review 跳過坑的入口)。其他 `$spectra-*` 在 Codex 端的限制策略不在本節範圍——若未來發現類似問題，比照本節設計獨立加 gate。
