# 2026-10-03 worktree／stash 殘留清理 — 結果與殘工

> 本 brief 是**工作指令**，不是待辦盤點。`\nx` / `\my` / 收工判定不適用於剛被派出的 pane——
> 即使 brief 讀起來像「已完成 ＋ 剩餘」清單也一樣。MUST 先把 brief 的每一項實際做完再回報。

## 給 successor

你是**繼任者**，接手整個位置，不是被派去做某件子工作的 worker。上一棒是無 coordinator 的 dispatch child，依派工指令把需要人拍板的題目寫進本檔、走 relay 交棒；它不能在自己的 pane 問人。

- repo／cwd：`<home>/offline/nuxt-supabase-starter`（main checkout）；本檔放在 root `tasks/`，**尚未 commit**，歸本線所有
- 先讀本檔與 `template/.claude/skills/clade-delivery/rules/commit.detail.md` § Stash 自動處置 gate、`template/.claude/skills/handoff/SKILL.md` § 3.5／3.5.1，再自行續跑
- 要做的事：
  1. 用互動提問向 Charles 確認三題：(a) stash `@{0}`–`@{7}`、`@{9}`、`@{10}` 是否 drop（主線建議 drop）；(b) stash `@{8}`／`@{11}`／`@{12}` 要先比對再決定，還是直接保留；(c) tracked 的死 hook `.husky/pre-commit` 是否刪除（刪的話要一起改 `.claude/rules/meta-repo.md`、`starter-hygiene.md` 的引用，並走 `/commit`）
  2. 依 Charles 的答案執行：drop 前先留痕（逐條記下 `--stat`），**NEVER** `git stash clear`
  3. 第 C 段的 12 棵樹：先重跑下方 retire dry-run。clade 修好 fail-closed 判定之前它一定 retained，這時**不要**繞過，在本檔記一行「仍被擋＋日期」即可
  4. batch `1e3dbdb6` 要 reconcile journal，屬於 clade batch lifecycle 的範圍；在本檔的重複成因段保留證據，不自行改 journal
  5. 最後依實際結果更新本檔的彙總表，走 `/commit` 收錄本檔
- 安全邊界：main 的 3 個未 commit 檔不碰；open PR #25／#26 的 branch 不碰；不修 clade 源檔；不送 `herdr-session-handoff.ts --complete`
- 上一棒沒有 in-flight dispatch，也沒有 background task

**接手後執行狀態（2026-10-03，繼任者）**：1–5 都已處理完。三題由 Charles 拍板（全部採推薦）；(c) 執行前發現前提錯誤，改成不刪除，原因見〈Root `.husky/pre-commit`〉段。

來源：clade 主線 2026-10-03 fleet 殘留清理派工（無 coordinator）。範圍：worktree 分類回收、stash 處置、死 hook 目錄；main WIP、lifecycle 遷移、open PR branch 內容不碰。

## 結果彙總

| 終態 | 數量 |
| --- | ---: |
| removed（`wt-helper cleanup`，branch 一併刪） | 1（`green-pr-0a-1001`） |
| retired | 0 |
| retained：open PR＋活 claim | 2 |
| retained：batch journal 對不上 | 2 |
| retained：value-first 已過、`handoff-retire` fail-closed | 12 |
| stash dropped（Charles 拍板，逐條留痕） | 13 |
| stash retained | 0 |

| 量測 | 前 | 後 |
| --- | ---: | ---: |
| `git worktree list \| wc -l`（含 main） | 18 | 17 |
| `git stash list \| wc -l` | 13 | 0 |

## Worktree retained 明細

### A. open PR＋活 claim（正確保留，不動）

- `new-project-gaps-amms` — PR #26 OPEN、active claim、dirty 16
- `td017-index-sync` — PR #25 OPEN、active claim

### B. batch `1e3dbdb6` journal 對不上（要 reconcile）

