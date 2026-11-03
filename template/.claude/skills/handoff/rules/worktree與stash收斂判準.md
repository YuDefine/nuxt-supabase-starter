<!-- 跨檔的「下方／上方 §」皆指 rules/ 下同名段落 -->

## Step 3 — Worktree & Stash 稽核（共用 block，park / next 都會 invoke）

目的：把所有 linked worktree + stash 的當前狀態 + 下一步建議寫進 HANDOFF.md `## Worktree & Stash Audit` 段，避免歷史包袱累積。讀取與寫入摘要後，`park` / `next` 進入共用的 lifecycle drain；drain 只會執行已由 deterministic planner 判定安全的 cleanup，landing 仍交給 `/commit`。

### 3.1 Worktree audit

讀 `handoff-scan.ts --json` 輸出的 `worktreeStash` 段（next 在 §2B.1a 已跑過 → 直接共用該輸出；park 沒經過 2B.1 → 在此跑）：

```bash
# next：§2B.1a 已落檔到 $SCAN → 直接 jq，NEVER 重跑（各段子行程都要付費）
jq '.worktreeStash.raw' "$SCAN"
# park：沒經過 2B.1，在此落檔後同樣 jq 取段
# MUST mktemp 唯一路徑 + 驗 consumerId —— 固定路徑是全機器共用，會拿別 repo 的 stash 清單
# 做本 repo 的 3.2a drop 判定。完整規約見 scan-steps.md §2B.1a「$SCAN 路徑與歸屬」
SCAN="$(mktemp -t handoff-scan.XXXXXXXXXX)"
node ~/offline/clade/vendor/scripts/handoff-scan.ts --json > "$SCAN" 2>/dev/null
EXPECT="$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")"
GOT="$(jq -r '.consumerId // "MISSING"' "$SCAN")"
[ "$GOT" = "$EXPECT" ] && echo "scan ok: $GOT" || echo "SCAN-MISMATCH: got=$GOT expect=$EXPECT"
```

`SCAN-MISMATCH` / `MISSING` → **STOP，整份 `$SCAN` 作廢重跑**，NEVER 據此判 worktree / stash。

`worktreeStash.raw.worktrees[]` 每條已含 wt-helper list 欄位（`slug` / `branch` / `path` / `daysOld` / `mergedToMain`）+ kind 判定（`kind` / `nextStep`）。script 以 `wt-helper list --json --no-landed-state` 取資料，**不含** `landedState` / `landedReason` / `supersededBy` / `dirty`——要逐棵判「清樹會不會丟內容」直接跑 `node vendor/scripts/wt-helper.ts list --json`，可清 = `landedState ∈ {in-history, in-base}` **且** `dirty === 0`（`in-worktree` 的唯一副本是 main 未 commit 的改動，**NEVER** 讀成可清）；script 另掃 `git worktree list --porcelain`，非 `session/*` branch 的 worktree 列進 `raw.unmanagedWorktrees`。

**Gate（可觀察，先判再讀）**：`worktreeStash.raw` 的 `worktrees` / `unmanagedWorktrees` / `stashes` / `orphanSidecars` **四個陣列全空** → 本段無可判之物，**跳過 worktree-stash-audit.md 不讀**，直接照 § 3.3 寫 `No linked worktrees.` + `No stashes.` 的空 audit 段（該指令在本檔 § 3.4 末條，不依賴那份檔）。**任一非空** → 下面這條 MUST Read 生效，**NEVER** 憑 raw 摘要自行判 kind。

```bash
jq '[.worktreeStash.raw | .worktrees, .unmanagedWorktrees, .stashes, .orphanSidecars | length] | add' "$SCAN"   # 0 → 跳過；>0 → MUST Read
```

**MUST Read [worktree-stash-audit.md](../worktree-stash-audit.md) before proceeding**（`mergeBackSafety` 推導、kind 判定表、stash audit 欄位）。**NEVER** 憑 `mergedToMain` 單一欄位推斷可
cleanup —— `userWip > 0` 時 kind 要降級，而 `cleanup` 對未 commit 內容無 pinned ref 保護。`ptb-unsafe` 禁止 dispatch 收尾工作，走 § 2B.4.5 分流。

### 3.3 寫入 HANDOFF.md

寫到 `$MAIN_WT_PATH/HANDOFF.md` `## Worktree & Stash Audit` 段（不存在就建）。每跑一次 audit **整段覆寫**（不是 append，避免重複累積）。格式：

```markdown
## Worktree & Stash Audit

_Updated: <YYYY-MM-DD>_

### Worktrees (N)

- `<slug>` (`<branch>`) — **<kind>** — <下一步建議>
  - `<path>` (last activity <Nd> ago)

若 0 條：`No linked worktrees.`

### Stashes (M)

- `stash@{0}` (`<kind>`, slug=`<slug>`) — **<action>** — <reason>

若 0 條：`No stashes.`
```

### 3.5 Worktree lifecycle drain（park / next 共用）

Step 3 寫 audit 前，先把同一份 `$SCAN` 交給 deterministic planner：

```bash
node vendor/scripts/handoff-lifecycle.ts --cwd "$MAIN_WT_PATH" --json > "$LIFECYCLE"
```

Planner 的安全集合只有下列形狀：

