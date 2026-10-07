# Rule 1 - 依 exit code 與 `RESULT:` 分流，沉默 NEVER 等同成功

- Level: `MUST`
- 輸出尾段（`=== CI WATCH RESULT ===` 起）保證含 `RESULT: <state>` 行，涵蓋所有 terminal state。

| exit | RESULT | 主線處置 |
| --- | --- | --- |
| 0 | `success` | 一行回報綠燈＋run URL，依 Rule 3／Rule 4 的情境處置後結束話題。報告有 `FOLLOWED_FROM:` 行時，綠燈屬於 `SHA:` 那一行的 commit、不是最初盯的那個——回報時寫出驗到的 SHA |
| 1 | `cancelled` 且報告有 `SUPERSEDED_BY: run <id> @ <sha>` | 目標 commit 的 run 被別個 SHA 的 run 取代，**目標沒被驗到**。要那個較新 commit 的結果就 `run <id>` 重派；**NEVER** 把它的結果記成原 commit 的證據 |
| 1 | `failure`／`cancelled`（無 successor）／`timed_out`／`startup_failure`／… | 先讀 `LAST_GREEN:` 與 `RANGE:` 兩行（紅燈先比最後綠燈），再讀 `--log-failed` 節錄進失敗處置流程 |
| 2 | `UNAVAILABLE (workflow '<X>' 不存在；可用：…)` | 名稱傳錯，不是環境問題。照訊息列出的清單挑**檔名**重派一次，**NEVER** 當成「watcher 起不來」略過——那會讓這次 push 完全沒有 CI 驗證 |
| 2 | `UNAVAILABLE (<其他原因>)` | gh 不存在／未登入／API 連續失敗——監看可一行回報略過，**NEVER** 追問使用者；但 merge／staging gate **NEVER** 把 `UNAVAILABLE` 算成功或略過成功 |
| 3 | `WATCH_TIMEOUT` | run 可能仍在跑（輸出含最後已知狀態＋run id）。再派一輪 `run <run-id>` 續盯，或依情境處置 |

## Good Example

- 這個例子是好的，因為 exit 2 的名稱錯誤被當成要重派，而不是略過。

```text
exit 2：UNAVAILABLE (workflow 'CI' 不存在；可用：ci.yml, release.yml) → 重派 workflow ci.yml --commit "$SLICE_SHA"
```

## Bad Example

- 這個例子是壞的，因為把名稱錯誤當成環境問題略過，這次 push 沒有任何 CI 驗證。

```text
exit 2 → watcher 起不來，略過監看
```

# Rule 2 - 通知到了就主動回報，NEVER 沉默等使用者問進度

- Level: `MUST`
- 收到完成通知後，讀尾段、依 Rule 1 分流，並在同一輪主動回報結果與 run URL。

## Good Example

- 這個例子是好的，因為通知一到就回報。

```text
ci.yml 綠燈 — https://github.com/YuDefine/clade/actions/runs/36963721337
```

## Bad Example

- 這個例子是壞的，因為收到通知後沒有回報，等使用者來問。

```text
（通知已到，主線繼續別的工作，未提 CI 結果）
```

# Rule 3 - 切片 PR 的 push 後政策：紅燈在同一張 PR 修，綠燈依 base 分流

- Level: `MUST`
- `git push` 成功且 repo 含 `.github/workflows/*.yml` 時 MUST 立刻派 watcher；切片 PR 盯該 PR 的 head SHA／branch。
- `failure` → **同一 owner、同一張 PR** 修，再 push 同一個 head；**NEVER** 另開 PR。
- `success` → 一行報綠燈＋run URL，然後依 base 分：
  - base `main`（單切片工作）→ draft 維持 draft，completion 交 coordinator；綠燈 completion 喚醒同一 coordinator 收件並跑 `/commit`，不是請 Charles 代觸發，也 **NEVER** 由 worker 自己 ready／merge。
  - base `integration/<work-id>` → 本機門檻也已通過時，slice owner 自己 `gh pr ready` 該切片 PR 再交 completion（`integration-merge.ts --pr` 拒收 draft）。
- 兩種 base 的這條 run 都只含機械檢查，綠燈 **NEVER** 讀成測試通過（[[github-flow]] § Draft 不是 ready）。
- 背景派工的回報格式照 `rules/core/agent-routing.dispatch-execution.md` § Subagent 回報契約。

## Good Example

- 這個例子是好的，因為 base 是 main，綠燈後維持 draft 並交回 coordinator。

```text
PR #880（base main，draft）ci.yml success → 「機械檢查綠 — <url>」→ herdr-session-handoff --complete success --pr-disposition 880=handed-to-coordinator
```

## Bad Example

- 這個例子是壞的，因為 worker 把 draft 綠燈當成可以 ready，並另開 PR 修紅燈。

```text
PR #880 success → gh pr ready 880；PR #881 failure → 開 PR #882 修
```

# Rule 4 - 發版 push（main／tag）的 push 後政策

- Level: `MUST`
- `success` → 一行報 `v<version> CI 綠燈 — <runUrl>`。
- 失敗類 → 先跑 `RANGE`（紅燈先比最後綠燈），再二擇一：`[1]` 立刻 root-cause＋修，或 `[2]` 登記 `HANDOFF.md`。
- `UNAVAILABLE` → 監看可報略過；merge／staging gate 不得把 `UNAVAILABLE` 當成功。
- merge 後 staging：`cancelled`／failure／timeout 一律保留部署 blocker。
- CI／test workflow 自己取消過期 run 是 [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref 的責任；script 在 cancelled 時改追 successor 只是監看補救，不能代替 workflow `concurrency`。

## Good Example

- 這個例子是好的，因為發版綠燈只回報一行。

```text
v1.258.0 CI 綠燈 — https://github.com/YuDefine/clade/actions/runs/36963721337
```

## Bad Example

- 這個例子是壞的，因為 staging 監看 UNAVAILABLE 被當成通過，部署 blocker 被解除。

```text
deploy-staging.yml UNAVAILABLE → staging gate 視為通過，繼續 production
```
