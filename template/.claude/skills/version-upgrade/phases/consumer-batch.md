# Phase B–D — 單一 consumer 的盤點、逐項升版、驗收落地

route 是 `<理由>.consumer`（`routine`、`release`、`deprecated`、`security`）時從 Step B.1 開始；`rollback.consumer` 與 `resume` 從 Step C.1 開始。Phase F 的 per-consumer subagent、Phase K（clade 自身）也跑同一條。

把「升 deps」這個機械活全程委派給 worker：主線只負責 plan／dispatch／watch／摘要，**不**自己改 `package.json`、不自己跑 `pnpm install`。每個計畫列一個派工、一個 commit，失敗自動升 research 列（加上 web search／GitHub Issues 研究）。

**兩種 item 共用同一條 pipeline**：

| Item kind | 來源 | 動的檔 | 真驗證 |
| --- | --- | --- | --- |
| `npm` | `inventory.py`（`pnpm outdated -r`） | `package.json` + lockfile（+ callsite） | typecheck / build / test（本機） |
| `npm` (catalog) | 同上（catalog-pinned 套件） | `pnpm-workspace.yaml`（`catalog:` + `overrides:`）+ lockfile | 同上 |
| `action` | `inventory.py`（`pnpm outdated --include-github-actions`） | workflow / composite action YAML | **push 後 CI 綠燈**（Step D.2） |

`action` item 併進同一條 pipeline，是因為它跟 npm 升級共用同一套 worktree gate、per-item commit boundary、changelog pre-scan 與收尾——差別只在「改哪個檔」與「怎麼驗」。Actions 為什麼不交 Dependabot、target 版號的封頂與同步、移除依賴的判準，都在 `rules/依賴變更判準.md`。

**Changelog-aware**：兩種觸發路徑：
- **pre-scan**（Step B.2）：主線用 `dep-fleet-discover.ts` + `gh release view` 拿 changelog → 依 `rules/changelog分類判準.md` 分類 → 依分類決定派工 prompt 是否帶 `<changelog-block>`。
- **Fleet brief**：被 Phase F subagent 呼叫時，跳過 Phase B（target／version 由 fleet brief 指定）、Step C.1 的 prompt 內嵌 BC clauses + callsites（`templates/first-pass.md` 的 `<changelog-block>`）。

## Step B.1 — 盤點（`scripts/inventory.py`）

READ 若要決定任何 item 的 target，讀取 `rules/依賴變更判準.md` Rule 1。

```bash
uv run <skill 根目錄>/scripts/inventory.py --cwd <worktree> [--audit] [--fixture-dir <dir>]
```

- 輸出正規化 JSON：npm 列（`pnpm outdated -r --filter '!./vendor/**'`：workspace 子套件進來、vendored specformula 排除，帶 `dependencyType` 與 `isDeprecated`）、action 列（tag-ref 與 SHA-pin 都在；`locations` 列出每一處出現位置，`current` 取最低）、`manual` 列（skill 文件 code block 內嵌的 `uses:`，計畫表列出、不自動改）。pnpm < 11.16 時腳本自動改走 corepack；沒有根 `package.json` 或未被 workflow 以 `./` 引用的 action 走 fixture。不支援 npm／bun／yarn lockfile（exit 2）
- `security.consumer` 帶 `--audit`：`advisories` 依套件分組，`patched` 是要升到的下限，`unpatched: true` 的另列交 user（`rules/changelog分類判準.md` Rule 3）
- `release.consumer` 只留該套件（與它的家族，見 Step B.3）
- `deprecated.consumer` 以 `isDeprecated: true` 的列為主，其餘照列但不排進本輪
- `mode_route.py` 印了 `focus=actions`（使用者只說 `actions`）：只留 action 與 `manual` 列，npm 列不進計畫檔
- 後續 prompt builder 依 `dependencyType` 決定 `pnpm add <pkg>` 還是 `pnpm add -D <pkg>`——**NEVER** 預設 `-D`，否則會把 dependencies 套件靜默搬到 devDependencies（實證踩坑：某 consumer 第一次 run wrangler 被誤搬，commit 後才發現）
- 版號差距分類（從低風險到高風險升）：**patch** 通常安全；**minor** should be safe 但偶爾有 regression；**major** 高機率 breaking change。action 以 tag 的 major 判