- `s6-draft-ci`、`batch-1e3dbdb6-…`；另有 batch 持有的 branch-only ref：`tmp/s6-origin-isolate`、`tmp/s6-spotcheck-draft`、`session/2026-10-03-0248-aixbdd-b3-baseline`
- `wt-helper batch cleanup` 逐字理由：`landed commit a22908c61c05… is not an ancestor of refs/heads/main; batch retained — check whether main was rewritten or the journal recorded the wrong landed head/merge sha, reconcile the batch, then retry cleanup`
- 證據：PR #2 MERGED，GitHub `headRefOid=2b5b9fda`（`tmp/s6-origin-isolate`），squash 成 `b96a67a0`；journal 記的 landed head 是 `a22908c6`。`git cherry origin/main codex/batch-1e3dbdb6…` 32 筆全是 `-`（內容已等價落地）。
- `batch confirm-merged` 需要 GitHub head.sha 等於 reviewed source_head，這裡不相等，因此**沒有**合格 receipt 可補，依 batch.md 保留。

### C. value-first 已過，但被 `handoff-retire.ts` fail-closed 擋下（12 棵）

主線判定：以下每棵都**沒有** customer／product demand、incident／data-security 風險、delivery blocker，可以直接退休：

| worktree | 判定依據 |
| --- | --- |
| `starter-td004-roadmap-drift-diagnose` | PR #7 MERGED；殘留只有 `.clade/flow/events.jsonl`＋未追蹤 `tasks/*-cx2-*.md` |
| `starter-td010-csrf-decision` | PR #4 MERGED；殘留只有 `.clade/**` journal＋tasks receipt |
| `starter-td012-lint-guard-verify-close` | PR #6 MERGED；同上 |
| `td008-validate-starter-placement-plan` | PR #8 MERGED；同上 |
| `td010-better-auth-csrf-exclusion` | PR #9 MERGED；同上 |
| `starter-backlog-close` | PR #10 MERGED；殘留只有 `.clade/**` journal |
| `starter-td017-temp-cleanup` | PR #5 CLOSED；TD-017 由 PR #25 承接並結案 |
| `starter-gate-pack` | `git cherry` 為 `-`，內容已等價落地 |
| `pnpm-11` | 只有 clade v1.12.4 升級＋merge commit，已被後續版本（v1.13.x）取代 |
| `selfhosted-smooth` | pnpm pin 11.24.0 已在 main；閒置 30 天，沒有 demand |
| `scaffold-quality-readiness` | TD-685（clade）已在 main 以 `ef94e035`／`f34a1f45`／`dd2b122e`／`3db2f949` 落地 |
| `batch-bd4154c9-…` | ahead 0；staged 只有 2026-09-06 的 tech-debt archive／tasks 檔，已過時 |

Retire 逐字理由（每棵都一樣）：`process currently has candidate as cwd: pid 1535 (/usr/lib/systemd/systemd --user) [cwd unreadable], pid 1542 ((sd-pam)) [cwd unreadable], pid 2125 (/usr/bin/ssh-agent …) [cwd unreadable], pid 1150676 (node …/<consumer-a>-wt/td-735-parallel-run-tooling/…)`

根因（已驗證）：`kernel.yama.ptrace_scope=1`，`systemd --user`／`sd-pam`／`ssh-agent` 是 non-dumpable，`readlink /proc/<pid>/cwd` 回空；pid 1150676 的 cwd 是已刪除的 <consumer-a> worktree（`(deleted)`）。`handoff-retire.ts` 會把每一個 cwd 無法證明的 process 當成所有候選的寫入者，所以在這台機器上 retirement **永遠**不會執行。關掉 sandbox 重跑也是同樣結果。

**後續**：等 clade 修好 `handoff-retire.ts` 對 non-dumpable／`(deleted)` cwd 的判定後，重跑：

