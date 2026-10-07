# Rule 1 - 預設完全不 capture main dirty，要帶 WIP 必須顯式傳 flag

- Level: `MUST`
- 這兩條在每個 session 都成立，不只在 `wt` 內：
  1. **預設完全不 capture main dirty**：main 原封不動，worktree 從 HEAD fork 成乾淨樹。`wt-helper add` 沒帶任何 baseline flag 時就是這個行為。
  2. **要把 main WIP 帶進 worktree，必須顯式傳 flag**，二擇一：
     - `--baseline-scope-paths <comma>`（scoped，走 commit strategy）：只帶指定路徑，scope 外的跨 session WIP 留在 main 不動。有 change context（有 carrier）時這才是正解。
     - `--include-unrelated-dirty`（bulk，stash strategy 專用）：把 main 上**全部** dirty 搬走。這是無從 scope 時的鈍器，語意與後果見 Rule 5。
- 確實需要既有 WIP 時，先判定這次獲授權帶走的範圍，再顯式選 scoped capture；**NEVER** 把別 session 的 WIP 當成新任務的 baseline。
- 這道 guard 存在的原因只有一句：worktree 從 main HEAD 分出，看不到 main working tree 的 untracked／modified；不處理就會讓 worker 進樹後發現 baseline 缺件而失敗。

## Good Example

- 這個例子是好的，因為它沒有需要帶的 WIP，就不帶任何 baseline flag，並如實回報 main 未動。

```md
main 有 3 個 dirty 檔，皆不屬於本任務 carrier 的 scope。
→ `wt-helper add fix-auth --task-summary "修正登入逾時後的 token 續期"`（不帶 baseline flag）
→ 回報：main 上 3 個 dirty 檔原封不動；新樹從 HEAD 乾淨分出。
```

## Bad Example

- 這個例子是壞的，因為它為了「保險」把別人的 WIP 一起帶進新樹，等於替別 session 決定了它的 WIP 歸屬。

```md
main 有 3 個 dirty 檔，不確定是誰的。
→ 先全部帶過去比較安全：`wt-helper add fix-auth ... --include-unrelated-dirty`
```

# Rule 2 - 送出 `wt-helper add` 前依 main 狀態走三路分流

- Level: `MUST`
- 先以 `wt-helper detect-main-dirty --json`（或 `add` 帶 `--precheck-baseline`，helper 會在 fork 前跑同一個偵測）看 main working tree（modified／untracked／unmerged），主線依偵測結果與呼叫端是否交來 carrier 決定策略。**不帶 `--precheck-baseline` 的 `add` 不做任何偵測**，main 有 unmerged 時 MUST 帶上它：
  - **Unmerged 非空** → helper 跑 `classifyUnmergedSafety` 再分：
    - **Safe-resolvable**（檔內無 conflict markers，且沒有 merge／rebase／cherry-pick 進行中的狀態）→ helper 自動 `git add <paths>` 標 resolved 後繼續。stale UU 只是 index 殘留，沒有資料風險。
    - **Unsafe**（上述任一條件命中）→ **STOP**，拒絕 fork，逐條列出 unsafe path 與原因。**NEVER** 自動處理真衝突或中段 merge——任何動作都可能丟資料。
    - Unmerged 不一律 STOP 的理由：helper 的兩條 safety check 對 stale UU 的誤判極低，對真衝突仍是 fail-safe。
  - **Clean** → 直接 fork。
  - **Dirty 非空** → 預設不帶（Rule 1）：不帶 baseline 旗標，或帶 `--precheck-baseline --baseline-strategy stash`（不加 `--include-unrelated-dirty`，main 原封不動，另外多做 unmerged 與別 session claim 檢查——後者命中會 STOP）。確實要帶時依呼叫端路徑三選一：
    - **有 carrier 的工作**（`tasks/<date>-<slug>.md` 或 `specs/plans/<work-id>/`）→ **commit-then-fork**：主線從 carrier 的 scope 段與已知影響面萃取 scope-in 路徑，確認實作 checkout，帶 `--task-summary "<一句話>" --precheck-baseline <slug> --baseline-strategy commit --baseline-scope-paths <comma>`。helper 只 stage scope-in 路徑、在 main 提交 `baseline: <slug> pre-fork sync` 後再 fork；scope-out（跨 session WIP）留在 main 不動。
    - **無 change context、但要帶其中幾條 WIP 的 ad-hoc 任務** → 同樣走 **commit-then-fork**，`--baseline-scope-paths` 只列要帶的那幾條（`git stash -u` 會無視 pathspec，stash 沒有安全的 scoped 版本，helper 會拒絕 `stash`＋scope-paths）。
    - **main 上全部 dirty 確實都屬於這次 fork** → **bulk stash-apply**：帶 `--precheck-baseline --baseline-strategy stash --include-unrelated-dirty`（語意與回報義務見 Rule 5）。helper 在 main 跑 `git stash push -u -m wt-baseline/<slug>/<ISO>`，fork 後在新樹 `git stash apply`，再把 stash sha **pin 到永久 ref `refs/wt-baseline/<slug>/<ISO>`**，最後 `git stash drop`（物件仍可達）。pin 防止 cleanup 後 baseline 永久消失，可用 `wt-helper rescue` 列出救回。
    - **Ambiguous**（scope-in 為空但 scope-out 非空，或 carrier scope、影響面、dirty 清單三個來源都對不上）→ **STOP**，回使用者拍策略。**NEVER** 主線自己猜。