## Step B.2 — Changelog pre-scan（主線直接做）

在 B.1 收完盤點 + 版號差距 + `@types/*` 封頂後，**升版前**先理解每個 item 的 release 性質，依此決定升版策略。主線直接完成（不派 worker）。

### B.2.1 — Batch discover release URLs

**npm items**：對每個 outdated package，跑 `dep-fleet-discover.ts` 拿 release URL：

```bash
node ~/offline/clade/vendor/scripts/dep-fleet-discover.ts --pkg "<pkg>" --version "<to>"
```

- 可並行跑（獨立、唯讀）— 多個 Bash tool call 同一 message
- 記錄每個 package 的 `release_url` + `source` + `repo_url`
- `source: "none"` 的 package 標記分類為 `unknown`，skip B.2.2–B.2.4
- **Skip `@types/*`**：型別定義的 changelog 對分類無意義 → 直接標 `bugfix`

**action items**：用 `gh` 直接拿 release URL（`owner/repo` 取自 `inventory.py` 的 action 列）：

```bash
gh release view "<latest>" --repo <owner>/<repo> --json url -q .url
```

- 同 major 內升版：release URL 是 `latest` 那個 tag
- major 跳號（如 v2→v4）：release URL 用新 major 的第一個 release（`v4.0.0` 或 `v4.1.0`）

### B.2.2 — Batch fetch release bodies

**npm items**：對 `source != "none"` 的 package，fetch release body：

```bash
gh release view v<to> --repo <owner>/<repo> --json body -q .body > /tmp/dep-prescan-<pkg-slug>.md
```

- `gh` 失敗（private repo / rate limit / 無 release）→ 若 `source: "changelog_md"`，依 `web-search` external-web row 取 changelog URL → 否則標 `unknown`
- 寫出的檔可在 C.1 pi prompt builder 復用

**action items**：同上 `gh release view`，寫到 `/tmp/dep-prescan-action-<owner>-<repo>.md`。Actions 通常有良好的 release notes（GitHub 官方 + 大社群維護者），fetch 失敗率低。

### B.2.3 — 主線分類

READ 若讀完 release body、要為 item 標分類，讀取 `rules/changelog分類判準.md`：四類＋混合（Rule 1）、`deprecated`（Rule 2）、安全通報與回退的 target（Rule 3）。

**`feature` 時提取 feature 摘要**：

```jsonc
{
  "notable_features": [
    { "description": "<feature 描述>", "opt_in": true }
  ]
}
```

### B.2.4 — Callsite quick-scan（`adaptation` only，npm items）

對標記 `adaptation` 的 **npm** package，用 `rg` 快掃每個 BC 的 `affected_apis`：

```bash
rg -n "<symbol>" --type-add 'vue:*.vue' --type vue --type ts .
```

- 記錄 `file:line` 組合，後續 C.1 填入 `<changelog-block>` 的 callsites 段
- 過濾 docs-only 命中（`.md` / `README` / `docs/`）— 不是 runtime callsite
- 比 Phase F 的 codebase-memory-mcp 輕量（單 consumer、不需 index）
- **callsite = 0**：不刪該 BC（仍可能 transitive 影響），prompt 內提示 `callsites: 0（pi 自行 grep 確認）`

**action items 不需 callsite scan** — action 的「callsite」就是 workflow YAML 裡的 `uses:` 行，`inventory.py` 的 `locations` 已收集完整。`adaptation` 標記的 action 的 BC 影響範圍是 workflow YAML 裡的 `with:` 參數或 `outputs`，C.6 prompt 會包含完整 workflow 段落。

## Step B.3 — 家族分組

READ 若分類完、要寫計畫檔，讀取 `rules/批次分組判準.md`，把同家族的 item 合成一列。

## Step B.4 — 寫計畫檔＋plan gate

讀取 `templates/upgrade-plan.md`，照 SKILL.md Step 0.3 的落點寫出計畫檔：每個 item 或家族一列、狀態 `pending`，分類、BC 摘要、callsite 數、`@types/*` 封頂標註、advisory id 都填進對應欄。計畫檔就是回報給 user 的計畫表，**NEVER** 只貼在對話裡（中斷後續跑靠它，G9）。

建議升級順序：npm 🟢 bugfix → ⚪ unknown → 🟡 adaptation → 🔵 feature；actions 同 major → major 跳號（先簡單的、再需要適配的、最後有 feature 的）。

