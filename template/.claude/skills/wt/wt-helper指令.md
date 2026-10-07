# wt-helper 指令

`wt` 各 step 依需要分節讀取。旗標以 `node vendor/scripts/wt-helper.ts --help` 的實際輸出為準；本檔與 `--help` 不一致時以 `--help` 為準並回報漂移。

- 指令前綴：clade home 用 `node vendor/scripts/wt-helper.ts`、`node vendor/scripts/stash-reconcile.ts`；consumer 用 `node scripts/wt-helper.ts`、`node scripts/stash-reconcile.ts`。以下一律以 consumer 前綴表示。
- `add`／維護／復原指令從 main worktree 的 cwd 執行。`batch` 子指令的 state 在 git common dir，從同 repo 任何一棵 worktree 都能跑，以 `<source-path>` 指定目標樹；worker 在自己樹內登記 draft 就用 `batch draft "$PWD" …`，不必離開樹。
- zsh 呼叫時用陣列傳參：`A=(add <slug> --task-summary '<一句話>'); node scripts/wt-helper.ts "${A[@]}"`。
- 每一條指令「該不該跑、帶哪個策略」的判準不在本檔：建立前讀 `rules/fork前baseline判準.md`，保留、回收、stash 與復原前讀 `rules/worktree保留與回收判準.md`，進就緒池前讀 `rules/就緒池交接判準.md`。

## 建立

```bash
CLADE_WORK_ID=<work-id> node scripts/wt-helper.ts add <slug> \
  --task-summary "<一句話：這棵樹要做什麼>" \
  --precheck-baseline \
  --baseline-strategy stash
```

上例是「先檢查 main、不帶任何 WIP」的預設形狀：`--precheck-baseline --baseline-strategy stash` 不帶 `--include-unrelated-dirty` 時 main dirty 原封不動、新樹從 HEAD 乾淨分出，但 helper 會先查 unmerged 與別 session claim。完全不帶 baseline 旗標也是乾淨 fork，只是**跳過**這兩道檢查。要帶 WIP 的形狀見 `rules/fork前baseline判準.md`。

work id 用 ambient `CLADE_WORK_ID=<work-id>` 帶進（`W-…` 不是 `--origin` 收的 scheme）；呼叫端沒給 slug 時，由任務一句話取 2–4 個英文 kebab-case 字當 slug。

命名與位置（`wt-helper add` 自動處理，不必另問 branch 名稱）：

- branch：`session/<YYYY-MM-DD-HHMM>-<slug>`，時間戳對齊 session-tasks 慣例；`<slug>` 經 normalization：lowercase、空白與特殊字元轉 `-`、collapse 重複 `-`、trim 首尾 `-`。
- 樹的位置：`<consumer-parent>/<consumer-name>-wt/<slug>/`，即 `~/offline/<consumer>-wt/<slug>/`。monorepo 子目錄 consumer 以最外層 `.git` 解析 consumer root（例：starter 落在 `~/offline/nuxt-supabase-starter-wt/<slug>/`，不是 `~/offline/template-wt/<slug>/`）。

| 旗標 | 說明 |
| --- | --- |
| `--task-summary <text>` | **必填**（TD-664），一句話講清楚這棵樹要做什麼；缺了直接拒跑，沒有逃生口 |
| `--precheck-baseline [<change>]` | fork 前先偵測 main dirty，搭配 `--baseline-strategy`；裸用代表沒有 change context，帶 `<change>` 代表有 carrier |
| `--baseline-strategy commit\|stash\|warn` | `commit`：在 main selective stage 並 commit baseline 後再 fork；`stash`：main dirty 留在原處，從 HEAD fork 乾淨的樹；`warn`：停下並列出報告 |
| `--baseline-scope-paths <comma>` | `commit` 策略必填，selective stage 的範圍；`stash` 不支援，要 scoped capture 改用 `commit` |
| `--include-unrelated-dirty` | 只限 `stash` 策略：把 main **全部** dirty bulk-capture 進新樹，main 端變乾淨（預設關閉） |
| `--baseline-stash-name <name>` | 覆寫預設 stash 名 `wt-baseline/<slug>/<ISO>` |
| `--skip-prefork-audit` | 關掉 in-flight feature audit 警告（預設門檻 50 個 tracked 變更，可用 `WT_PREFORK_AUDIT_THRESHOLD` 覆寫） |
| `--base integration/<work-id>` | 從 integration branch fork（也接受 `origin/integration/<work-id>`）；其他 ref 一律拒絕 |
| `--expected-paths <comma>` | 這棵樹預期會寫的路徑，寫進 claim 供重疊偵測；省略時沿用 `--baseline-scope-paths` |
| `--origin <scheme>:<id>` | 指名這棵樹服務的工作，只收 `td:`／`notion:` 等 ref scheme（例：`td:TD-787`）；`W-…` work id 走 ambient `CLADE_WORK_ID`；兩者都沒有時卡片標為「未歸屬」 |
| `--machine <peer>` | 在對等機器的 clade checkout 上建樹（同一 repo 路徑，經 GitHub 同步，NEVER rsync／scp 工作樹） |

