---
name: gh-ci-watch
description: "Use immediately after a successful git push when the repo has GitHub Actions and CI / deploy completion must be watched — including slice draft PRs; also use when 查詢某 run 或某 SHA、撈 run log 證據、查 runner 佇列。CI 紅燈修回同一張 PR。NOT for 修 CI 紅燈本身的實作步驟（那是拿到結果後的除錯流程）。"
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: read-only
---

<!-- clade-skill-scope: both -->

# /gh-ci-watch — GitHub Actions 監看 / 查詢唯一入口

**核心 contract**：監看 CI = **機械輪詢**。用 target adapter 提供的 background command runner 跑 `$GH_CI_WATCH`（adapter 綁定的 skill-local helper）——腳本自己 poll 到 terminal state 才 exit，主線只在**完成時收到一次通知**。等待期間零 LLM turn、零 token、行為 100% 確定。

Script 位置：

- Consumer 端：由 adapter 綁定 `$GH_CI_WATCH`
- Clade home：`capabilities/core/scripts/gh-ci-watch.sh`

## 機制選擇

**NEVER** 用 LLM watcher（Agent subagent）監看 CI：它會中途反覆回報、空等被 cancel 的 run、回報舊 run 結論。run 尚未建立、被 concurrency 取代、同 SHA 多條 run 都已由 script 機械處理。事件流通知器與前景 `gh run watch`／主線 wakeup 也不用（前者漏 terminal state 時沉默，後者 block 主線）。

## 監看：canonical dispatch 樣板

以下命令一律由 target adapter 以 background command runner 派出（cwd = 該 repo，或帶 `--repo <owner>/<repo>`），派出後主線**繼續原本工作**，等系統的完成通知。

### 場景 E — 獨立切片的 draft PR

**先判這個切片是哪種 PR**：integration 模式的切片（同一個 work id 有 2 個以上切片，見 [[github-flow]] § Integration branch）的 PR base 是 `integration/<work-id>`，同樣要盯——那條 run 永遠只有機械檢查（不論 draft 或 ready），綠了由 slice owner 自己 `gh pr ready` 該切片 PR、completion 回 coordinator。單切片工作的 PR base 是 `main`，走下面這段。draft 期間這條 run **只有機械檢查**（lint／fmt／typecheck／doctor），test-lane 要等 PR 轉 ready 才跑；所以這裡的綠燈 **NEVER** 讀成測試通過。

slice owner 剛 push session branch 並開 draft PR 後，盯**該 PR 的 head SHA**（push 前先存 `SLICE_SHA=$(git rev-parse HEAD)`），不要盯 `main`：

```bash
bash "$GH_CI_WATCH" workflow ci.yml --commit "$SLICE_SHA"
```

`RESULT: failure` → 同一 owner、同一張 PR 上修，再 push 同一個 head；**NEVER** 另開 PR。Cursor 可用 `subscribe_github_ci`／`subscribe_github_pr` 代替本 script，處置契約相同。綠燈 completion 喚醒**同一 coordinator** 收件並跑 `/commit`，不是請 Charles 代觸發，也不是 worker 自己 ready／merge。

### 場景 F — merge 後 staging 精確 SHA

Coordinator squash 後盯 **該** `MERGE_SHA`，不要追下一個 main SHA：

```bash
bash "$GH_CI_WATCH" workflow deploy-staging.yml \
  --branch main --commit "$MERGE_SHA" --no-follow
```

selector 不能保證精確篩選時，先查出滿足 workflow＋main＋SHA 的 run id，再用 `run <run-id> --no-follow`。`cancelled`／failure／timeout 保留部署 blocker。`UNAVAILABLE` 對 merge／staging gate **NEVER** 算略過成功。

### 場景 A — 盯已知 run id

```bash
bash "$GH_CI_WATCH" run <run-id>
```

### 場景 B — 盯某 workflow 最新一條 run（push 後標準場景）

