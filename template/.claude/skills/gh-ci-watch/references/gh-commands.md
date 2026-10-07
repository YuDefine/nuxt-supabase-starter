# gh 一次性查詢指令

一次 `gh` call 拿得到答案的查詢，前景跑即可，不派 background。判讀見 `rules/PR狀態與限流判讀判準.md`。

## run 與 log

```bash
# 列最近 run（含狀態）
gh run list -L 10 --json databaseId,workflowName,status,conclusion,headBranch,createdAt,url

# 看單一 run 概要 / jobs
gh run view <run-id> --json status,conclusion,jobs,url

# 撈特定 log 行當證據
gh run view <run-id> --log | grep -E '<pattern>' | head -40

# 失敗 log 節錄
gh run view <run-id> --log-failed | head -200

# 單一 job 的失敗測試行（node:test 的 `not ok`、vitest 的 `✖`）
gh run view --job <job-id> --log | grep -E 'not ok|✖' | head -40

# 某 workflow 最後一條 success（補 LAST_GREEN: unknown）
gh run list -w <workflow> -s success -L 1

# base 同一條 workflow 最新 run（判 base 同紅）
gh run list -w <workflow> -b main -L 1 --json headSha,conclusion,url

# workflow 檔名清單
gh workflow list
```

## runner 佇列

```bash
# 單槽 self-hosted runner 排隊診斷
gh api "/repos/<owner>/<repo>/actions/runs?status=queued" --jq '.workflow_runs[] | [.id, .name, .head_branch, .created_at] | @tsv'
```

## PR 整體狀態

```bash
gh pr view <N> --json number,headRefOid,isDraft,mergeStateStatus,statusCheckRollup \
  --jq '{head: .headRefOid, draft: .isDraft, merge: .mergeStateStatus,
         checks: [.statusCheckRollup[] | {name: (.name // .context), state: ([.conclusion, .state, .status] | map(select(. != null and . != "")) | first)}]}'
```

## 限流

```bash
gh api rate_limit --jq '.resources.core | {remaining, reset: (.reset | todate)}'
```