helper 的行為：

- **只有帶 `--precheck-baseline` 時**才先跑 `detect-main-dirty`：unmerged 非空就分流（安全殘留自動標 resolved，真衝突停下拒 fork）；dirty 路徑屬於另一個 active session 的 claim → STOP 拒 fork；clean 直接 fork；其餘 dirty 依所選策略處理（沒給 `--baseline-strategy` 時是 `warn`，有 dirty 就停下列報告）。不帶 `--precheck-baseline` 時以上都不跑，直接從 HEAD fork。
- branch 命名 `session/<YYYY-MM-DD-HHMM>-<slug>`，從 `main`（或 `--base` 指定的 integration branch）分出。
- worktree 建在 `<consumer-parent>/<consumer-name>-wt/<slug>/`；能 fast-forward 到 `origin/main`（或 `origin/integration/<work-id>`）就前進，不能時只警告 `could not fast-forward merge …` 並停在 fork 點。
- 成功時印出 `Path: <path>`、`Branch: <branch>` 與 `Handoff: {"cwd":…,"branch":…}`，由此取得樹的絕對路徑與 branch；並在 stderr 印出 `export CLADE_WORK_ID=<work-id>`。
- 已有同名路徑但沒有 `WORKTREE-BRIEF.md` 時，`add` 以「already exists」失敗。

### backing service 狀態行

consumer 有 per-worktree backing service（隔離的 dev DB clone 與它的 REST／Storage sidecar）時，`add` 與 `batch prepare` 在建樹後印一行 `backing-service: <status> …`；沒有這種拓樸的 consumer 不印。`add` exit 0 只代表樹建好了，**不**代表 REST 可用——以這一行的 `<status>` 為準。

| 狀態行 | 這棵樹現在有什麼 |
| --- | --- |
| `backing-service: ready db=<name> url=<url>` | DB clone 與 sidecar 都在，REST／Storage 可用 |
| `backing-service: created db=<name> [sidecar=deferred reason=<code>]` | DB clone 在、sidecar 沒起：打不到 REST／Storage。`sidecar=deferred` 表示 consumer 因容量不足選擇先不起，`reason` 是它給的代碼 |
| `backing-service: absent …` | 連 DB clone 都沒有 |
| `backing-service: unknown db=<name> url=<url>` | consumer 的 shim 沒回報狀態（舊版）：無法從這一行判斷 REST 可不可用，用到之前先跑 `node scripts/wt-env-bootstrap.ts status --worktree "<path>" --json` 確認 |
| （沒有這一行） | 此 consumer 沒有 per-worktree backing service |

狀態是 `created` 或 `absent` 時，下面緊接兩行：缺的是哪個 service（deferred 時附 consumer 回報的 admission 數字），以及通用補建指令 `補建：node scripts/wt-env-bootstrap.<ts|mjs> ensure --worktree "<path>" --json`（副檔名是該 repo 實際有的那一支）。補建仍回不到 `ready` 時怎麼處置（騰容量、改走別條路）是 consumer 的事，讀該 consumer 的 local rule，本檔不寫。

偵測 main dirty（建立前的 sanity check）：

```bash
node scripts/wt-helper.ts detect-main-dirty --json
```

## 批次

就緒池的完整命令、證據格式、觸發門檻、衝突續跑與落地順序以 commit skill 的 `batch.md` 為唯一正本；以下只列 `wt` Phase 3 直接用到的指令。

```bash
# 收割已驗證的 scoped checkpoint（不啟動完整 AI review）
node scripts/wt-helper.ts batch checkpoint <source-path> --work-id <work-id> --author <作者>

# 登記就緒（PR ready／品質入口）
node scripts/wt-helper.ts batch ready <source-path> --work-id <work-id> \
  --evidence <驗收證據檔> --authorize-landing --release-writer

# 評估觸發條件；NEVER 省略 --workflow
node scripts/wt-helper.ts batch status --trigger auto --workflow <workflow_model>
```

