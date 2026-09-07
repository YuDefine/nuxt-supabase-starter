<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit CLI review runner safety

<!-- clade-targets: claude,codex,cursor -->

本檔只描述 `codex-review-safe.sh` 及其 Pi runner 的能力與限制。任何能合法執行 CLI 的 runtime 均可使用；它不宣稱呼叫者的原生工具、模型資格或跨模型 gate 已達成。先依 [review-policy.md](review-policy.md) 判資格，再讀以下完整限制。

> codex-review-safe.sh 先凍結changeset，再呼叫Pi `openai-codex` review runner。Runner只允許`read,grep,find,ls`，沒有bash、write、edit或MCP；prompt injection無法取得mutation tool。這支script只review自家fleet diff，NEVER拿去review不可信第三方code。
>
> **changeset 由 script 自己收集後嵌進 prompt**（TD-320），pi 不再自行跑 `git diff`。兩個要判讀的 stderr 訊號：超出 `CODEX_REVIEW_MAX_DIFF_LINES`（預設 6000 行）的檔案會被整塊剔除並具名，**MUST** 當成該檔未被 review、NEVER 當作它通過；**exit 3** ＝ 收不到任何未提交變更（pi 未被呼叫），照 collection bug 處理，NEVER 當作 0-A.1 通過。

> 以下 Cursor 隔離紀錄描述退役 Sol 路徑，不構成 Astra Cursor 准入；Astra 的 `--pool cursor` 會拒跑。
>
> **Cursor 池的隔離已經到位（TD-524 / TD-533 / TD-534）**：本節一度寫著「在拿到 OS 層隔離之前，`--pool cursor` NEVER 用於 0-A.1」，依據是 TD-520 的「同 UID 執行 + unrestricted Shell」。那個前提已被解除 —— TD-524 起 cursor 池一律跑在 bubblewrap 內（受審 repo 唯讀綁入、`$HOME` 換成 tmpfs、憑證只掛 cursor 一把，mutation 由核心拒絕而非事後偵測）；TD-533 再加上 network namespace（DNS 與 TLS SNI 都鎖在 Cursor API）；TD-534 把准入綁在待審材料的來源。任一道未就緒即拒跑，不降級。

