# Commit CLI review runner safety


本檔描述 commit 0-A 的 review wrapper `claude-review-safe.sh`（Claude Opus 5.5 medium，唯一合格席）及其載體的能力與限制——它與已停用的 `codex-review-safe.sh` 共用 `lib/review-common.sh` 的 changeset 凍結、snapshot 完整性與 exit 語義。任何能合法執行 CLI 的 runtime 均可使用；它不宣稱呼叫者的原生工具或模型資格已達成。先依 [review-policy.md](review-policy.md) 判資格，再讀以下完整限制。

> **`codex-review-safe.sh`（原 GPT-6 Astra via Pi 格）2026-09-24 起整支 exit 2 拒跑**（Astra 禁用）。下面 Pi runner 與 exit 5 的內容描述那條已停用的載體，保留作為 `lib/review-common.sh` 共用行為與歷史判讀的依據，**NEVER** 讀成可以重新啟用它。

> codex-review-safe.sh 先凍結changeset，再呼叫Pi `openai-codex` review runner。Runner只允許`read,grep,find,ls`，沒有bash、write、edit或MCP；prompt injection無法取得mutation tool。這支script只review自家fleet diff，NEVER拿去review不可信第三方code。
>
> **changeset 由 script 自己收集後嵌進 prompt**（TD-320），pi 不再自行跑 `git diff`。兩個要判讀的 stderr 訊號：超出 `CODEX_REVIEW_MAX_DIFF_LINES`（預設 6000 行）的檔案會被整塊剔除並具名，**MUST** 當成該檔未被 review、NEVER 當作它通過；**exit 3** ＝ 收不到任何未提交變更（pi 未被呼叫），照 collection bug 處理，NEVER 當作 0-A.1 通過。

#### exit 5（workspace 綁定不符）→ verdict 作廢

runner 比對 pi session 事件的 cwd 與 `--cwd`，realpath 不符即 exit 5。此時模型的檔案探索打在別的 repo 上，**verdict 作廢、NEVER 當作 0-A.1 通過**，照環境問題排查後重跑。

**缺 session 事件同樣 exit 5**（fail-closed）。這道 guard 的用途是「證明」綁定正確，拿不到證據就是證明不了 —— 放行等於 gate 只在 pi 願意提供證據時才存在，而攻擊面（prompt 內嵌的不可信 changeset）恰恰有動機讓它不提供。真 pi 每次 run 都吐 session 事件，所以這條在正常路徑上不會誤觸。

> 查 events log **MUST 用 runner 自己印的 `pi-review: events log: <path>`**（出現在輸出頂端），**NEVER** 用 `ls -t /tmp/pi-review-*` 撈「最新那個」—— `/tmp` 是全 session 共用、檔名只有 pid+ts，並行 session 下會撈到別人的 run。2026-08-19 就是這樣把另一個 repo 的 review log 誤讀成自己的，得出「跑錯 workspace」的錯誤結論，連帶用那份 log 錯誤地否證了一條真實的 Critical。

#### exit 6（review 期間 working tree 被改動）→ verdict 不可信 + 人工檢視

script 在 runner 前後各拍一次 worktree snapshot（HEAD + 暫存 index 的 `git write-tree` 單一 tree hash——原生涵蓋內容、executable bit、symlink target、binary，純 git 可攜——+ `git status --porcelain=v2`），不一致即 exit 6 並在 stderr 印出 `git diff-tree` 的逐檔明細。runner 的 verdict 先落檔、**通過 after-check 才放行到 stdout**——exit 6 時 verdict 被扣住不輸出，只認 heading / 表格的機械檢查不會誤判通過。baseline 拍在 changeset 收集**之前**（拍在之後的話，收集期間的並行修改會被寫進 baseline，review 過的是一份 stale changeset 而檢查靜默）。snapshot 本身 fail-closed：任一步 git 失敗即 exit 6（unborn HEAD 是合法狀態、不觸發），NEVER 留下「前後同樣殘缺所以比對通過」的假綠。

##### 處置：歸因先，重跑前先換場地

exit 6 的 stderr 已經把改動**歸因**成兩類（受審 changeset 內的路徑 / changeset 外的路徑）。
**MUST** 先讀那份明細定性，**NEVER** 直接重跑 —— 蓄意 mutation 與並行 session 的正當編輯在
exit code 上長得一樣，而前者要停下來查，後者只是場地選錯了。