| 情境 | 指令 |
| --- | --- |
| 使用者要求 `/commit` 或 merge back | `batch status --trigger manual --workflow <workflow_model>` |
| 下游必須先落地／已授權開發皆完成或受阻／使用者結束本輪 | `--trigger dependency`／`drained`／`stop` |
| 需要保留來源 | `batch ready` 加 `--retain <owner 與下一個落地事件>` |
| 撤回單一來源的 ready 登記 | `batch unready <source-path> --reason <撤回原因>` |
| worker 開 draft PR 後登記可見性 receipt | `batch draft <source-path> --work-id <work-id> --pr <number> --kind visibility` |
| 整合衝突解完後續跑 | `batch resume` |

`batch` 的其他子指令（`prepare`、`review`、`seal`、`land`、`cleanup`、`yield-blocked`、`unlock-blocked` 等）由 `/commit` 依 `batch.md` 執行，`wt` 不直接呼叫。

### 落地後留下的樹：backing service 停放

`batch cleanup` 對已落地（landed commit 已驗在 main）的批次，凡是這一輪收不掉而留下的來源與整合區，會呼叫 consumer shim 的選配指令 `park`：只停 sidecar、保留 DB clone 與 env，騰出連線容量。結果列在 cleanup 輸出的 `parked` 欄（`parked`／`failed`）。

- 被停放的樹之後 `status` 是 `created`；要再用就跑上一節的補建指令（`ensure`）恢復。
- 有活 claim、claim 讀不到、或有行程的 cwd 在樹裡的樹不停放。
- `park` 是 `wt-env-bootstrap` 契約的選配第四個指令：`node scripts/wt-env-bootstrap.<ts|mjs> park --worktree <path> --json`，成功 exit 0。shim 沒實作時 MUST 在 stderr 寫明 `Unknown command`（任何 exit code），cleanup 當成 no-op；其他非 0 一律算停放失敗並列進 `parked`。

## 維護

| 動作 | 指令 | 說明 |
| --- | --- | --- |
| 列出 session worktree | `node scripts/wt-helper.ts list [--json] [--no-landed-state]` | 含 staleness 與 landedState；有 brief 的樹會顯示任務摘要與狀態 |
| 找 slug 對應的樹 | `node scripts/wt-helper.ts resolve <slug> [--json]` | 印出持有該 slug 的樹路徑；exit 3 代表沒有，main 為權威 |
| 累積報告 | `node scripts/wt-helper.ts backlog --json` | 唯讀處置佇列；超過 3 棵會警告 |
| 就緒池現況 | `node scripts/wt-helper.ts batch status --trigger manual --workflow <workflow_model>` | 使用者要求 merge back 時的入口；落地由 `/commit` 依 `batch.md` 執行 |
| 釋放 stale dev-port | `node scripts/wt-helper.ts reclaim-stale [--dry-run]` | 只釋放 port 槽，不動樹。三層機械判定：stale（持有行程已不在）自動釋放 record → live 不動 → unknown 才問使用者（attended）或 packaging（unattended） |
| 順便回收已落地的乾淨來源 | `node scripts/wt-helper.ts reclaim-stale --remove-landed` | 只回收已在 history、乾淨、無 claim 的來源（TD-863） |
| 互動移除已合併的樹 | `node scripts/wt-helper.ts prune` | 處理落地後殘留 |
| 清掉孤兒目錄 | `node scripts/wt-helper.ts orphan-prune [--force]` | 移除 `<consumer>-wt/` 底下 worktree 已移除後殘留的 gitignored 內容；先不帶 `--force` 看清單 |
| 修投影 receipt | `node scripts/wt-helper.ts reconcile <slug> [--json]` | rebase／merge main 後 `sync-rules` 報 `local or modified file conflict` 且樹已有 ownership receipt 時先跑，再重跑原同步指令；main 唯讀，protected skip 時 exit 1 |
| 重新 seed 投影狀態 | `node scripts/wt-helper.ts refresh-substrate [<slug>] [--dry-run] [--json]` | rebase 到新 clade 版後 `sync-rules --check` 紅、缺整份 substrate 時用；先 `--dry-run`；不在 main 用 |
| 清 residue ref | `node scripts/wt-helper.ts residue-prune` | 刪除超過保留期（預設 30 天，`CLADE_WT_RESIDUE_RETENTION_DAYS`）的 `refs/clade-residue/*` |
| 啟動該樹的 dev server | `node scripts/wt-helper.ts dev [<alias>]` | 用這棵樹分配到的 port |
| HANDOFF drift 掃描 | `node scripts/handoff-drift-scan.ts` | 列出 worktree branch 與 `HANDOFF.md` 不一致處；session-start hook 會自動跑 |
| Legacy merge-back | `node scripts/wt-helper.ts merge-back <slug>` | 遷移期相容；保留來源，沒有正式落地憑證不能 cleanup；已登記批次的來源 NEVER 走這條 |
| Legacy merge-back 預覽 | `node scripts/wt-helper.ts merge-back <slug> --dry-run` | 列 blockers 與 worktree WIP，不執行 |
| Legacy patch 預覽 | `node scripts/wt-helper.ts merge-back <slug> --patch --dry-run` | 只套 committed changeset、不碰 main index |
| Legacy merge-back 帶 stash | `node scripts/wt-helper.ts merge-back <slug> --auto-stash` | bulk-stash main 全部 dirty 成 `wt-merge-block/<slug>/<ISO>`，squash 成功後自動 pop 回 main |
| Grandfathered 樹落地 | `node scripts/wt-helper.ts land-pending <slug>` | `merge-back` 的別名，容忍 multi-commit branch |