**workflow 識別字串一律傳檔名（`ci.yml`），NEVER 傳 display name 或自己想的簡稱。** 傳錯時 script exit 2 並印出實際 workflow 清單；拿不準就先跑 `gh workflow list`，或用場景 A 的 `run <run-id>`。

```bash
bash "$GH_CI_WATCH" workflow deploy-staging.yml --branch main
```

- **run 尚未建立也可以直接派**：script 把「查無 run」視為 pending 繼續等（預設只認腳本啟動前 120s 之後建立的 run，可用 `--since <ISO8601>` 調整）
- run 被 concurrency `cancel-in-progress` 取代 → script 自動改追 superseding run（同 workflow + 同 branch、createdAt 較新者）
- **tag 觸發的 workflow MUST 用 `--tag v<version>`，NEVER 用 `--branch main`**（例外：**同一支** workflow 同時由 main push 與 tag push 觸發時，`--tag` 解析成 SHA 之後兩條 run 在同一個 SHA 上、分不開，要判「這個 tag 有沒有觸發」得改用 `headBranch` 過濾——見 `capabilities/core/skills/commit/SKILL.md` § Step 6-A）：tag 觸發的 run 其 `headBranch` 是 tag 名，`--branch main` 永遠篩不到而一路等到 `WATCH_TIMEOUT`

```bash
bash "$GH_CI_WATCH" workflow ci.yml --tag "v$(node -p 'require("./package.json").version')"
```

### 目標 ref MUST pin 在你剛推的那一個（hard rule）

**NEVER 在 dispatch 當下才 `--commit "$(git rev-parse HEAD)"`**：別 session 可能已推了新 commit，盯錯目標會一路 pending 到 `WATCH_TIMEOUT`。

用不可變的 ref 取代活的 `HEAD`，三選一：

| 情境 | 用什麼 |
| --- | --- |
| 發版 tag 已打（post-push 標準場景） | `--tag "v<version>"` —— tag 指向的 commit 不會變（同上例外：同一支 workflow 也由 main push 觸發時，`--tag` 分不開兩條 run） |
| run id 已知（`gh run list -c <sha>` 查得到） | 場景 A 的 `run <run-id>` —— 完全免疫 ref 變動 |
| 沒有 tag，只有 branch push | push **之前**先 `DEPLOY_SHA=$(git rev-parse HEAD)`，dispatch 時用 `--commit "$DEPLOY_SHA"` |

script 會在第一行回顯目標 commit 的 subject、所屬 tag 與是否為當前 HEAD，派錯目標當場看得出來：

```
[watch] target commit 4484a133 = "🚀 deploy: 發布新版本 v1.258.0" (tags: v1.258.0, is-HEAD: no)
```

`is-HEAD: no` 本身**不是**錯誤；要核對的是 subject 與 tag 是不是你剛推的那一個。

### 場景 C — 等某 SHA 的某 workflow 出結果

```bash
bash "$GH_CI_WATCH" workflow deploy-production.yml --commit "$DEPLOY_SHA"
```

`$DEPLOY_SHA` 是 push **之前**就存下來的（見上方 § 目標 ref MUST pin 在你剛推的那一個）。已經有 tag 時改用 `--tag` 更省事。

**`--commit` MUST 給完整 SHA**（script 會嘗試展開縮寫，展不開回 `UNAVAILABLE`）。

同 SHA 多條 run（rerun 過 / concurrency 產生）時取 createdAt 最新一條；失敗照實回報 `RESULT: failure`（**不**默默等 rerun——failure 的處置是主線的事）。

### 場景 D — 完成後順帶抓證據行

```bash
bash "$GH_CI_WATCH" workflow deploy-staging.yml --branch main \
  --evidence-grep 'Deploy complete|digest: sha256'
```

Terminal report 一律自帶：`RESULT:` 行、run URL、各 job 耗時（`--json jobs` 計算）、失敗時 `--log-failed` 前 200 行；`--evidence-grep` 額外對 full log 撈前 40 行命中。pattern 要**收斂**（具體字串），別用 `image|build` 這種寬 pattern 撈一堆雜訊。

