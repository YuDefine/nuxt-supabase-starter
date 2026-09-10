---
name: gh-ci-watch
description: "Use when 需要監看或查詢 GitHub Actions（push 後盯 CI / deploy 綠燈、等某 run 或某 SHA 完成、撈 run log 證據、查 runner 佇列）。NOT for 修 CI 紅燈本身（那是拿到結果後的除錯流程）。"
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: read-only
---


# /gh-ci-watch — GitHub Actions 監看 / 查詢唯一入口

**核心 contract**：監看 CI = **機械輪詢**。用 target adapter 提供的 background command runner 跑 `$GH_CI_WATCH`（adapter 綁定的 skill-local helper）——腳本自己 poll 到 terminal state 才 exit，主線只在**完成時收到一次通知**。等待期間零 LLM turn、零 token、行為 100% 確定。

Script 位置：

- Consumer 端：由 adapter 綁定 `$GH_CI_WATCH`
- Clade home：`plugins/hub-core/scripts/gh-ci-watch.sh`

## 機制選擇：為什麼是 background Bash + script，不是其他

> 這段是本 skill 存在的理由。**NEVER** 退回用 Agent subagent 監看 CI——那正是本 skill 要根治的事故根因。

**事故實證（2026-07-25，<consumer-a> v0.99.7 發版）**：依當時規約派兩個 LLM watcher 監看 Deploy Staging / Production，實際發生四件事：(1) brief 明寫「completed 才回報」，agent 仍反覆中途回報「持續監看中…」，每次回報都是一次 LLM turn，累計 **235k+ tokens 且沒有產出最終結果**；(2) 監看的 staging run 被 concurrency `cancel-in-progress` 取消後，agent 繼續空等已死的 run；(3) 重新指派新 run id 後，watcher 口頭答應卻仍回報舊 run 結論；(4) 同一份 brief、同一個 model，兩個 watcher 行為不一致。

| 機制 | 判定 | 理由 |
| --- | --- | --- |
| **target adapter 的 background command runner + 本 script** | ✅ **採用** | 官方定位就是「單次通知：告訴我 X 好了沒」。腳本達 terminal state 即 exit → 剛好一次通知；無 LLM 參與 → 零等待成本、行為確定。事故中需要「判斷力」的三件事（run 尚未建立、被 concurrency 取代、同 SHA 多條 run）其實都是**機械規則**，已全部編進 script（Phase 1 pending 重查、Phase 2 successor 追蹤、`--since`/`--commit` 過濾），不需要 LLM |
| LLM watcher | ❌ 禁用 | 見上方事故四點。LLM「判斷力」在這個場景是負資產：不可預測 + 每個動作燒 token。唯一例外見下方「例外」節 |
| 事件流通知器 | ❌ 不用 | CI 監看要的是**恰好一次**完成通知；事件流型通知若 filter 沒涵蓋所有 terminal state，crash 時沉默會跟「還在跑」一模一樣。本 script 用 `RESULT:` 行涵蓋全部 terminal state，從結構上排除這個坑 |
| 主線 wakeup / 前景 `gh run watch` | ❌ 不用 | 佔用主線 context / block 主線對話。`gh run watch` 也不處理 run 被取代 |

## 監看：canonical dispatch 樣板

以下命令一律由 target adapter 以 background command runner 派出（cwd = 該 repo，或帶 `--repo <owner>/<repo>`），派出後主線**繼續原本工作**，等系統的完成通知。

### 場景 A — 盯已知 run id

```bash
bash "$GH_CI_WATCH" run <run-id>
```

### 場景 B — 盯某 workflow 最新一條 run（push 後標準場景）

**workflow 識別字串一律傳檔名（`ci.yml`），NEVER 傳 display name 或自己想的簡稱。**
`gh run list -w` 只認兩種形式：workflow **檔名**，或 `name:` 欄位的**逐字** display name。
display name 是自由文字、跟檔名無關（`ci.yml` 的 name 常是 `CI / Deploy`），而且隨時可被編輯 ——
檔名要改得動 git。傳錯時 script 自 2026-08-28 起在進輪詢前就 fail fast：exit 2 並把該 repo
實際的 workflow 清單印進 `RESULT:` 行；先前是被當成 API 抖動重試 3 次後回通用 `UNAVAILABLE`，
訊息與「gh 掛了 / 沒授權」同形（<consumer-b> v1.272.0 實證，見
[[pitfall-gh-ci-watch-workflow-display-name-guess-fails-opaquely]]）。名字拿不準就先跑
`gh workflow list`，或直接用場景 A 的 `run <run-id>`。