使用者可：
- 指定排除清單（如 `vue` lockstep with `nuxt`，先不動）
- 調整分類（如「bar 不用 adaptation，降成 bugfix」）
- 只跑 npm 不跑 actions（或反過來）
- **MUST 等使用者確認**才進 Phase C；user 的排除與調整寫回計畫檔（排除的列改 `skipped`） — 不要自決定

> Smoke test 建議：第一次在一個新 consumer 跑時，先挑 1 個最低風險 🟢 patch 跑 smoke，驗證 worktree fork + pi dispatch + commit boundary 都對，再批次推剩下的。

## Phase C — 逐 item 派工 loop（category-aware）

每個計畫列走以下子流程，**一個列一個派工（npm）或主線直改（action）**、**一個 commit**。Step B.2 的分類決定 prompt 填充策略。每做完一列（成功、跳過、失敗）**MUST** 立刻更新計畫檔該列的狀態、checkpoint 與證據——下一棒靠 `mode_route.py --plan` 從第一個未完成列續跑。

**dispatch 順序**：先所有 npm items（逐個串行），再所有 action items。這是因為 npm 升版完後 lockfile 才穩定，action 升版不影響 lockfile。

**`rollback.consumer`**（從這裡開始，沒有 Phase B）：照 SKILL.md Step 0.3 開一份只有一列的計畫檔，target＝上一個好版、證據欄填上游 issue／advisory URL（`rules/changelog分類判準.md` Rule 3），之後照 C.1 起同一條鏈；commit message 用 `🧹 chore: wt pin-<pkg>-<from>→<to> (<issue-url-slug>)`。

### C-npm — npm 套件子流程

npm items 依分類決定 prompt 填充：

評估：first-match；以上皆非 → N*

| id | 分類 | `<changelog-block>` | `<plan-first-block>` | 工作範圍 | 驗證 |
| --- | --- | --- | --- | --- | --- |
| N1 | `bugfix` | 空（現有行為） | patch 空 / minor 填 | `package.json` + lockfile only | typecheck（patch）/ +build（minor） |
| N2 | `adaptation` | **填入** BC + callsites（復用 Fleet 的 changelog-block 格式） | 必填 | `package.json` + lockfile + callsite 檔 | typecheck + build + 相關 test |
| N3 | `feature`（無 BC） | 填入 feature 摘要（informational） | 依版號差距 | `package.json` + lockfile only | 同 bugfix |
| N4 | `feature` + `adaptation` | **填入** BC + callsites + feature 摘要 | 必填 | 同 adaptation | 同 adaptation |
| N* | `unknown` | 空（現有行為） | 依版號差距 | `package.json` + lockfile | 同 bugfix |

### C.1 寫 prompt 到 `/tmp/pi-upgrade-<pkg>-prompt.md`

用 `templates/first-pass.md`（C.2 派 Claude Sonnet 5.5 `--effort high`）。**MUST** 內含：
- `[DELEGATED-BY-CLAUDE-CODE]` marker（第一行，per [[agent-routing.pi-watch-protocol]] § Pi 派工的標準流程）
- 目標 package 名 + current version → target version + **正確的 install flag**
- Git Baseline 段（per pi-watch-protocol § Git Baseline；列當前 worktree 內所有 main fork 過來的 in-flight 變更 path，**不要列死**——每個 consumer / 每次 fork 都不同，主線跑 `git status --porcelain` 動態抓）
- Commit Authorization 段（per pi-watch-protocol § Commit Authorization；message format `🧹 chore: wt upgrade-<pkg>-<from>→<to>`，subagent 端需讀 commitlint config 調整）
- 失敗時的回報格式

**`<changelog-block>` 填充**（`adaptation` / `feature+adaptation` 才填，其他留空）：完全復用 `templates/first-pass.md` 的 `<changelog-block>` 填充格式，callsites 來源為 B.2.4 的 `rg` 結果（而非 Phase F 的 codebase-memory-mcp）。`adaptation` 的 pi 工作範圍擴大到 callsite 檔：Commit Authorization 加 `git add <callsite-files>`。

**`feature`（無 BC）的 `<changelog-block>` 填充**：只含 feature 摘要段（informational），**不**含 callsites 或「動手範圍」段 — 告知 pi 這個版本有新功能但升版只需 bump，不必改 source code。