| signal | action |
| --- | --- |
| `merged` + `userWip=0` + 無 active claim | 執行 `wt-helper cleanup <slug>` |
| `orphan` + `ahead=0` + `userWip=0` + 無 active claim | 執行 `wt-helper cleanup <slug>` |
| `unlanded-content-landed` + `contentLanded=yes` + clean | 驗 content receipt 後 cleanup |
| `integration-landed` + clean | 驗 `integrationLanded` 那條 integration 含本切片後 cleanup（NEVER 對 main merge-back） |
| `done-work` + work/evidence/patch receipt 全驗證 + clean | 驗 receipt 後 cleanup |
| `landable` + work complete + evidence + landing authorization + writer released | 登記 batch ready，呼叫 `/commit`，trigger=`drained` |
| 已 landed batch | 執行 `wt-helper batch cleanup` |

`--apply` 才執行上表的 cleanup；預設只輸出 plan。Planner 與 helper 都不生成 force flag：dirty、active claim、`partial`、`unknown`、缺 evidence、PR 未合入、submodule teardown 失敗及 unmanaged worktree 一律 `retain`／`report-only`。重跑同一份 landed batch cleanup 必須是 no-op 或逐項 retained，不能重跑品質鏈。

#### 3.5.1 Historical retirement（一次性 maintenance）

歷史 worktree／branch 不因 age、commit 數、未落地或 unknown 自動進 continuation。先用 value-first gate 判斷是否仍有 customer/product demand、current incident/data-security risk，或 direct delivery blocker；三者皆無才進退休流程，預設 continuation candidates 為 0。

退休入口只能是：

```bash
node vendor/scripts/handoff-retire.ts --cwd "$MAIN_WT_PATH" --apply --json \
  --value-first no-demand-no-risk-no-blocker \
  --archive-root "$RETIRE_ARCHIVE"
```

它逐筆保存 branch bundle、staged／unstaged patch、status／ignored／submodule evidence 與排除 `.git` 的完整 worktree tree，驗證 archive 後重新讀 active claim、process cwd、HEAD、branch 與 status snapshot；任一改變就 retained。worktree 移除前 MUST 先通過既有 environment／submodule destroy lifecycle；teardown 失敗就 retained。批次持有的來源先由正式 batch cleanup／cancel 處理，不能用 retirement 偽造 landing。移除只允許 exact `git worktree remove --force <path>` 與 exact `git update-ref -d <ref> <head>`，remote refs、main 與明確排除項永不碰。

退休 durable tombstone 寫進 flow spine（`.clade/flow/events.jsonl`，`kind: other` point、`payload.marker: worktree.retire`；讀寫入口 `vendor/scripts/retired-ledger.ts`），**NEVER** 再追加 `docs/archives/retired-work.jsonl`——舊檔只讀，歷史列照舊被讀者讀入（`--manifest` 只指舊檔位置，可省略）。spine 寫不進去（含 `CLADE_FLOW_OFF=1`）時該筆 retained、來源不動。已退休 identity 不得再由任何 handoff mode 推回 continuation 清單。重跑同一 manifest 應是 no-op／retained，並受固定 maintenance budget 限制。

輸出固定包含：

```text
Landed: N
Worktrees removed: N
Branches removed: N
Retained: N
```

成功移除項目不再寫回下一版 audit；retained 項目必須帶具體原因與下一個可觀察 landing signal。

retained 理由含 `[cwd unreadable]` 時：`systemd --user`／`(sd-pam)`（cgroup 為 `user@<uid>.service/init.scope`）與 cwd 已刪除的 process 已由 helper 排除；`app.slice` 裡白名單 unit（`ssh-agent.service`、`gcr-ssh-agent.service`）的 member 在 (unit, MainPID, 啟動時間) 三元組核對通過後放行；其餘（非白名單或核對不過的 `app.slice` user service、session scope 的中介 process、容器內 process）是刻意 fail-closed，**NEVER** 用 `--force` 類旗標或殺掉 session 基礎設施繞過。

退役 archive（`<repo>-retired/<date>/<entry>/`）的保存期限不靠 age：逐筆內容在別處都找得到才可刪。判定與刪除入口只能是：

```bash
node vendor/scripts/retired-archive.ts check --repo "$MAIN_WT_PATH" --json   # 唯讀：每筆 deletable 或 keep:<缺什麼>
node vendor/scripts/retired-archive.ts prune --repo "$MAIN_WT_PATH" --apply [--only <entry>]
```

`prune --apply` 只刪 `deletable` 且滿 14 天（`--min-age-days`）的筆，並追加 `<root>/prune-log.jsonl`。keep 的筆 **NEVER** 用 `rm -rf` 處置；要放棄 keep 理由列的內容，先把逐筆理由交使用者拍板。

### 3.6 禁止行為

- ❌ 自動跑裸 `git worktree remove` / `git update-ref -d` / `wt-helper merge-back` —— 這些不經 planner 的動作仍禁止；安全集合的 `wt-helper cleanup`、已 landed batch 的 `wt-helper batch cleanup` 與歷史 retirement 只能由 § 3.5／§ 3.5.1 的 canonical entrypoint 執行
- ✅ **`git stash drop` 是例外，且是 MUST 不是 MAY**：通過 [[commit.detail]] § Stash 自動處置 gate **全部**判準的 stash，Step 3.2 **MUST** 主動 drop + 留痕，**NEVER** 留給 user。判準未過、或跑不出明確結論的才寫進 audit 段
- ❌ 把 audit 條目改寫進 `## In Progress` / `## Blocked` 段 —— audit 是「待清紀錄」，不是 in-progress 工作
- ❌ park 跑時在 chat 訊息輸出 audit 全文或摘要 —— 完全靜默寫入 HANDOFF.md（避免雜訊干擾交接收尾）
- ❌ 偵測到無 worktree + 無 stash 就跳過整段 —— **仍要寫**「## Worktree & Stash Audit」段，內含 `No linked worktrees.` + `No stashes.`，讓接手 session 能確認 audit 已跑過、結果為空