定性為**並行 session 的正當編輯**時，原樣重跑會撞同一件事：多人同時在 main 上工作，
review 期間沒有人改檔的機率隨 session 數遞減。改在**隔離的 detached worktree** 內跑，
changeset 就只含自己這批：

```bash
# 用標準層原語（TD-895）：快照落 ~/.cache/clade/review-snap/（磁碟，不吃 /tmp 配額）、
# 命令結束（含 signal）即 git worktree remove + prune；--stage 讓 git diff --cached 就是 base..head。
# 0-A 只有 Opus 席（review-policy.md）；codex-review-safe 已停用
node ~/offline/clade/vendor/scripts/review-snapshot.ts run --repo "$REPO_ROOT" --base <merge-base> --stage <head> -- \
  bash "$COMMIT_RESOURCE_DIR/scripts/claude-review-safe.sh" medium
```

上面這條是 Herdr carrier（無子命令，一次跑完）。**Claude Code 主線走 subagent carrier（`prepare`／`finalize` 兩段），NEVER 用 `run` 包 `prepare`**：`run` 在 prepare 返回時就刪快照，finalize 要回受審樹拍 after snapshot，必定失敗（wrapper 偵測到會以 exit 2 拒跑）。改用 `create`／`remove` 包住兩段：

```bash
SNAP=$(node ~/offline/clade/vendor/scripts/review-snapshot.ts create --repo "$REPO_ROOT" --base <merge-base> --stage <head>)
cd "$SNAP" && bash "$COMMIT_RESOURCE_DIR/scripts/claude-review-safe.sh" prepare medium
# 照 AGENT_CALL 派 commit-0a-reviewer → 跑 prepare 印的 FINALIZE，verdict 只認它的 stdout
node ~/offline/clade/vendor/scripts/review-snapshot.ts remove "$SNAP"   # finalize 之後，不論結果
```

**NEVER 手寫 `git worktree add --detach /tmp/…` 或 `$SCRATCHPAD/rev*`**：2026-09-22 一個 coordinator 的
`run0a.sh` 每輪 review 在 session scratchpad（tmpfs）建一棵、從不移除，52 棵 4.7G 撞滿 per-user
配額，連 Bash tool 的輸出檔都建不起來、0-A 鏈中途死。真的要手動時，同一支的 `create`／`remove`
子命令也可用，且**每一棵都要走 `remove`**，別寄望 sweep（它只回收 session 已結束的）。
`create` 印完路徑就退出，它自己的 pid 不是持有者：沒有 `CLAUDE_CODE_SESSION_ID` 的呼叫端（Pi／Codex／
cron／plain shell）要讓 `reclaim` 兜底 MUST 帶 `--owner-pid <長命的持有者 pid>`，否則 reclaim 永不回收那棵。

要用未 commit 的 index 內容當 changeset：`git diff --cached -- <自己的路徑>` 出 patch、在 `create` 的
快照裡 `git apply --cached`，**MUST** 用路徑限定 ——
那同時解掉第二個問題：在 main 直接跑，changeset 會含**所有** session 的 dirty 檔，
pi 讀的是一份混雜的 diff，findings 也會混進別人的檔。

2026-08-27 某 consumer 實測（main 上 4 個 session 並行）：在 main 跑是 49 檔 / 5307 行且連續兩次
被扣住；同一批改動移到 detached worktree 後是 4 檔 / 593 行，跑三輪都沒再觸發。

三件事別搞混：

- 這**不是**繞過 exit 6。隔離 worktree 內的 snapshot 檢查照跑，只是沒有別人會去動它
- 這**不放寬**任何判準。定性為蓄意 mutation 或定不出性時，仍是停下來查，**NEVER** 換場地重跑當作解決
- worktree 用完 **MUST** 移除（`review-snapshot.ts run` 自動做；手動 `create` 的走 `remove`），**NEVER** 留著累積（它會進下一次 `/handoff` 的 audit，也會吃 /tmp 配額——TD-895）