```bash
cd <home>/offline/nuxt-supabase-starter
node ~/offline/clade/vendor/scripts/handoff-retire.ts --cwd "$PWD" --apply --json \
  --value-first no-demand-no-risk-no-blocker \
  --manifest "$PWD/template/docs/archives/retired-work.jsonl" \
  --exclude-path "$PWD/../nuxt-supabase-starter-wt/new-project-gaps-amms" \
  --exclude-path "$PWD/../nuxt-supabase-starter-wt/td017-index-sync"
```

**NEVER** 用裸 `git worktree remove`／`git update-ref -d` 繞過。

- 2026-10-03 繼任者重跑 dry-run：仍被擋，`retained=20`，理由相同（pid 1150676＋systemd --user／sd-pam／ssh-agent 都是 cwd unreadable）。沒有繞過。

## Stash（13 筆全部 drop，Charles 2026-10-03 拍板）

沒有一筆通過 commit.detail § Stash 自動處置 gate 的**自動**放行（判準 1 可重生清單太窄，見重複成因 5），所以改由 Charles 逐題拍板。drop 前逐條核對 sha，從 `@{12}` 往下 drop，沒有用 `stash clear`。物件在 reflog 過期前都還能用下表的 sha 取回（`git stash apply <sha>`）。

| stash | sha | 建立時間 | 內容 | `--stat` 摘要 | 拍板依據 |
| --- | --- | --- | --- | --- | --- |
| `@{0}` | `59108807` | 09-18 15:48 | lint-staged 備份 @ clade v1.13.13 | 124 files, +238 −8208 | clade 投影快照，main 已是更新版本 |
| `@{1}` | `909377e2` | 09-18 08:33 | lint-staged 備份 @ v1.13.12 | 124 files, +236 −8208 | 同上 |
| `@{2}` | `29ed2072` | 09-18 07:27 | lint-staged 備份 @ v1.13.12 | 124 files, +234 −8208 | 同上 |
| `@{3}` | `f0773b39` | 09-18 06:50 | lint-staged 備份 @ v1.13.12 | 124 files, +232 −8208 | 同上 |
| `@{4}` | `422d5b22` | 09-18 06:27 | lint-staged 備份 @ v1.13.12 | 124 files, +230 −8208 | 同上 |
| `@{5}` | `d5cfcb8d` | 09-18 03:45 | lint-staged 備份 @ v1.13.10 | 124 files, +228 −8208 | 同上 |
| `@{6}` | `1772dcbf` | 09-18 01:38 | lint-staged 備份 @ v1.13.9 | 124 files, +226 −8208 | 同上 |
| `@{7}` | `e84d7862` | 09-17 22:25 | lint-staged 備份 @ v1.13.8 | 124 files, +182 −8208 | 同上 |
| `@{8}` | `2d6889da` | 09-11 00:23 | lint-staged 備份 @ `8e534e53` | 966 files, +44631 −8345 | 和 main 比對：230 檔相同，其餘 736 檔都在 `.claude`／`.cursor` 投影（已移除的 specformula skills 等）＋`wt-*.ts`、`vendor/*/PIN.json`、`preset.ts`；vendor 業務碼和 main 相同 |
| `@{9}` | `1903e473` | 09-11 00:22 | hub-sync leftover before consistent-state propagate | 375 files, +20712 −4379 | clade 投影快照 |
| `@{10}` | `d7badc8c` | 09-11 00:14 | failed 1.12.45 retry leftover | 378 files, +21259 −3868 | clade 投影快照 |
| `@{11}` | `3ff1345a` | 09-03 13:46 | `feat/new-project-question-catalog` pre-merge isolate | 3 files, +88 | evlog migration 和 main 的 `template/supabase/migrations/` 與 `template/presets/evlog-baseline/` 兩份逐位元組相同；`.husky/commit-msg` 只差 shebang |
| `@{12}` | `281c234f` | 09-03 10:19 | lint-staged 備份 @ question-catalog | 36 files, +1023 −122 | 新增的 404 行不重複內容有 382 行已在 main；剩下 22 行是後來重構掉的舊寫法（`register-consumer`、`docs/verify/` 路徑等） |

