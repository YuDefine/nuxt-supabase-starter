---
name: gh-ci-watch
description: "Use immediately after a successful git push when the repo has GitHub Actions and CI / deploy completion must be watched — including slice draft PRs; also use when 查詢某 run 或某 SHA、撈 run log 證據、查 runner 佇列、查 PR 狀態（能不能合、draft、checks、head 對不對、與 main 衝突）、撞 GitHub API 限流。CI 紅燈修回同一張 PR。NOT for 修 CI 紅燈本身的實作步驟（那是拿到結果後的除錯流程）。"
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: read-only
---

<!-- clade-skill-scope: both -->

# /gh-ci-watch — GitHub Actions 與 PR 狀態的監看 / 查詢唯一入口

監看 CI 由 skill-local script 機械輪詢到 terminal state，主線只在完成時收到一次通知；一次 `gh` call 拿得到的答案則前景查詢。script 由 adapter 綁定成 `$GH_CI_WATCH`（clade home 是 `capabilities/core/scripts/gh-ci-watch.sh`）。

# SOP

## Phase 1 -- 判定監看或一次性查詢

1. THINK 一次 `gh` call 拿得到答案（查 run、撈 log 證據、查 runner 佇列、查 PR 狀態、撞 API 限流）就是查詢，跳到 Phase 5；要等 terminal state 才是監看。
2. THINK 先讀取 `rules/監看機制判準.md`，確認本次用 script 機械輪詢、不用 LLM watcher／前景 watch／ad-hoc 輪詢，並確認該 workflow 的 `on:` 會被本次 diff 觸發；不會觸發就回報並停止。

## Phase 2 -- 固定目標 ref 並選派工命令

1. THINK 先讀取 `rules/目標ref與場景選擇判準.md`，依「切片 draft PR／merge 後 staging／已知 run id／tag 觸發／branch push／指定 SHA」選定不可變 ref、命令形狀與 flags。
2. READ 若 workflow 檔名不確定，先跑 `gh workflow list`。

## Phase 3 -- 背景派出 watcher

1. DELEGATE 由 target adapter 的 background command runner 執行選定的 `bash "$GH_CI_WATCH" <run|workflow> …`（cwd＝該 repo，或帶 `--repo <owner>/<repo>`），主線繼續原工作；核對 script 第一行回顯的 subject 與 tag 是剛推的那一個。
2. THINK 要改監看目標時，kill 舊 watcher 再派新命令；要確認 watcher 還活著，只用 adapter 的 owner-status 查詢。

## Phase 4 -- 收到完成通知後分流

1. READ 讀取輸出尾段（`=== CI WATCH RESULT ===` 起）。
2. THINK 先讀取 `rules/RESULT分流與push後政策.md`，依 exit code／`RESULT:` 與 push 情境（切片 PR base `main`／`integration/<work-id>`、發版 push）處置並主動回報。
3. THINK 紅燈時先讀取 `rules/紅燈先比最後綠燈判準.md`，跑 `RANGE` 逐條看 commit 判定起點，再進 root-cause。

## Phase 5 -- 一次性查詢

1. DELEGATE 先讀取 `references/gh-commands.md`，前景執行對應的 `gh run`／`gh pr view`／`gh api` 命令。
2. THINK 查的是 PR 狀態或撞了 API 限流時，先讀取 `rules/PR狀態與限流判讀判準.md`，依 predicate 判讀並處置；要等這張 PR 的 CI 出結果就回到 Phase 2。


## Claude host contract

Set `GH_CI_WATCH=.claude/skills/gh-ci-watch/scripts/gh-ci-watch.sh`, then run `bash "$GH_CI_WATCH"` with Claude `Bash` using `run_in_background=true`; retain the returned owner and use `TaskOutput(block=false)` only for owner status. Never start an LLM watcher or read raw Bash output.