> **cursor 池沒有工具面 enforcement — 已確認，非未決（TD-520）**。這條事實沒有過期，過期的是它曾經導出的禁令：工具面補不起來，所以 TD-524 / TD-533 把 enforcement 整個移到 OS 層（見上一段），下面這些觀察仍是判斷殘餘風險的依據。pi 的 `--tools read,grep,find,ls` 只是 pi 層 flag，cursor provider 下模型的執行**全部**走 Cursor SDK 原生工具，該 flag 對它們無效。2026-08-19 授權 probe 實測：模型自報可用工具含 `Shell` / `Delete` / `ApplyPatch` / `CallMcpTool` / `WebFetch` / `Subagent`，並**實際寫出了檔案**。三條 enforcement 路徑逐一查證全部不存在（SDK `LocalAgentOptions` 無工具面欄位、`--cursor-mode plan` 是 prompt guidance、`PI_CURSOR_SANDBOX=1` 本環境拒跑）。
>
> `--tools` 唯一還有的作用是**決定哪些原生執行會被回放進 events log**（回放條件 = builtin 七種 ∩ pi active tools）。推論反直覺但重要：**白名單越窄，稽核越盲** —— events log 能證明「有用 X」，永遠不能證明「沒用 Y」。
>
> 因此 `--pool cursor` **NEVER** 用來 review 不可信的第三方 code，也 **NEVER** 用於會接觸 secrets / prod 憑證的 changeset。自家 fleet diff 走這條的殘餘風險由 exit 6 接住其中一類（見下），其餘明列為不覆蓋。

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
git worktree add --detach /tmp/<repo>-<slug>-review HEAD
cd /tmp/<repo>-<slug>-review && git apply <自己這批的 patch>
cd /tmp/<repo>-<slug>-review && bash "$COMMIT_SKILL_DIR/scripts/codex-review-safe.sh" medium
```

patch 取自 `git diff --cached -- <自己的路徑>`（或 `git diff`），**MUST** 用路徑限定 ——
那同時解掉第二個問題：在 main 直接跑，changeset 會含**所有** session 的 dirty 檔，
pi 讀的是一份混雜的 diff，findings 也會混進別人的檔。

2026-08-27 <consumer-b> 實測（main 上 4 個 session 並行）：在 main 跑是 49 檔 / 5307 行且連續兩次
被扣住；同一批改動移到 detached worktree 後是 4 檔 / 593 行，跑三輪都沒再觸發。

三件事別搞混：

- 這**不是**繞過 exit 6。隔離 worktree 內的 snapshot 檢查照跑，只是沒有別人會去動它
- 這**不放寬**任何判準。定性為蓄意 mutation 或定不出性時，仍是停下來查，**NEVER** 換場地重跑當作解決
- worktree 用完 **MUST** `git worktree remove`，**NEVER** 留著累積（它會進下一次 `/handoff` 的 audit）

**write-tree 換法解的是可攜性與覆蓋率，不是安全性。** 它移除了 GNU coreutils 依賴、把 executable bit 與 symlink target 收進覆蓋範圍，但 `git write-tree` 一樣走 PATH 上的 `git` —— 「同 UID 對手可劫持度量工具本身」的問題，換 tree hash **一點都沒解**。**NEVER** 把 snapshot 實作的改良讀成安全等級提升；封口的是 bwrap（TD-524，已落地，見下）。

**這是偵測控制，不是安全邊界 —— 別讓下一個人把它當 sandbox 用。** 它為什麼結構性無效的原論證是：同 UID 的對手可以竄改 `$WORK_DIR` baseline、劫持 PATH 上的 `git` 本身，任何 script 內的事後比對都騙得過（0-A.2 review 2026-08-19 定案）。**那條論證對 cursor 池自 TD-524 起不再成立**——它已經不在呼叫者的 UID 檔案空間裡（見下）。但本檢查的定位**不變**：它從來就不是靠對抗性強度存在的，改變的是它不再是 cursor 池唯一的那道。它可靠接住的是**非對抗**的三類：並行 session 在 review 期間的編輯 / commit（實測發生率最高）、模型無惡意的誤寫事故、default 池 pi 層 enforcement 的回歸。它擋不住的包括：蓄意 mutation 後湮滅痕跡、資料外洩（WebFetch / MCP 送出去）、對其他 repo 或 `$HOME` 的破壞、以及**先改再還原**。

**sdk 層**事前 enforcement 三條路已查證皆不存在（`LocalAgentOptions` 無工具面欄位、`--cursor-mode plan` 只是 guidance、`PI_CURSOR_SANDBOX=1` 本環境拒跑，TD-520）。**OS 層的真修已落地（TD-524）**：cursor 池的 pi 一律跑在 bubblewrap 內 —— 受審 repo 唯讀綁入、`$HOME` 換成 tmpfs、`auth.json` 濾到只剩 cursor 一把、`/tmp` 是拋棄式 tmpfs。所以在 cursor 池上：

| 這件事 | 現況 |
| --- | --- |
| 寫進受審 repo | **核心拒絕**（`EROFS`），不是事後偵測 |
| 讀 `~/.ssh` / 其他 repo / codex 與 xai 的 refresh token | **不在 namespace 裡**，讀不到 |
| bwrap 不可用 | **整個 run 拒跑**（`errorClass: sandbox-unavailable`），**NEVER** 降級成裸跑 |
| 外洩（WebFetch / MCP / 網路） | **出口白名單**（TD-533）—— run 跑在只連得到 Cursor API 的 network namespace 裡；DNS 只答 cursor 兩個 host，TLS 依 ClientHello 的 SNI 過濾，其餘一律斷 |
| netns 未就緒 | **整個 run 拒跑**（`errorClass: egress-unavailable`），**NEVER** 降級成開放網路。修法：`node vendor/scripts/cursor-netns.ts setup`（需 sudo，一次性） |

2026-08-19 實測是讓 cursor 池的模型自己在 sandbox 內跑 probe 回報的（**NEVER** 只從外面推論）。TD-524 那五條：`touch` 回 `Read-only file system`、`~/.ssh` 回 `No such file or directory`、`ls ~/offline` 只剩 bind skeleton、`auth.json` 只剩 cursor 一個 key。TD-533 四條，模型逐字回 `1=exit 6, code 000 2=exit 6, code 000 3=exit 0, code 200 4=cursor` —— example.com 斷、api.github.com 斷、api.cursor.com 通、憑證只剩 cursor。host 端 proxy log 獨立佐證同一輪 `deny dns example.com` / `deny dns api.github.com`。

> 問 `auth.json` 時 **MUST 只要 key 的名稱**（`Object.keys`）。2026-08-19 有一次 probe 讓模型把檔案內容原文回報，live cursor key 因此進了 transcript。

**「接受風險」的前提因此再收窄**：出口已鎖到 Cursor API，剩下的判斷是**你願不願意讓 Cursor 看到這批材料**——那是無法用沙箱解決的部分（模型的 prompt 依定義會送到 Cursor 伺服器）。default 池照跑本檢查（防 pi 層 enforcement 回歸）。

處置：**verdict 不可信、NEVER 當作 0-A.1 通過**。先人工檢視 stderr 的 snapshot diff 定性 —— 可能是 cursor 池被 prompt injection 帶去 mutation（此時被動到的檔 **NEVER 自動還原**，依 [[commit]] WIP 處置禁令交使用者拍板），也可能是並行 session 在 review 期間的正當編輯（此時 verdict 審的不是最終狀態，處置完重跑即可）。

**覆蓋邊界**：只偵測本 repo worktree 的 tracked + untracked 內容。**gitignored 檔（`.env`、`node_modules/` 等）、**/tmp、`$HOME`、其他 repo、MCP / 網路副作用在 cursor 池下**查不到也偵測不到** —— NEVER 把 exit 6 沒觸發講成「cursor 池 review 確認無副作用」。