- 建立指令的完整參數讀 `wt-helper指令.md` § 建立；四種情境的完整 trace 與 scope filter 細節在 `~/offline/clade/vendor/snippets/worktree-baseline/`。

## Good Example

- 這個例子是好的，因為它依 carrier 有無選策略，並在三來源對不上時停下。

```md
任務 A：有 `specs/plans/W-2026-10-01-auth/`，main dirty 中 2 條落在 scope-in。
→ commit-then-fork，`--baseline-scope-paths server/auth/token.ts,server/auth/session.ts`

任務 B：ad-hoc，main dirty 有 1 條使用者剛手改、這次要用到的 config（另有 5 條無關）。
→ commit-then-fork，`--baseline-scope-paths config/app.ts`，其餘 5 條留在 main；worker brief 的 Git baseline 段列出 fork 後樹內的狀態。

任務 C：carrier scope 寫 `server/billing/**`，main dirty 卻全在 `app/pages/**`。
→ Ambiguous，STOP，問使用者要不要帶、帶哪些。
```

## Bad Example

- 這個例子是壞的，因為 unmerged 有真衝突仍被「順手」處理，而且對不上的情況被主線自行判定。

```md
main 有 UU 檔，檔內還有 `<<<<<<<`。
→ 先 `git add` 標掉再 fork，反正 worktree 用不到。
main dirty 和 carrier 對不上 → 猜應該是要帶的，全用 stash 帶過去。
```

# Rule 3 - `--baseline-scope-paths` 必須對齊 carrier 列出的每一條 scope-in 路徑

- Level: `MUST`
- 走 commit-then-fork 時，`--baseline-scope-paths` **MUST** 對齊目前 canonical intent（carrier 的 scope 段與影響面）列出的**每一條** scope-in 路徑，包括測試、設定、文件與 migration，**NEVER** 為了保守只挑核心 code。
- 漏帶的後果是 scope 分裂：同一件工作的改動分散在 main 與 worktree 兩處，後續落地時其中一半會被遺忘或互相覆蓋。
- 偵測方式：fork 後在 main 跑 `git status`，若仍有該工作影響面列出的 dirty 路徑 = baseline 漏帶，回頭補帶或回報。

## Good Example

- 這個例子是好的，因為它把 carrier 影響面列出的測試與 migration 一起帶，fork 後也做了漏帶檢查。

```md
carrier 影響面：server/auth/token.ts、server/auth/session.ts、test/auth/token.test.ts、supabase/migrations/20261001_token.sql
→ `--baseline-scope-paths server/auth/token.ts,server/auth/session.ts,test/auth/token.test.ts,supabase/migrations/20261001_token.sql`
→ fork 後 main `git status` 不再出現上述四條。
```

## Bad Example

- 這個例子是壞的，因為只帶核心 code，測試與 migration 留在 main，工作被切成兩半。

```md
→ `--baseline-scope-paths server/auth/token.ts`
（test 與 migration 先留在 main，之後再說）
```

# Rule 4 - bulk stash capture 有隱性風險，fork 後到落地前三個時點都要先查 baseline 內容

- Level: `MUST`
- `--baseline-strategy stash --include-unrelated-dirty`（bulk capture）假設「dirty main 可以安全 stash」，實際上 dirty 可能含 in-flight feature code 或別 session 的 WIP。bulk capture 不分來源全部捲進 pinned ref；後續若走 Path X 救援（直接 reset 到 worker commit），那段 feature 會從 main 整段消失，而且 typecheck 抓不到。
- 因此以下三件事 **NEVER** 做：
  - bulk capture 跑完、還沒做 pre-fork audit（核對被捲進 baseline 的每一條路徑屬於誰）就直接派工。
  - merge-back 撞 conflict 時不查 baseline 內容，直接 `git reset --hard <subagent-commit>` 走 Path X。
  - cleanup 用 `--force-discard-uncommitted` 前，沒有先 `wt-helper rescue` 確認 baseline 內容。
- stash-apply 之後，worker brief 的 Git baseline 段 **MUST** 列出 `git -C <worktree> status --porcelain` 的輸出，讓 worker 知道這些檔是 main 帶來的起始狀態、不是它的工作範圍。
- Pre-fork audit 與 recovery：`refs/wt-baseline/<slug>/<ISO>` 有兩種格式，`^1` 都是 fork 當下的 HEAD：

  | 產生路徑 | parent 數 | untracked 在哪 |
  | --- | --- | --- |
  | `pinPreForkBaseline`（`stash` 預設不捕捉、clean main、未帶 `--precheck-baseline` 的 safety net） | 2 | 已併進 `<ref>` 主 tree |
  | `--baseline-strategy stash --include-unrelated-dirty`（真的 `git stash push -u`） | 3 | `<ref>^3` |

- **NEVER** 只讀 `<ref>^3`：對 2-parent ref 它是 `fatal: Not a valid object name`、stdout 空白，「排除投影後非空」就被讀成乾淨。下面的寫法兩種格式都成立：

  ```bash
  # 排除投影路徑後非空 = baseline 夾帶 in-flight／他 session 的檔，Path X cleanup 前 MUST review
  { git diff --name-only <ref>^1 <ref>
    git rev-parse -q --verify <ref>^3 >/dev/null && git ls-tree -r --name-only <ref>^3
  } | sort -u | grep -vE '^(\.agents/|\.codex/|\.claude/|AGENTS\.md$|CLAUDE\.md$)'

  # 復原：先從 <ref> 取（2-parent 的 untracked 也在這裡）；3-parent 的 untracked 從 ^3 取
  git checkout <ref> -- <paths>
  git checkout <ref>^3 -- <paths>   # 只對 3-parent ref、且檔案是 untracked 時
  ```

## Good Example

- 這個例子是好的，因為 stash 之後先 audit 再派工，並把 baseline 清單交給 worker。

```md
stash-apply 帶進 4 條路徑 → 逐條確認：3 條是本任務、1 條 `app/pages/report.vue` 是別 session 的 in-flight feature。
→ 停下回報，該條改回 main 由原 owner 處理後再重新 fork；worker brief 的 Git baseline 段列出其餘 3 條。
```

## Bad Example

- 這個例子是壞的，因為沒查 baseline 就用 reset 解衝突，main 上的 in-flight feature 會靜默消失。

```md
merge-back 撞 conflict → `git reset --hard <subagent-commit>` 直接用 worker 版本蓋過，typecheck 綠燈就收工。
```

# Rule 5 - 傳了 `--include-unrelated-dirty` 就必須如實回報 main 已被清空，並知道如何還原

- Level: `MUST`
- `--include-unrelated-dirty`（stash strategy 專用）的語意是 **bulk-capture main 上全部 dirty**：不分主題、不分歸屬、不管是不是別 session 的 WIP，一律搬進新 worktree，main 端變乾淨。這是 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]] 修法刻意建立的 opt-in 閘門。
- 傳了它之後，**NEVER 對 user 宣稱「main working tree 不變」/「main 沒被動到」/「你的 WIP 還在 main」**——傳了它，那三句話**必然**是假的。記得「`wt-helper` 預設不碰 main dirty」這條結論、卻沒把「我這次傳了 flag」納入判斷，正是 [[pitfall-include-unrelated-dirty-claimed-main-untouched]] 的實證失敗路徑。
- 傳了它之後 **MUST** 明確告訴使用者：main 上原有的 N 個 dirty 檔已搬進 worktree `<path>`，main 端現在是乾淨的。
- 要把 bulk-capture 的內容拿回 main，照下列三步驟，第 3 步不可省：

```bash
# 1. 找 pinned baseline ref（cleanup 過後仍在）
git for-each-ref --format='%(refname) %(objectname)' 'refs/wt-baseline/<slug>/*'

# 2. 在 main 還原（--index 保留原本的 staged / unstaged 分界）
git stash apply --index <objectname>

# 3. 實核，NEVER 憑 apply 沒報錯就宣告成功
git status --short
```

- 可直接貼的完整 recipe 在 `~/offline/clade/vendor/snippets/worktree-baseline/restore-main-after-bulk-capture.md`。
- 有 change context 時改用 `--baseline-scope-paths`（Rule 2、Rule 3），不要拿 bulk 當預設。

## Good Example

- 這個例子是好的，因為回報如實反映 flag 的後果，並附上還原路徑。

```md
本次帶了 `--include-unrelated-dirty`：main 上原有的 7 個 dirty 檔已搬進 `~/offline/clade-wt/cleanup-sweep/`，main 端現在是乾淨的。
要拿回 main：`git for-each-ref ... 'refs/wt-baseline/cleanup-sweep/*'` → `git stash apply --index <sha>` → `git status --short` 核對。
```

## Bad Example

- 這個例子是壞的，因為它套用「預設不碰 main」的記憶，卻忽略了這次確實傳了 flag。

```md
已開 worktree，wt-helper 預設不碰 main dirty，你的 WIP 還在 main。
（實際指令帶了 `--include-unrelated-dirty`）
```

# Rule 6 - 不准手寫 pathspec stash 做 selective baseline sync

- Level: `MUST`
- **NEVER 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>`** 試圖只把部分檔案收進 stash，再到別的 worktree `stash apply` 做跨樹同步。
- 原因：git 2.50.1 的 pathspec stash 有 scope leak——stash commit 會包進整個 tracked tree 的 modifications，apply 到新樹時帶進大量跨 session 雜訊。詳見 [[pitfall-git-stash-pathspec-scope-leak]]。
- 正解依場景：
  - worktree baseline sync → `wt-helper add --precheck-baseline`（Rule 2；helper 的 bulk stash 不帶 pathspec，避開此 bug）。
  - 非 worktree 場景的 selective sync → patch＋rsync；長期跨 branch 同步 → `format-patch`＋`am`。命令塊見 `~/offline/clade/vendor/snippets/worktree-baseline/README.md` § 手動 selective sync 正解。
- 判別：任何「想把 X、Y、Z 三個檔的改動搬去別的 worktree」的場景，第一反應是 `wt-helper` 或 patch route，**禁止**自己手寫 `git stash push -u -- <paths>`。

## Good Example

- 這個例子是好的，因為它把三個檔的搬運交給 patch route，不碰 pathspec stash。

```md
要把 main 上 a.ts、b.ts、c.ts 的改動帶進既有 worktree：
→ `git diff -- a.ts b.ts c.ts > /tmp/sync.patch` → 在 worktree `git apply --check /tmp/sync.patch` → `git apply`
```

## Bad Example

- 這個例子是壞的，因為 pathspec stash 會把整棵 tracked tree 的改動一起包走。

```md
`git stash push -u -m "sync abc" -- a.ts b.ts c.ts` → cd 到 worktree → `git stash apply`
```

# Rule 7 - 有來源 worktree 的 archive 與 follow-up fix 留在來源，不把 batch 攤在 shared main

- Level: `MUST`
- archive-on-main 例外會讓未 commit 的 archive batch 躺在 **shared main**；若 `/commit` 因 gate halt，這批 dirty 長期留在 main，就會被別 session 的 `wt-helper add --baseline-strategy stash` 當成無主 dirty 整批捲進 `refs/wt-baseline/*`（實證見 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]]）。
- 因此：
  - 有來源 worktree 的每個 archive，**MUST** 在來源內完成 gates 與 bookkeeping；follow-up fix 同樣留在來源。
  - 正式批次從一開始就在隔離整合區 review；gate halt 時保留該整合區繼續修，**NEVER** 把 candidate 搬進 main。
  - 已在 main 完成的 solo bookkeeping 沿用原路徑；需要多步修正時先進隔離 worktree。
- 本檔的 fork 判斷要把這個窗口算進去：看到 main 上有疑似 archive batch 的 dirty，先當成「別人的未落地成果」處理（Rule 2 的 Ambiguous），不要當無主 dirty 帶走。

## Good Example

- 這個例子是好的，因為 gate halt 後修正仍留在整合區，main 沒有長期 dirty。

```md
`/commit` 在 review gate halt → 回到隔離整合區修正 → 重跑 gate → 落地。main 期間保持乾淨。
```

## Bad Example

- 這個例子是壞的，因為它把 archive candidate 攤在 main 等修，正好落入別 session 的 stash 掃描範圍。

```md
gate halt → 先把 archive 結果放在 main working tree，明天再修。
```

# Rule 8 - 建 plan package 或 tasks 檔同樣是寫入，先套用本檔再動手

- Level: `MUST`
- `/specify` 建 plan package（`specs/plans/<work-id>/`）、新增 `tasks/<date>-<slug>.md` 都是對 tracked 檔的寫入；每次動手前套用本檔的 baseline 判準。已有 worktree 就沿用，**NEVER** 為了建計畫另開第二棵樹。
- 動手前先唯讀查既有 work id（`specs/plans/` 目錄與 `flow` 佇列），避免同一件工作開出第二份計畫。

## Good Example

- 這個例子是好的，因為它先查重再決定沿用既有樹。

```md
要建 `specs/plans/W-2026-10-03-token-refresh/` → 先 `ls specs/plans | grep token` 與 `flow` 查詢 → 已有 `W-2026-10-01-auth` 涵蓋 → 沿用該 work id 與它的 worktree。
```

## Bad Example

- 這個例子是壞的，因為它在 main 直接建計畫，且沒有查重。

```md
直接在 main 新增 `tasks/2026-10-03-token-refresh.md`，之後再開 worktree 實作。
```