## Root `.husky/pre-commit`：**不是**死 hook（上一棒誤判，沒有刪除）

Charles 依「hooksPath 改了，所以它不會被執行」這個前提同意刪除。但執行前查證發現前提不成立：

- `template/.vite-hooks/pre-commit` 第 10–14 行：只要 root 有 `scripts/audit-template-hygiene.sh` 和 `.husky/pre-commit`，就會 `(cd "$_REPO_ROOT" && bash .husky/pre-commit) || exit 1`。這是 `264fa67f`（「讓 repo 根的洩密掃描真的會執行」）刻意接上的線。
- `.husky/pre-commit` 會 source `scripts/audit-template-hygiene.sh`，跑 starter hygiene 的 staged 檢查（含 `real-tenant-identifier` 投影面 ratchet）。`starter-hygiene.md` 的「三個投影目錄只在 pre-commit hook 生效」講的就是它。

刪掉它就是拆掉 template 洩密防護，所以保留不動，`meta-repo.md`／`starter-hygiene.md` 的引用也正確，不用改。
真正已經沒人呼叫的是舊的 `.husky/pre-push`，目前已不在版控（`git ls-files .husky` 只剩 `pre-commit`）。

## main working tree（未碰）

3 個未 commit 檔：`template/.claude/settings.json`、`template/.gitignore`、`template/.vite-hooks/pre-push`。從內容看不出歸屬，疑似 clade propagate 投影的殘留。brief 寫「main 乾淨」與實況不符。

## 重複成因（給 clade 端 plan）

1. **`handoff-retire.ts` 在 ptrace_scope=1 的機器上永遠 fail-closed**：non-dumpable 的 user process（systemd --user、sd-pam、ssh-agent）與 cwd 為 `(deleted)` 的孤兒 process 都被當成候選樹的寫入者。結果所有歷史樹都退休不了。
2. **`handoff-lifecycle.ts --apply` 重驗 fence 時誤判**：`green-pr-0a-1001` 明明列在 `git worktree list` 裡，卻回 `stale-plan: current fence unknown (worktree not listed)`，安全集合變成 no-op。改直接跑 planner 給的 `wt-helper cleanup` 才收掉。
3. **PR 已 merge 的 session 樹永遠進不了安全集合**：worktree 內的 `.clade/flow/events.jsonl`、`.clade/ai-control-plane/runtime-events.jsonl` 會被寫入，再加上 dispatch 留下未追蹤的 `tasks/*-cx*-*.md` receipt，planner 算成 `userWip>0`。本次有 6 棵是這個原因。
4. **PR 從另一條 isolate branch 開出時，batch journal 記錄的是 pre-squash head**（s6：journal 記 `a22908c6`，PR head 是 `2b5b9fda`）。`batch cleanup`／`confirm-merged` 都無法 reconcile。
5. **lint-staged 自動備份 stash 在 clade 升級 commit 期間累積**（13 筆中有 8 筆）。內容是 `.cursor/**`、`.pi/**` 與 vendor 投影的 `scripts/*.ts`，但這些都不在 stash gate 的可重生清單裡，所以 gate 永遠不命中，stash 只增不減。
6. ~~`.husky/` 改 hooksPath 後沒有從版控移除，留下 tracked 的死 hook。~~ 更正：`.husky/pre-commit` 由 `template/.vite-hooks/pre-commit` 轉呼叫，仍然生效。誤判原因：只看了 `core.hooksPath`，沒查 dispatcher 有沒有轉呼叫。

## 檔案所有權

上一棒只動了 `green-pr-0a-1001` worktree＋branch（已移除），以及本檔。繼任者 drop 了 13 筆 stash（Charles 拍板），並更新本檔。其他 worktree、main 的 3 個 WIP 檔、`.husky/` 都沒碰。