```bash
bash "$GH_CI_WATCH" workflow deploy-staging.yml --branch main
```

- **run 尚未建立也可以直接派**：run 在 push 送達後才被建立，watcher 起跑時它可能還不存在；`/commit` 的發版序列是 `git push origin main` 先、具名 tag 後（2026-09-04 起無條件，見 `plugins/hub-core/skills/commit/SKILL.md` § Step 6-A），所以 tag 觸發的 production run 更是要等第二趟 push 才出現——script 把「查無 run」視為 pending 繼續等（預設只認腳本啟動前 120s 之後建立的 run，可用 `--since <ISO8601>` 調整）
- run 被 concurrency `cancel-in-progress` 取代 → script 自動改追 superseding run（同 workflow + 同 branch、createdAt 較新者）
- **tag 觸發的 workflow MUST 用 `--tag v<version>`，NEVER 用 `--branch main`**（例外：**同一支** workflow 同時由 main push 與 tag push 觸發時，`--tag` 解析成 SHA 之後兩條 run 在同一個 SHA 上、分不開，要判「這個 tag 有沒有觸發」得改用 `headBranch` 過濾——見 `plugins/hub-core/skills/commit/SKILL.md` § Step 6-A）：tag 觸發的 run 其 `headBranch` 是 **tag 名**不是 `main`，`--branch main` 對它永遠篩不到 run → watcher 一路 pending 到 `WATCH_TIMEOUT` exit 3，即使該 run 其實是綠的（2026-07-25 <consumer-b> v1.250.0 實證）

```bash
bash "$GH_CI_WATCH" workflow ci.yml --tag "v$(node -p 'require("./package.json").version')"
```

### 目標 ref MUST pin 在你剛推的那一個（hard rule）

**NEVER 在 dispatch 當下才 `--commit "$(git rev-parse HEAD)"`。** `HEAD` 是活的：多 session 共用同一條 main 是常態，`git push` 與派 watcher 之間別的 session 可能已經推了新 commit，`$(git rev-parse HEAD)` 於是解析成**不是你發版的那個 commit**。那個 SHA 通常沒有任何 run，`gh run list -c` 回空陣列，而 script 把「查無 run」當成「run 尚未建立」——失敗形狀是**一路 pending 到 `WATCH_TIMEOUT`**，跟「run 還在排隊」外觀完全一樣，一小時後才發現盯錯目標（2026-08-02 <consumer-b> v1.258.0 實證：HEAD 已被別 session 推進 2 個 commit）。

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

`is-HEAD: no` 本身**不是**錯誤——上例正是正確狀態（別 session 之後又推了 commit）。要核對的是 subject 與 tag 是不是你剛推的那一個。

### 場景 C — 等某 SHA 的某 workflow 出結果

```bash
bash "$GH_CI_WATCH" workflow deploy-production.yml --commit "$DEPLOY_SHA"
```

`$DEPLOY_SHA` 是 push **之前**就存下來的（見上方 § 目標 ref MUST pin 在你剛推的那一個）。已經有 tag 時改用 `--tag` 更省事。