**Plan-first 條件化**（DRY + 降 token）：
- `bugfix` + patch：**MAY 省略** Plan-first 硬指令，prompt 直接列「install → typecheck → commit」固定三步
- `bugfix` + minor / `unknown` + minor：**MUST** 加 Plan-first
- `adaptation` / `feature+adaptation` / major（任何分類）：**MUST** 加 Plan-first

**驗證步驟**（依分類 + 升版類型，取嚴格者）：
- `bugfix` + patch：`pnpm install`（隱式跑） + `pnpm typecheck` 0 errors
- `bugfix` + minor / `unknown`：typecheck + 如有 build script 跑一次 + 相關 test
- `adaptation`（任何版號差距）：typecheck + build + 相關 test
- major（任何分類）：typecheck + build + 全 test + pi 自己決定要不要 smoke test

### C.2 Dispatch background（first-pass，Claude Sonnet 5.5 high）

`version-upgrade-first-pass` 列：載體偏好（cloud ＞ Devin ＞ 本機 pane）照 [[agent-routing.routing-table]] § Devin SWE-2 Max 的「四列的 Devin 預設」；本 turn 收得回就走 in-process `sonnet-implementer`（brief 首行下加 `routing-row: version-upgrade-first-pass`），要背景或隔離走 Herdr：

```bash
node ~/offline/clade/vendor/scripts/herdr-session-handoff.ts \
  --cwd <worktree-path> \
  --label version-upgrade-<pkg>-first-pass \
  --prompt-file /tmp/pi-upgrade-<pkg>-prompt.md \
  --model claude-sonnet-5-5 --effort high \
  --route routing-table --tier-basis table-row \
  --table-row version-upgrade-first-pass
```

席位不可用時的處置依 [[agent-routing.routing-table]]：`version-upgrade-first-pass` 只有 **Claude Sonnet 5.5 high** 一格，`version-upgrade-research` 自 2026-10-21（Pi Grok 退場）起是空鏈、首跳即**主線**；兩列鏈走完都由**主線**接手，不是 blocker，也 **NEVER** 改派禁用 model。適用 Phase B–D 與 Fleet 的每一個 package dispatch。

這是workspace mutation dispatch。`version-upgrade-research` 經 Pi 時，Runtime quota／provider failure後，**每一個**retry都MUST逐字採用dispatcher payload的`next_step`（含`--retry-of`與`--workspace-access mutation`）；NEVER自行改派任何 GPT seat。


派出 mutation executor 後，立刻記錄 owner / deadline（deadline 取值依 [[agent-routing.keepalive-wake]] § deadline 怎麼取），並依 [[agent-routing.pi-watch-protocol]] 的 keepalive 規約維持單一控制生命週期。控制 turn 只准使用當前 runtime adapter 提供的 bounded completion transport 讀取狀態、重排同一 inert control 或排 lifecycle intervention；**NEVER** 放 upgrade prompt、讀 output tail或做 package mutation。收到 terminal completion 後先 claim task id，再讀結果並停止 wakeup。

### C.3 收到 `<task-notification status=completed>` 後判定

評估：first-match；以上皆非 → S*

| id | 訊號 | 判定 | 下一步 |
| --- | --- | --- | --- |
| S1 | `PHASE_RESULT: SUCCESS` + worktree 多了一個 `🧹 chore: wt upgrade-<pkg>-...` commit | 成功 | **主線在該 worktree 自己重跑一次 typecheck**（前置契約未滿足時 worker 會自報 `pass`——commit 存在不等於內容正確）。綠了才記錄到摘要、進下一 package |
| S2 | `PHASE_RESULT: FAILURE` + pi 自報原因 | 失敗 → 進 C.4 升 research | 不馬上問使用者；先讓 research 列自己研究 |
| S3 | Plan section 缺 / commit message format 不符 / scope drift | pi 漏跑硬指令 | 不升 research；直接 runtime-native question interface [重派 first-pass / 升 research / 跳過 / 中止] |
| S* | `fetch failed` / sandbox 拒絕 / 互動 prompt 卡住 | 環境問題 | per watch protocol 「介入觸發」，runtime-native question interface |

**絕不**在 C.3 替 pi 修檔（會破壞 per-package commit boundary）。要修就 reset worktree commit 後重派。

### C.4 升 research（first-pass 失敗自動觸發）