**write-tree 換法解的是可攜性與覆蓋率，不是安全性。** 它移除了 GNU coreutils 依賴、把 executable bit 與 symlink target 收進覆蓋範圍，但 `git write-tree` 一樣走 PATH 上的 `git` —— 「同 UID 對手可劫持度量工具本身」的問題，換 tree hash **一點都沒解**。**NEVER** 把 snapshot 實作的改良讀成安全等級提升。

**這是偵測控制，不是安全邊界 —— 別讓下一個人把它當 sandbox 用。** 它為什麼結構性無效的原論證是：同 UID 的對手可以竄改 `$WORK_DIR` baseline、劫持 PATH 上的 `git` 本身，任何 script 內的事後比對都騙得過（0-A.2 review 2026-08-19 定案）。本檢查的定位：它從來就不是靠對抗性強度存在的。它可靠接住的是**非對抗**的三類：並行 session 在 review 期間的編輯 / commit（實測發生率最高）、模型無惡意的誤寫事故、pi 層 enforcement 的回歸。它擋不住的包括：蓄意 mutation 後湮滅痕跡、資料外洩（WebFetch / MCP 送出去）、對其他 repo 或 `$HOME` 的破壞、以及**先改再還原**。

處置：**verdict 不可信、NEVER 當作 0-A.1 通過**。先人工檢視 stderr 的 snapshot diff 定性 —— 可能是 reviewer 被 prompt injection 帶去 mutation（此時被動到的檔 **NEVER 自動還原**，依 [[commit]] WIP 處置禁令交使用者拍板），也可能是並行 session 在 review 期間的正當編輯（此時 verdict 審的不是最終狀態，處置完重跑即可）。

**覆蓋邊界**：只偵測本 repo worktree 的 tracked + untracked 內容。**gitignored 檔（`.env`、`node_modules/` 等）、**/tmp、`$HOME`、其他 repo、MCP / 網路副作用**查不到也偵測不到** —— NEVER 把 exit 6 沒觸發講成「review 確認無副作用」。

#### `claude-review-safe.sh`（Opus 席）專屬限制