**`--commit` MUST 給完整 SHA**（別從 `git log` 抄 7–8 碼縮寫）。`gh run list -c` 只認 40 碼，縮寫會**靜默回空陣列**、不報錯；script 自 2026-07-31 起會先用 `git rev-parse` 展開，展不開就 fail fast 回 `UNAVAILABLE`（先前是誤判成「run 尚未建立」等滿 3600s）。

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
| 1 | `failure` / `cancelled`（無 successor）/ `timed_out` / `startup_failure` / ... | 讀同段輸出的 `--log-failed` 節錄，進失敗處置流程（post-push 場景見下表『Push 後政策』） |
| 2 | `UNAVAILABLE (workflow '<X>' 不存在；可用：…)` | **名稱傳錯，不是環境問題。**照訊息列出的清單挑**檔名**重派一次，**NEVER** 當成「watcher 起不來」略過——那會讓這次 push 完全沒有 CI 驗證 |
| 2 | `UNAVAILABLE (<其他原因>)` | gh 不存在 / 未登入 / API 連續失敗——一行回報略過，**NEVER** 追問 user |
| 3 | `WATCH_TIMEOUT` | run 可能仍在跑（輸出含最後已知狀態 + run id）。可再派一輪 `run <run-id>` 續盯，或依場景處置 |

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
3. 要**改監看目標**（例如發現該盯另一條 run）：**kill 舊 background bash、派新命令**。**NEVER** 嘗試對跑一半的 watcher「下改派指令」——那是 Agent watcher 時代的失敗模式，script 沒有也不需要互動管道

## NEVER

- **NEVER** 用 LLM watcher 監看 CI（本 skill 的存在理由；例外見下）
- **NEVER** 用事件流型通知器做「完成了告訴我」的單次通知
- **NEVER** 前景 `gh run watch` / 主線 `sleep` 輪詢 block 對話
- **NEVER** 手寫 ad-hoc `until ...; do sleep ...; done` 輪詢取代本 script——ad-hoc loop 幾乎必漏 terminal state 覆蓋（cancelled / 取代追蹤 / UNAVAILABLE），那些坑 script 都處理了
- **NEVER** 輪詢間隔 <30s（script 已 clamp，手寫查詢 loop 也適用同紀律）
- **NEVER** 把「沒收到通知」解讀成任何結論——用 target adapter 的 owner-status 查詢確認它還活著；**NEVER** 讀取未經 adapter 整理的 background output（那會把 output 送進 context，在 control-turn allowlist 之外）
- **NEVER** 同一條 run 重複派第二個 watcher（改目標 = kill + 重派）
- **NEVER** 在 dispatch 當下才 `--commit "$(git rev-parse HEAD)"`——`HEAD` 是活的，多 session 下可能已經不是你發版的那個 commit（見 § 目標 ref MUST pin 在你剛推的那一個）
- **NEVER** 對「這次 diff 不會觸發」的 workflow 派 watcher（例：沒動 `supabase/migrations/` 卻派 migration gate）——它不會有 run，只會等滿 `WATCH_TIMEOUT`。派之前先確認該 workflow 的 `on:` 觸發條件被本次 diff 命中

## 例外：什麼時候仍可用 Agent

只有當「完成後的**處置**」需要多步 LLM 工作且 user 明確要求全自動接手時（例如「紅燈就自己修到綠」），才包一層 Agent——而且該 Agent 內部**仍 MUST** 用本 script 等待，等待本身永遠不交給 LLM。純監看 + 回報（絕大多數場景）一律直接 background Bash。

## Cross-ref

| 主題 | 位置 |
| --- | --- |
| Push 後何時觸發監看、綠燈/紅燈後主線的處置政策（target decision surface / HANDOFF 登記） | 本 skill § Push 後政策：`git push` 成功且 repo 含 `.github/workflows/*.yml` 時 MUST 立刻派 watcher；`success` → 一行報 `v<version> CI 綠燈 — <runUrl>` 後結束；失敗類 → target decision surface 二選一 `[1] 立刻 root-cause + 修` / `[2] 登記 HANDOFF.md`（`- [ ] [<date>] v<version> CI <fail|timeout> — <job>` + Run URL + 根因猜測）；`UNAVAILABLE` → 一行報略過 |
| Script 本體 | skill-local `scripts/gh-ci-watch.sh`（由 resource declaration 投影至本 skill） |
| 背景派工通用回報契約 | `rules/core/agent-routing.dispatch-execution.md` § Subagent 回報契約 |


## Cursor host contract

Set `GH_CI_WATCH=.cursor/skills/gh-ci-watch/scripts/gh-ci-watch.sh`, then run `bash "$GH_CI_WATCH"` through the Cursor terminal/background command facility when it exposes an owner and completion notification. If no background facility is available, stop with the watch blocked and report the unavailable completion surface; never replace it with a Task or LLM watcher.