寫 prompt 到 `/tmp/pi-upgrade-<pkg>-research-prompt.md`，用 `templates/research.md`。**MUST** 內含：

- `[DELEGATED-BY-CLAUDE-CODE]` marker
- First-pass 派工的失敗 tail（≤ 50 行）+ pi 自報的失敗原因
- 明確指示走研究模式：先 **github** plugin 查 `<pkg>` repo 的 issues / releases / changelog，再 **agent-browser** / web search 查官方 migration guide
- 研究完才動手改檔
- 一樣的 Git Baseline / Commit Authorization 硬指令
- Commit message format `🧹 chore: wt upgrade-<pkg>-<from>→<to> (researched <issue-url-slug>)`

執行：Pi 沒有可派 model（2026-10-21 `grok-xai` 退場），`version-upgrade-research` 由**主線**照這份 prompt 自己研究並修。Pi 恢復可派 model 時才改回 Dispatch（同 C.2，保留 `--workspace-access mutation`，`--model <該列首跳> --table-row version-upgrade-research`）+ watch（節奏以 [[agent-routing.pi-watch-protocol]] 為準）。

「失敗 → research」的升級靠上面的 GitHub issues／releases／changelog 與 web search 研究，**不靠抬 effort**——effort 跟著 model 走（`TIER_EFFORT`），dispatcher 對其他值 exit 1。

### C.5 research 仍失敗 → runtime-native question interface

```
<pkg> first-pass + research 都失敗。

First-pass 失敗原因：<一句話>
Research 失敗原因 + 已查到的線索：<一句話>
完整 pi 輸出在 /tmp/pi-upgrade-<pkg>-research-prompt.md

要怎麼處理？
[1] 跳過 <pkg>（記錄到摘要的 SKIPPED 區，繼續下個 package）
[2] 中止整個 upgrade loop（保留 worktree 供手動處理）
[3] 主線接手手動升（會破壞 per-package commit boundary，僅在套件很小時建議）
```

**禁止**主線自己決定跳過或中止 — 必須使用者選。

### C.6 — GitHub Actions 升級子流程

#### C.6.1 — 逐 action 升版

READ 若要升 action，讀取 `rules/依賴變更判準.md` Rule 3。每個 action item 一次：

```bash
pnpm update --include-github-actions <owner/repo>            # 同 major 內
pnpm update --include-github-actions <owner/repo> --latest   # major 跳號（計畫表標 adaptation）
```

**驗證替換正確性**（每個 action 升完立即做）：

```bash
grep -rn "<owner>/<repo>@" .github/workflows/ .github/actions/ 2>/dev/null
```

- 確認 `inventory.py` 的 `locations` 每一處都已改成新 SHA，無殘留舊 ref
- 確認 `# v<tag>` 註解與新 SHA 對應（不要出現新 SHA 配舊 tag）

#### C.6.2 — Major 跳號的 `adaptation` 處理

major 跳號的 action item（B.2.3 標為 `adaptation`）**不能**只換 SHA — 可能需要改 `with:` 參數、`outputs` 引用、整個 step 結構。

**MUST** 在替換前：

1. 讀該 action 在 B.2.2 fetch 到的 release body
2. 對照 consumer workflow 裡該 action 的 `with:` / `env` / `outputs` 用法
3. 如果 release notes 列了 breaking change 且影響本 consumer 的用法 → 一併改 workflow YAML
4. 如果改動涉及多 step 聯動（如 `upload-artifact` 的 output 被後續 step 引用）→ **STOP + runtime-native question interface** 讓 user 拍板

#### C.6.3 — Commit

每個 action item 一個 commit（per-item commit boundary 同 npm 段）：

```bash
git commit --only -m "🧹 chore: wt bump <owner>/<repo> <old_tag>→<new_tag>" \
  -- <affected workflow files>
```

**commit message 格式**：
- Same-major：`🧹 chore: wt bump <owner>/<repo> v<major> SHA update`
- Major 跳號：`🧹 chore: wt bump <owner>/<repo> v<old_major>→v<new_major>`

**NEVER** 把多個 action 的變更混進同一個 commit。

#### C.6.4 — 驗證方式差異

Action 升版不能本機驗（沒有 `typecheck` / `build` 可跑）。本機驗證僅限：