### 常用 flags

| Flag | 預設 | 說明 |
| --- | --- | --- |
| `--tag <name>` | — | 解析該 tag 指向的 commit 當目標；與 `--commit` 互斥。post-push 場景首選 |
| `--interval <sec>` | 30 | 輪詢間隔；**<30 會被 clamp 回 30**（GitHub API 紀律） |
| `--timeout <sec>` | 3600 | watch 上限。單槽 self-hosted runner queued 30+ 分鐘是常態，**NEVER** 因為「應該很快」調低到 <1800 |
| `--no-follow` | 追 | cancelled 時不追 superseding run（罕用；例如刻意驗證 cancel 行為） |

### Exit codes / RESULT 分流

輸出尾段**保證**含 `RESULT: <state>` 行——涵蓋所有 terminal state，**沉默不可能等同成功**：

| exit | RESULT | 主線處置 |
| --- | --- | --- |
| 0 | `success` | 一行回報綠燈 + run URL，結束話題 |
| 1 | `failure` / `cancelled`（無 successor）/ `timed_out` / `startup_failure` / ... | **先讀 `LAST_GREEN:` 與 `RANGE:` 兩行**（見 § 失敗處置第一步），再讀 `--log-failed` 節錄進失敗處置流程（post-push 場景見下表『Push 後政策』） |
| 2 | `UNAVAILABLE (workflow '<X>' 不存在；可用：…)` | **名稱傳錯，不是環境問題。**照訊息列出的清單挑**檔名**重派一次，**NEVER** 當成「watcher 起不來」略過——那會讓這次 push 完全沒有 CI 驗證 |
| 2 | `UNAVAILABLE (<其他原因>)` | gh 不存在 / 未登入 / API 連續失敗——一行回報略過，**NEVER** 追問 user |
| 3 | `WATCH_TIMEOUT` | run 可能仍在跑（輸出含最後已知狀態 + run id）。可再派一輪 `run <run-id>` 續盯，或依場景處置 |

### 失敗處置第一步：先比最後綠燈，再猜根因

失敗報告在 failed logs 之前印兩行：`LAST_GREEN: <sha> <時間> <url>`（同 workflow 最後一條 success run；branch push 限同 branch，tag 觸發不限）與 `RANGE: git log --oneline <last-green>..<red>`。**任何**紅燈進 `[1] root-cause` 之前 **MUST** 先跑那條 `RANGE`，逐條看它涵蓋哪些 commit：

| 可觀察 predicate | 判定 |
| --- | --- |
| 紅燈的起點（`LAST_GREEN` 之後第一條紅 run）**早於**最近一次環境變更（換 runner／image／secret） | 根因與那次環境變更無關，往 range 內的 code／依賴變更查 |
| range 只含環境變更那一筆 | 才把環境列為第一嫌疑 |
| `LAST_GREEN: unknown` | 用 `gh run list -w <workflow> -s success -L 1` 自己補查；查不到就明說「起點不明」，**NEVER** 預設是最近那次變更 |

**NEVER** 用「剛剛才換了 runner，應該是它」當起點。

## 查詢：canonical 命令（一次性，前景跑即可）

查詢不是監看——一次 `gh` call 拿得到答案的，直接前景 Bash 跑，不派 background。

```bash
# 列最近 run（含狀態）
gh run list -L 10 --json databaseId,workflowName,status,conclusion,headBranch,createdAt,url

# 看單一 run 概要 / jobs
gh run view <run-id> --json status,conclusion,jobs,url

# 撈特定 log 行當證據
gh run view <run-id> --log | grep -E '<pattern>' | head -40

# 失敗 log 節錄
gh run view <run-id> --log-failed | head -200

# 查 runner 佇列（單槽 self-hosted runner 排隊診斷）
gh api "/repos/<owner>/<repo>/actions/runs?status=queued" --jq '.workflow_runs[] | [.id, .name, .head_branch, .created_at] | @tsv'
```