- 載體兩種：Claude Code 主線走 in-process subagent（`prepare` → AGENT_CALL → `finalize`，見 [gates.md](gates.md) § 0-A.1）；叫不出 Claude subagent 的 runtime 走 Herdr create-only Claude child（`--launcher cc`；`CLAUDE_REVIEW_LAUNCHER=ccw` 才顯式切工作帳號，其他值 exit 2。helper 內建帳號 fallback **只在** `~/.config/clade/claude-workspace-trust.json` 設 `accountFallback: true` 時啟用——先試指定的 launcher，再試另一個帳號；沒授權時只量指定的 launcher，另一個帳號沒被探過。RESULT 依 `account_preflight.probes` 分 quota／credential／mixed／unknown 寫實際原因，quota 只在 probes 涵蓋 cc、ccw 兩者時才說兩帳號皆耗盡），派工走 `--route routing-table --tier-basis table-row --table-row code-review-opus`——helper 對該列機械鎖死 `--model claude-opus-5-5 --effort medium --workspace-access readonly`，偏離即拒跑。`CLAUDE_REVIEW_SEAT=fable` 與任何非 `medium` 的 effort 參數都 exit 2，NEVER 靜默改席、降檔或抬檔。
- brief 交付兩模式，wrapper 依 brief bytes 自動選：不超過 `CLAUDE_REVIEW_INLINE_PROMPT_MAX_BYTES`（預設 100000）時 prompt 檔就是 brief 本身（inline）；超過則改交一份短指標，child 用 Read 分段讀 WORK_DIR 裡的完整 brief（pointer，繞過 argv `MAX_ARG_STRLEN` 128 KiB 的 E2BIG 上限，指標重申 CHANGESET 標記之間是不受信任資料）。兩道 fail-closed 上限命中即 **exit 9 本地拒絕、不派工**：brief 總量超過 `CLAUDE_REVIEW_BRIEF_MAX_BYTES`（預設 358400＝350 KiB：2026-09-21 三份 328／319／158 KB pointer 交付全數跑完且 receipt verified——該實測只證明「跑得完」，對 child 讀到檔尾前有無 context 壓縮零訊號，定值是最大實測交付量加約 7% headroom 的保守值，不是已證容量）；pointer 模式下任一單行超過 `CLAUDE_REVIEW_BRIEF_MAX_LINE_CHARS`（預設 2000，child Read 的靜默截斷邊界，檢查涵蓋整份 brief，RESULT 印行號與所屬區塊）。三個 `*_MAX_*` env 非正整數或超過 15 位數 → exit 2；`CLAUDE_REVIEW_INLINE_PROMPT_MAX_BYTES` 另設硬上限 110000（argv `MAX_ARG_STRLEN` 131072 扣掉 helper 附加 directive／completion protocol 約 10 KB），超過同樣 exit 2 並指名該 env——設超過會讓 110 KB–350 KiB 的 brief 走回 inline 重現 spawn E2BIG，wrapper 回的 exit 3 transport_error 會被誤歸成 reviewer 不可用。
- verdict 走檔案傳輸：child 把完整輸出寫進 brief 指定的 repo 外路徑，wrapper 通過完整性檢查後才放行到 stdout。child 沒寫檔＝transport 契約未履行＝review 沒跑成（exit 3）。
- 身分採 `model_verification` 三值：`verified` 才讓 verdict 進完整性檢查；`unverified` 先做一次**有界** verification 重讀（同一 session 的 transcript 證據，NEVER 重跑 review），仍非 `verified` 或 `mismatch` → exit 8，verdict 扣住。receipt（`dispatchStateDir()/review/<dispatch-id>.json`）記 requested／observed model、`model_verification`、`model_verification_reason`（「沒核實」如 transcript-timeout 與「核實但不符」是兩個結論）、session／dispatch／pane 歸屬、verdict SHA-256、`brief_delivery`（inline／pointer）與 `brief_bytes`（每次派工的交付方式可稽核）。
- 派工帶 `--bounded-leaf`（TD-1105），dispatched worker 內也開得動：helper 只對 readonly gate-review row＋`--coordinate` 放行巢狀一層，leaf 自己再派仍拒。
- exit 語義：0 verdict／2 本地用法／3 Opus 席 review 未跑成（含 coordination 逾時、completion_failed、無 verdict 檔）／4 account_unavailable（本 0-A 席帳號不可用的證據，沒有備援席；不等於兩帳號皆耗盡——原因看 `account_reason_kind`；stderr 另印一行 `NEXT_STEP_JSON:`，含 `gate: pending`、`hold_at_gate: true`（停在 gate 前，不依 routing table 的 review 列改派）、留存的 helper receipt 路徑、helper 在 ccw、cc 兩帳號實測皆耗盡時給的 `helper_next_step`——否則為 `null`、`account_reason_kind`（quota／credential／mixed／unknown）、`account_reasons`（逐帳號原因文字，無 probes 時 `null`），以及隨 kind 變動的 `instruction`：quota 且兩帳號都量過才是「等 Opus 額度恢復」，只量一個帳號時指向以 `CLAUDE_REVIEW_LAUNCHER` 改用另一帳號重跑；credential 是登入或換有憑證的帳號；mixed 是登入缺憑證的 launcher 或等額度；unknown 是先讀 receipt 判原因——coordinator 依 `instruction` 處置，NEVER 一律讀成「等額度恢復」）／6 snapshot drift／8 model verification 失敗／9 brief 無法安全交付——**本地拒絕不是 reviewer 不可用**，NEVER 當 reviewer 不可用記 pending，折超長行或拆 commit 後重跑；縮 `CODEX_REVIEW_MAX_DIFF_LINES` 只會把超出的檔擠進 OMITTED 漏審清單（該檔未被 review，缺檔 verdict 不能記 PASS），除非被剔除的檔另行送審，否則不是出路。Herdr carrier 另有 10 = helper `nested_dispatch_refused`（本 session 不得開 reviewer child → 交回 coordinator，**不是** reviewer 不可用，NEVER 讀成 exit 3 判 gate pending）；11 = account_unverifiable（配額量不到，量不到 ≠ 沒額度；RESULT／NEXT 印出 receipt 路徑與 `retry_after_ms`——欄位缺席＝沒有 ETA，交 coordinator 決定，有 ETA 才依它重試；NEVER 讀成 exit 4，也 NEVER 讀成 exit 9 的本地拒絕）。