`merge-back` 其他旗標（`--origin`、`--work-done --verification <line>`、`--include-worktree-wip`、`--no-cleanup`、`--noop-if-missing`、`--skip-pre-sync`）見 `--help` 與 `vendor/snippets/worktree-baseline/merge-back-ceremony.md`；完整工具速查表見 `vendor/snippets/wt-helper/README.md` § 工具速查表（完整版）。

## 復原

### 列出 pre-fork baseline 救援候選

```bash
node scripts/wt-helper.ts rescue [--json]           # 列 refs/wt-baseline/* pinned ref 與 fsck dangling stash
node scripts/wt-helper.ts rescue --show <ref|sha>   # 唯讀看完整 patch
```

`cleanup` 因 uncommitted 拒絕時，先 `rescue --show` 看 patch、救完再 cleanup，不要急著加 `--force-discard-uncommitted`。

### 把 `--include-unrelated-dirty` 搬走的 WIP 還原回 main

```bash
# 1. 找 pinned baseline ref（cleanup 過後仍在；同 slug 多筆時取時間戳對得上這次 fork 的那筆）
git for-each-ref --format='%(refname) %(objectname) %(creatordate:iso)' 'refs/wt-baseline/<slug>/*'

# 2. 在 main 還原（--index 保留原本的 staged／unstaged 分界；用 apply 不用 pop，pinned ref 留著當保險）
git -C <main-worktree-path> stash apply --index <objectname>

# 3. 實核；NEVER 憑 apply 沒報錯就宣告成功
git -C <main-worktree-path> status --short
```

衝突處理、還原後兩邊重複內容的去留與避免方式，見 `vendor/snippets/worktree-baseline/restore-main-after-bulk-capture.md`。

### Stash reconcile

```bash
node scripts/stash-reconcile.ts [--interactive|--json] [--include-all] [--stale-days <N>] [--slug <substring>]
```

列出每條 namespaced stash 與建議指令；NEVER auto-pop／auto-stage／auto-commit。apply 後 WIP 在 working tree，要走 `/commit` 的 selective stage。命名空間表與失敗 fallback 見 `vendor/snippets/worktree-baseline/merge-back-ceremony.md`。

### 移除 worktree

```bash
# main 之後改寫了同一段 hunk（內容被取代、沒有遺失）：逐檔要有證據，tip 先釘在 refs/wt-superseded/
node scripts/wt-helper.ts cleanup <slug> --superseded-by <commit|file=commit|file=path>[,…] --reason <text>

# 只有指定路徑下的 dirty 檔不擋（先存進 refs/clade-residue/<slug>），其他 dirty 仍擋
node scripts/wt-helper.ts cleanup <slug> --discard-pathspec <path>[,…]

# 丟棄整棵樹（永久刪除 branch commits 與未 commit 檔）
node scripts/wt-helper.ts cleanup <slug> --force --force-discard-unland [--force-discard-uncommitted]
```

正常落地後的回收由 `/commit` 的 batch cleanup 執行；`--force` 系列只用在確定要丟棄的樹，NEVER 用來處理未落地的工作。

### 平行 worktree 的 fork residue（落地或 archive 被擋）

merge-back blocker 是別 session 在 main 的 WIP：

```bash
node scripts/wt-helper.ts detect-main-dirty --json                 # 看 main dirty
node scripts/wt-helper.ts merge-back <slug> --dry-run              # 看 Blockers
node scripts/wt-helper.ts merge-back <slug> --auto-stash           # claim guard 放行後才跑；成功印 auto-restored N stashed path(s)
git status --porcelain                                             # 確認 squash 結果與原 main dirty 併存
node scripts/stash-reconcile.ts --slug <slug>                      # pop 撞衝突、stash 留下時才需要
```

根因與完整 recipe 見 `docs/pitfalls/2026-07-01-archive-mergeback-parallel-worktree-fork-residue.md`；baseline 相關 cookbook 見 `vendor/snippets/worktree-baseline/README.md`，wt-helper 整合範本見 `vendor/snippets/wt-helper/README.md`。