## 收到完成通知後主線必做

1. 讀該 background bash 的輸出**尾段**（`=== CI WATCH RESULT ===` 起），依 `RESULT:` 分流（上表）
2. **NEVER** 沉默等 user 問進度——通知到了就主動回報
3. 要**改監看目標**（例如發現該盯另一條 run）：**kill 舊 background bash、派新命令**。**NEVER** 嘗試對跑一半的 watcher「下改派指令」——script 沒有也不需要互動管道

## NEVER

- **NEVER** 用 LLM watcher 監看 CI（例外見下）、事件流型通知器、前景 `gh run watch` / 主線 `sleep` 輪詢
- **NEVER** 手寫 ad-hoc `until ...; do sleep ...; done` 輪詢取代本 script
- **NEVER** 輪詢間隔 <30s（script 已 clamp，手寫查詢 loop 也適用同紀律）
- **NEVER** 把「沒收到通知」解讀成任何結論——用 target adapter 的 owner-status 查詢確認它還活著；**NEVER** 讀取未經 adapter 整理的 background output（那會把 output 送進 context，在 control-turn allowlist 之外）
- **NEVER** 同一條 run 重複派第二個 watcher（改目標 = kill + 重派）
- **NEVER** 對「這次 diff 不會觸發」的 workflow 派 watcher（例：沒動 `supabase/migrations/` 卻派 migration gate）——它不會有 run，只會等滿 `WATCH_TIMEOUT`。派之前先確認該 workflow 的 `on:` 觸發條件被本次 diff 命中

## 例外：什麼時候仍可用 Agent

只有當「完成後的**處置**」需要多步 LLM 工作且 user 明確要求全自動接手時（例如「紅燈就自己修到綠」），才包一層 Agent——而且該 Agent 內部**仍 MUST** 用本 script 等待，等待本身永遠不交給 LLM。純監看 + 回報（絕大多數場景）一律直接 background Bash。

## Cross-ref

| 主題 | 位置 |
| --- | --- |
| Push 後何時觸發監看、綠燈/紅燈後主線的處置政策 | 本 skill § Push 後政策：`git push` 成功且 repo 含 `.github/workflows/*.yml` 時 MUST 立刻派 watcher。**切片 PR**（兩者的 run 都只含機械檢查）：盯該 PR 的 head SHA／branch，`failure` → **同一 owner、同一張 PR** 修，**NEVER** 另開 PR；`success` → 一行報綠燈 + run URL，然後依 base 分：base `main`（單切片工作）→ draft 維持 draft，completion 交 coordinator；base `integration/<work-id>` → 本機門檻也已通過時 slice owner 自己 `gh pr ready` 該切片 PR 再交 completion（`integration-merge.ts --pr` 拒收 draft）。**發版 push main／tag**：`success` → 一行報 `v<version> CI 綠燈 — <runUrl>`；失敗類 → 先照 § 失敗處置第一步 跑 `RANGE`，再 `[1] 立刻 root-cause + 修` / `[2] 登記 HANDOFF.md`。`UNAVAILABLE` → 監看可報略過；**merge／staging gate 不得把 UNAVAILABLE 當成功** |
| CI / test workflow 必須自己取消過期 run | [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref。本 script 在 cancelled 時改追 successor，那是監看補救，不能代替 workflow `concurrency` |
| Script 本體 | skill-local `scripts/gh-ci-watch.sh`（由 resource declaration 投影至本 skill） |
| 背景派工通用回報契約 | `rules/core/agent-routing.dispatch-execution.md` § Subagent 回報契約 |


## Cursor host contract

Set `GH_CI_WATCH=.cursor/skills/gh-ci-watch/scripts/gh-ci-watch.sh`, then run `bash "$GH_CI_WATCH"` through the Cursor terminal/background command facility when it exposes an owner and completion notification. If no background facility is available, stop with the watch blocked and report the unavailable completion surface; never replace it with a Task or LLM watcher.
