# Rule 1 - 目標 ref MUST pin 在剛推的那一個不可變 ref，NEVER 在派工當下才取活的 `HEAD`

- Level: `MUST`
- **NEVER** 在 dispatch 當下才 `--commit "$(git rev-parse HEAD)"`：別 session 可能已推了新 commit，盯錯目標會一路 pending 到 `WATCH_TIMEOUT`。
- 先決定 ref，再選場景命令。用不可變的 ref 取代活的 `HEAD`，三選一：

| 情境 | 用什麼 |
| --- | --- |
| 發版 tag 已打（post-push 標準場景） | `--tag "v<version>"`——tag 指向的 commit 不會變（例外見 Rule 3） |
| run id 已知（`gh run list -c <sha>` 查得到） | `run <run-id>`——完全免疫 ref 變動 |
| 沒有 tag，只有 branch push | push **之前**先 `DEPLOY_SHA=$(git rev-parse HEAD)`（切片 PR 用 `SLICE_SHA`），dispatch 時用 `--commit "$DEPLOY_SHA"` |

- `--commit` MUST 給完整 SHA（script 會嘗試展開縮寫，展不開回 `UNAVAILABLE`）。
- script 第一行回顯目標 commit 的 subject、所屬 tag 與是否為當前 HEAD；`is-HEAD: no` 本身不是錯誤，要核對的是 subject 與 tag 是不是剛推的那一個：

```text
[watch] target commit 4484a133 = "🚀 deploy: 發布新版本 v1.258.0" (tags: v1.258.0, is-HEAD: no)
```

## Good Example

- 這個例子是好的，因為 SHA 在 push 前就存下，之後別人再推也不影響。

```bash
DEPLOY_SHA=$(git rev-parse HEAD) && git push
bash "$GH_CI_WATCH" workflow deploy-production.yml --commit "$DEPLOY_SHA"
```

## Bad Example

- 這個例子是壞的，因為派工那一刻的 `HEAD` 可能已是別人的 commit。

```bash
git push && sleep 60 && bash "$GH_CI_WATCH" workflow ci.yml --commit "$(git rev-parse --short HEAD)"
```

# Rule 2 - 依推送情境選命令形狀

- Level: `MUST`
- workflow 識別字串一律傳檔名（`ci.yml`），**NEVER** 傳 display name 或自己想的簡稱；傳錯時 script exit 2 並印出實際 workflow 清單。拿不準先跑 `gh workflow list`，或改用已知 run id。
- run 尚未建立也可以直接派：script 把「查無 run」視為 pending（預設只認腳本啟動前 120s 之後建立的 run，`--since <ISO8601>` 可調）。run 被 concurrency `cancel-in-progress` 取代時，script 自動改追 superseding run（同 workflow＋同 branch＋同 event＋同來源 repo、createdAt 較新者；event 或來源 repo 判不出來就不追，回 `cancelled`）；帶 `--commit`／`--tag` 時 successor 還 MUST 是同一個 SHA——接手的是別個 SHA 就回 `cancelled`（exit 1）並印 `SUPERSEDED_BY: run <id> @ <sha>`，**NEVER** 把較新 commit 的綠燈當成目標 commit 的結果。沒釘 commit（`run <id>`／只給 `--branch`）才跨 SHA 追，換 SHA 時報告多一行 `FOLLOWED_FROM:`，`RESULT` 屬於 `SHA:` 那一行的 commit。
- 同 SHA 多條 run（rerun 過／concurrency 產生）取 createdAt 最新一條；失敗照實回報 `RESULT: failure`，不默默等 rerun——failure 的處置是主線的事。