- YAML 語法正確（`python3 -c "import yaml; yaml.safe_load(open('<file>'))"` 或等效）
- `grep` 確認無殘留舊 SHA

**真驗證推遲到 D.2**（push 後 CI 驗綠）——這是 action items 跟 npm items 的關鍵差異。

## Step D.1 — 驗收來源與批次收尾

所有 package 派工結束後，主線在來源確認必要檢查與各項結果，保存 scoped checkpoint。失敗或驗收未完者不進 ready 池；原始工作、baseline 與證據保留，不藉清 WIP 讓 readiness 過關。

1. 對成功項驗 scope、受測 HEAD 與 evidence，確認原執行者交出寫入權；計畫檔該列改 `done` 並填 checkpoint 與證據（Phase C 每做完一列就已更新，這裡核對沒有漏列）。
2. `feature` 分類的適配待辦寫入來源既有 `HANDOFF.md`，附 package／版本／release URL／新增能力，與 checkpoint 一起保存；該檔不存在則沿用 skip。
3. 依 commit skill `batch.md` 登記該 repo 就緒來源。Fleet worker 到此回報 checkpoint SHA、path、work id、驗收證據與建議 commit message；由 orchestrator 依 F.8 授權協調正式提交。
4. 單 repo 本輪開發已完成時用 `drained`，仍有可做開發時用 `auto`。達批次條件即由 coordinator 在隔離 integration 跑一次完整 `/commit`，正式落地後依既有發布 gates push、安全 cleanup。使用者明示「不要 land／保留 worktree」時保留並報 owner／下一事件，不登記落地授權。
5. 正式落地改了 dependency manifests／lockfile 時，在 main 跑對應 package manager install 對齊依賴；action 升級已 push 時走 D.2。

摘要依實際 package／action 結果分成功、adaptation、feature、skipped、failed；附來源與 batch 的 ready／blocked／landed／cleaned 狀態。Main 既有 index／WIP 保留，不能先把來源 staged 到 main 等人提交。完成報告前逐來源列 lifecycle 五欄，見 `batch.md`。

## Step D.2 — CI 驗綠（action 升級限定）

**觸發條件**：本次 upgrade 含至少一個 `action` item **且** `/commit` 已完成 push。若純 npm 升級（無 action items），skip 本步。

Action 升版的「真驗證」**只能**在 CI 跑——本機沒有 GitHub Actions runner。push 後 **MUST** 派 CI watcher（per the active runtime policy § Post-Push CI Watcher）監看 consumer 的主要 CI workflow：

```bash
bash <native-skills>/gh-ci-watch/scripts/gh-ci-watch.sh workflow <primary-ci-workflow>.yml \
  --commit "$(git rev-parse HEAD)"
```

- `<primary-ci-workflow>.yml` 是 `.github/workflows/` 底下的**檔名**（通常 `ci.yml`，或 `_ci-reusable.yml` 被 caller 觸發的那條）。**NEVER 傳 workflow 的 display name 或自己想的簡稱** —— display name 與檔名無關且隨時可被編輯，傳錯時 script 會 exit 2 並列出可用清單（見 `/gh-ci-watch` 的 `rules/目標ref與場景選擇判準.md` Rule 2）
- 用 runtime adapter 提供的 background execution surface 派出
- Watcher 完成後走 active runtime policy 既定分流（success → 一行報完、failure → runtime-native question interface 二選一）

**若 CI 紅燈且根因是 action 升級**（error log 指向 action step / 新 input 不認識 / permission 問題）：

1. runtime-native question interface 讓 user 選：立刻回 worktree 修 / revert 該 action 的 commit / 登記 HANDOFF
2. 修完後再 push → 再派 watcher 驗綠
3. **NEVER** 對 CI 紅燈視而不見宣稱 version-upgrade 完成

---

# 禁止事項（Phase B–D 限定）

- **NEVER** 一次派多 package / action 並行（破壞 per-item commit boundary，bisect 失效）
- 正式提交依 D.1 的批次觸發與既有授權；worker 本身不啟動完整品質鏈
- **NEVER** 在含 action 升級的 session 跳過 D.2 CI 驗綠（action 升版沒有本機驗證手段，CI 是唯一真驗證）
- **NEVER** 用 `actionlint` / `zizmor` 替代 CI 驗綠 — 靜態 lint 抓不到 action runtime breaking change（如新版移除 input、改 output 結構）