| 情境 | 命令 | 要點 |
| --- | --- | --- |
| 切片 draft PR（slice owner 剛 push session branch 並開 draft PR） | `bash "$GH_CI_WATCH" workflow ci.yml --commit "$SLICE_SHA"` | 盯該 PR 的 head SHA，不盯 `main`。先判 PR base：單切片工作 base `main`；integration 模式（同一 work id ≥2 切片，見 [[github-flow]] § Integration branch）base `integration/<work-id>`，同樣要盯。兩者的 run 都只有機械檢查（lint／fmt／typecheck／doctor），test-lane 要等 PR 轉 ready 才跑，這裡的綠燈 **NEVER** 讀成測試通過 |
| merge 後 staging 精確 SHA（coordinator squash 後） | `bash "$GH_CI_WATCH" workflow deploy-staging.yml --branch main --commit "$MERGE_SHA" --no-follow` | 盯該 `MERGE_SHA`，不追下一個 main SHA；selector 不能精確篩選時，先查出滿足 workflow＋main＋SHA 的 run id，再 `run <run-id> --no-follow` |
| 已知 run id | `bash "$GH_CI_WATCH" run <run-id>` | 免疫 ref 變動 |
| 某 workflow 最新一條 run（branch push） | `bash "$GH_CI_WATCH" workflow deploy-staging.yml --branch main` | 只在沒有更精確 ref 時用；能先存 SHA 就加 `--commit` |
| 某 SHA 的某 workflow | `bash "$GH_CI_WATCH" workflow deploy-production.yml --commit "$DEPLOY_SHA"` | 已經有 tag 時改用 `--tag` |
| tag 觸發的 workflow | `bash "$GH_CI_WATCH" workflow ci.yml --tag "v$(node -p 'require("./package.json").version')"` | 見 Rule 3 |
| 完成後順帶抓證據行 | 任一命令加 `--evidence-grep <ERE>` | pattern 要收斂成具體字串；寫法與反例見表下 |

- terminal report 一律自帶：`RESULT:` 行、run URL、各 job 耗時、失敗時 `--log-failed` 前 200 行；`--evidence-grep` 額外對 full log 撈前 40 行命中，如 `--evidence-grep 'Deploy complete|digest: sha256'`（script 走 `grep -E`，alternation 用裸 `|`；別用 `image|build` 這種寬 pattern）。

## Good Example

- 這個例子是好的，因為切片 PR 盯的是自己的 head SHA，且知道綠燈只代表機械檢查。

```text
SLICE_SHA=$(git rev-parse HEAD); git push -u origin session/…; gh pr create --draft …
bash "$GH_CI_WATCH" workflow ci.yml --commit "$SLICE_SHA"
→ success：回報「機械檢查綠（draft，test-lane 未跑）」
```

## Bad Example

- 這個例子是壞的，因為傳了 display name，且盯的是 main 而不是切片 head。

```text
bash "$GH_CI_WATCH" workflow "CI" --branch main
```

# Rule 3 - tag 觸發的 workflow MUST 用 `--tag v<version>`，NEVER 用 `--branch main`

- Level: `MUST`
- tag 觸發的 run 其 `headBranch` 是 tag 名，`--branch main` 永遠篩不到，一路等到 `WATCH_TIMEOUT`。
- 例外：**同一支** workflow 同時由 main push 與 tag push 觸發時，`--tag` 解析成 SHA 後兩條 run 在同一個 SHA 上、分不開；要判「這個 tag 有沒有觸發」改用 `headBranch` 過濾——見 `capabilities/core/skills/commit/SKILL.md` § Step 6-A。

## Good Example

- 這個例子是好的，因為 release workflow 只由 tag 觸發，用 `--tag` 精確對到。

```bash
bash "$GH_CI_WATCH" workflow release.yml --tag v1.258.0
```

## Bad Example

- 這個例子是壞的，因為 tag run 的 `headBranch` 不是 main，永遠篩不到。

```bash
bash "$GH_CI_WATCH" workflow release.yml --branch main
```

# Rule 4 - flags 依共用額度與 runner 排隊實況設定

- Level: `MUST`

| Flag | 預設 | 判準 |
| --- | --- | --- |
| `--tag <name>` | — | 解析該 tag 指向的 commit 當目標；與 `--commit` 互斥。post-push 場景首選 |
| `--interval <sec>` | 30 | **<30 會被 clamp 回 30**（GitHub API 紀律）。同一個 token 下有多個 agent／pane 同時在盯時用 `--interval 120`——5000/hr 是全工具、全 agent 共用額度 |
| `--timeout <sec>` | 3600 | 單槽 self-hosted runner queued 30+ 分鐘是常態，**NEVER** 因為「應該很快」調低到 <1800 |
| `--no-follow` | 追 | cancelled 時不追 superseding run（罕用：刻意驗證 cancel 行為，或 merge 後 staging 精確 SHA） |

## Good Example

- 這個例子是好的，因為多個 pane 同時盯時放寬間隔，保住共用額度。

```bash
bash "$GH_CI_WATCH" run 36963721337 --interval 120
```

## Bad Example

- 這個例子是壞的，因為 timeout 太短，排隊中的 run 會被誤報 `WATCH_TIMEOUT`。

```bash
bash "$GH_CI_WATCH" workflow ci.yml --commit "$SHA" --timeout 600
```
