# /commit Step 6-A 推送順序、失敗復原與 tag 觸發確認


> 本檔是 Step 6-A 的 branch 分頁。發版授權（Step 6-Gate）在 `rules/發版授權判準.md`，6-A 的串接命令在 `rules/push-main發版判準.md`；本檔只放 main 先、tag 後的理由與邊界、序列中途失敗的七格復原、推 tag 後的觸發確認。**6-A 串接命令任一步失敗時 MUST 讀 § 序列中途失敗的復原並從失敗那一步接著做**；**Step 6-Gate 的 `derived=` 是 `tag-v`／`ambiguous` 時，推 tag 之後 MUST 讀 § 推 tag 後的觸發確認**。串接命令一次成功且 `derived=` 是其他值時不需要讀本檔。

## 推送順序：無條件 main 先、tag 後

推的是**具名 tag**（`git push origin "v<版本>"`），**NEVER `git push origin --tags`**——
`--tags` 推的是本機所有 tag，這次要送出去的是哪一個由本機殘留決定，不由這次發版決定。
（這條約束的是**Step 6-A**這條發版序列。clade 自家的 `/clade-publish` 是另一套 SOP：`scripts/publish.ts`
會**印出**一條 `git push --tags` 當作下一步指令，順序同樣是 main 先，只是用了 `--tags` 寫法，不受本條管。）

順序**無條件**是 main 先、tag 後，依 `rules/core/commit.detail.md` § Tag 位置——那條規約
無條件要求 push tag 前不得有未推 commit，與這個 repo 接了什麼 pre-push check 無關。
`vendor/scripts/pre-push/checks/tag-position.sh` 是它的機械兜底，tags-first 必定被擋
（兩個 consumer 的 deploy 實測）。**NEVER 先量這個 repo 有沒有接 `tag-position`
再決定順序**——沒接的 repo 只是少了兜底，規約本身沒有變。

**被 `tag-position` 以「超前」擋下的 push，NEVER 用 `--no-verify` 或 `CLADE_ALLOW_STALE_TAG`
過關**：tag 指向 origin 上還不存在的樹，是推出去就收不回的對外物件。

它是**政策，不是機械保證**——所以「反正 script 會攔」不成立：`CLADE_ALLOW_STALE_TAG` 在
`tag-position.sh` 裡的判斷排在方向計算**之前**，設了就兩個方向一起放行（2026-09-04 實測：tag
超前 origin/main 一個 commit，未設回 exit 1、設了回「已設，放行」exit 0）。擋住超前方向的只有
上面那條規約本身。

（2026-09-21 TD-911：gate 對同批 `--atomic` 且 `refs/heads/<default>` head **即** tag
commit 的推送放行——放行語義只在原子批次下成立，嚴格祖先仍歸 stale 擋法、同批其他
branch 不算數，細節見 `rules/core/commit.detail.md` § Tag 位置。這是放寬 gate，**不改**
`rules/push-main發版判準.md`（Step 6-A）的 main 先、tag 後序列。）

（`tag-position` 也擋「落後」方向，那一邊**有**合法用途——刻意在舊 commit 上打 hotfix release
tag——判準見 `rules/core/commit.detail.md` § 機械 gate 與它的邊界，**NEVER** 把本條讀成連那一邊
也一起禁掉。）

**main 先不牴觸 deploy-gate 的「發版窗口內不 push main」**：那條防的是**別的**工作在窗口內 push，取消掉發版 SHA 的 staging run。發版序列自己的那一次 main push 是窗口的**起點**，不是窗口內的干擾。窗口的完整定義見 `~/offline/clade/vendor/snippets/deploy-gate/README.md` § 操作規約，race 與 gate 的 recovery 見同檔的 § 這道 gate 有一個消不掉的 race 與 § Recovery。

**tag-only 那趟 push 會讓 pre-push 全套 8 支照跑**：`vendor/scripts/pre-push/runner.sh`
在只推 tag 時算不出 changed paths，刻意 fail-open 成全跑（該檔 `PATH_FILTER_ACTIVE` 的 `else`
分支印出「算不出 changed paths（新 branch 首推 / 手動執行 / 只推 tag）→ 全部照跑」）。8 支並行，
wall time 由最慢的單一 check 決定（某 consumer 2026-09-07 實測暖路徑 `nuxt-typecheck` 2m29s、冷路徑 push
全程 9m22s；該檔註解裡 2026-07-26 的 57.9s 已過期，**NEVER** 直接引用，要用先自己重量）。這是 main-first
的已知成本，**NEVER** 用 `--no-verify` 省它。

## 序列中途失敗的復原

**序列中途失敗的復原**（七格都要會）。**先問一句：這個版本號的 tag 已經推出去了嗎**
（`git ls-remote --tags origin "v<版本>"`，有輸出就是已公開）——沒公開的 tag 怎麼刪重打都是本機
的事，已公開的 tag 是對外物件，**NEVER** 拿下面任何一格當作刪遠端 tag 的授權（唯一的例外是本檔 § 推 tag 後的觸發確認
開頭那段 2026-06-03 的「tag 推出去了但 workflow 沒觸發」，那裡刪並重推的是**同一個 SHA 上的同名
tag**，內容不變）。

**下面每一格都適用的一條**：`pnpm version` 跑在 `&&` 串**之前**，所以進到任何一格時版本號都已經
bump 過了——**NEVER 因為「重跑一次比較乾淨」而再 bump 一次**。每一格都是**從失敗的那一步接著做**，
只有明寫「改用下一個版本號」的那幾格才重新 bump。

- **`git commit --only` 這一步就失敗**（典型：pre-commit gate 擋下，某 consumer 實測）→ 版本號
  **還在 working tree 上**（見上面那條共通規則）。照 gate 的訊息修好之後，只重跑
  `git commit --only … && git push origin main && git tag … && git push origin …` 這一串。**修正若動到 `package.json` 以外的檔**，
  那個 `--only … -- package.json` 的 pathspec 會把它們留在 working tree（下一趟 push 多半再被同一支
  gate 擋下）——**MUST** 決定它們要不要一起進 deploy commit，要就把路徑加進 pathspec，不要就先另外
  commit 掉。**若 `git commit --only` 的失敗訊息是「nothing to commit」或「no changes added to commit」**（後者出現在 `package.json` 已 commit、但別的檔還 dirty 時），代表上一趟其實已經 commit
  成功了（版本號已在 HEAD、不在 working tree）——這一格的前提不成立，**MUST** 跳到下一格從
  `git push origin main` 接著做。
- **`git push origin main` 這一步失敗**（競態／權限／網路／被某支 pre-push check 擋下）→ 此時
  tag 還沒打、什麼都還沒公開，沒有對外的東西要救。但 deploy commit **已經建好了**——從頭重跑Step 6-A
  會再建一個 `🚀 deploy:` commit 並跳掉一個版本號，正好製造 Step 6-B 警告的「main 上有發布 vX 卻沒有
  tag」。**MUST 從失敗的那一步接著做**：照錯誤訊息修好之後跑 `git push origin main && git tag "v{新版本號}" && git push origin "v{新版本號}"`。
  **這一串沒有 commit 那一節，所以 `rules/push-main發版判準.md`（Step 6-A）Rule 2 那條「tip 必須是這次的 deploy commit」不再由 `&&` 保證——
  接之前 MUST 自己跑一次 `git log -1 --format=%s`**。修 pre-push check 通常會多出新的 commit，
  那時 tip 已經不是 deploy commit 了：要嘛把修正 squash 進 deploy commit，要嘛接受 tag 打在新的
  tip（deploy commit 訊息仍寫著同一個版本號，內容多了那次修正——可以，但 MUST 是你**知道**的選擇）。
  競態（remote 有新 commit）**MUST** `git pull --rebase` 後再接這一串，**NEVER** 用 `--force`
  （會把別人的 commit 從 remote 抹掉）。
- **main 已上、推 tag 失敗（權限／網路）** → 主線沒有分叉，**直接重推 tag** 即可，**NEVER** 為了
  「趕快觸發部署」改回 tags-first。**NEVER 把這一格讀成「部署還沒開始，慢慢來」**：走到 6-A 的
  一般路徑是 `confirmed-push-main`，那個形狀下**剛才那次 main push 就是部署**（見 Step 6-Gate 的
  判定表）——tag 在這裡是紀錄，不是觸發器。重推之前若 remote main 又前進了，會落到下面「被
  `tag-position` 以落後擋下」那一格。
- **`git tag` 這一步就失敗**（exit 128：同名 tag 本機已存在，多半是上一趟沒收乾淨）→ 此時 main
  已上、tag 沒建，**NEVER** 直接「重推 tag」（那會把本機那個指向舊 commit 的同名 tag 推出去）。
  先 `git ls-remote --tags origin "v<版本>"` 問 remote——**`git show-ref` 只看得到本機，答不了這一題**。
  remote 沒有 → 是廢棄的本機殘留，`git tag -d` 後重打；remote 已經有 → 這個版本號已經發過，
  **MUST** 改用下一個版本號（`pnpm version patch --no-git-tag-version` 重跑Step 6-A——**NEVER 漏掉那個旗標**，裸 `pnpm version` 會順手建 commit 與 tag，正好把你送回這一格），**NEVER** 刪遠端 tag 去讓路。
  main 上那個沒有 tag 的 `🚀 deploy: … v<舊版本>` commit **MUST** 照下面最後一格的做法留一行說明。
- **main 已上、推 tag 被 `tag-position` 以外的 pre-push check 擋下** → tag-only 那趟會把 8 支全跑
  （見上段），所以擋你的可能是 lint / typecheck / ratchet 任何一支。**MUST 照那支自己的訊息修好
  再推 tag**，**NEVER** 用 `--no-verify` 繞過（main 已經公開，這時候放行等於讓 tag 指向一棵沒
  過 gate 的樹）。**修正若產生了新的 commit（修 lint / typecheck 幾乎必然如此），MUST 先
  `git push origin main` 把它們推上去，再推 tag**——tag 要指向的就是修完之後的那棵樹。
  推完 main 之後若 remote main 又被別人前進了，才落到下面「被 `tag-position` 以落後擋下」那一格；
  **NEVER 帶著本機未推的 commit 直接走進那一格**，它的 `git merge --ff-only origin/main` 在那個
  狀態下必定回 `Not possible to fast-forward`。
- **main 已上、`git tag` 也成功，但推 tag 被 remote 以 `! [rejected] … (already exists)` 拒絕**
  → 這個版本號的 tag **已經在 remote 上**（`tag-position` 只看本機與 `origin/<default branch>`
  的關係，不看 remote 有沒有同名 tag，所以它會放行）。成因典型是先前某趟 `--tags` 殘留、或
  另一個 clone／worktree 已經推過。**NEVER** 反覆重推（會一直被同一個理由拒絕），**NEVER**
  刪遠端 tag 讓路——**MUST** 改用下一個版本號（同樣帶 `--no-git-tag-version`）重跑Step 6-A，並照下面最後一格的做法替 main 上那個
  沒有 tag 的 `🚀 deploy: … v<舊版本>` commit 留一行說明。
- **main 已上、但推 tag 被 `tag-position` 以「落後」擋下** → 代表**別的 session 在你推 main 與推
  tag 之間又 push 了 main**（那本身違反 deploy-gate 的「發版窗口內不 push main」——窗口從**發版序列自己的那一次 main push** 起算，見上面那段與 `vendor/snippets/deploy-gate/README.md` § 操作規約）。
  正解是**在新的 HEAD 上重跑一次發版序列**：`git tag -d "v<舊版本>"`（本機那個沒公開的，刪掉）
  → `git fetch origin main && git merge --ff-only origin/main`（**先併進來，否則下一步 push 必被
  non-fast-forward 拒絕**）→ `pnpm version patch --no-git-tag-version` → 新的 deploy commit →
  push main → 打**新版本號**的 tag → 推 tag；那些插進來的 commit 就一起出這一版。
  main 上會留下一個沒有對應 tag 的 `🚀 deploy: 發布新版本 v<舊版本>` commit——**MUST** 在新的
  deploy commit 訊息或 HANDOFF 裡寫一行「v<舊版本> 未發版，內容併入 v<新版本>」，否則下一個
  接手的人會照 Step 6-B 的理由誤判已發版。
  **NEVER** `git tag -d` 之後把**同一個版本號**重打在別人的 commit 上（版本號與內容從此對不起來），
  **NEVER** 用 `CLADE_ALLOW_STALE_TAG` 過關——那個逃生口只留給「刻意在舊 commit 上打 hotfix
  release tag」，把它用在這裡就是拿它繞過一個你其實看得懂的攔阻。

## 推 tag 後的觸發確認

> 2026-06-03 v1.185.1 實證：「main 先、tag 後」分兩步推送**同一個 SHA** 時，GitHub 先收到 main
> commit SHA、再收到指向同一 SHA 的 tag，有機率不觸發 `push:tags` workflow。修法是刪掉並重推
> 同名 tag（`git push origin :refs/tags/v<版本>` → `git tag -d "v<版本>"` → `git tag "v<版本>"` →
> `git push origin "v<版本>"`）。
>
> 因此**只要這次推的 tag 會觸發任何 workflow**，就 MUST 在推 tag 之後實際確認它跑起來了。
> 純 `push-main` 形狀（Step 6-Gate 回 `confirmed-push-main`，也就是走到Step 6-A的一般路徑）沒有
> tag-triggered run，這一格標「不適用」即可；真正會命中的是 **6-B 選 `[1]` 後回頭執行Step 6-A**
> 的形狀，以及 6-Gate 的 `derived=ambiguous`（deploy workflow 掛了 ≥2 種觸發——同一支同時吃 main push 與 tag push，或兩支各吃一種）。
> **NEVER** 因為「Step 6-A叫 `push-main` 專用」就把這段當成永遠不必做——判「這次的 tag 觸不觸發」
> 看的是 6-Gate 印出來的 **`derived=`**，不是Step 6-A的標題，也**不是 `status=`**：
> `status=unconfirmable` 同時涵蓋兩種完全相反的形狀——`derived=ambiguous`（deploy workflow 掛了
> ≥2 種觸發，**tag 會觸發**，這一格要確認）與 `derived=none`（**根本沒有 deploy workflow**，tag
> 什麼都不會觸發，這一格「不適用」）。把兩者當成同一件事，在 `none` 那格會讓你對一個**已公開**的
> tag 執行刪除重推——本檔唯一不可逆的動作——去追一條本來就不存在的 run。
> **判定用「哪些要做」而不是「哪些不做」**——`derived=` 只有六個值，其中**只有 `tag-v` 與
> `ambiguous` 代表這次的 tag 真的會觸發**，要走下面的確認：
>
> | `derived=` | tag 會觸發嗎 | 這一段 |
> | --- | --- | --- |
> | `tag-v` / `ambiguous` | 會 | **MUST 確認** |
> | `push-main` / `pr-merge` / `manual` / `none` | 不會 | **NEVER 進入確認與重推**，Step 7 標「不適用（`derived=<值>`）」 |
>
> **NEVER 反過來背成一張「不適用」清單**：那張清單漏一個值，漏掉的那格就會把你送去對一個
> **已公開**的 tag 執行刪除重推，去追一條本來就不存在的 run。`push-main` / `pr-merge` / `manual`
> 都會經由 6-B 的 `[1]` 回頭跑Step 6-A，不是只有 `confirmed-push-main` 才走得到這裡。確認時 **MUST 用 tag 名過濾**——`-w <production workflow>` 之後，同一個 SHA 上仍可能混進 main push 觸發的**同一支** workflow 的 run：
>
> ```bash
> for i in $(seq 7); do
>   gh run list --workflow <production workflow> --limit 10 \
>     --json headBranch,event,status,createdAt \
>     --jq '[.[] | select(.headBranch == "v<版本>")]' | tee /dev/stderr | grep -q headBranch && break
>   if [ "$i" -lt 7 ]; then sleep 10; fi
> done
> ```
>
> **同一個 workflow 同時由 main push 與 tag push 觸發時（6-Gate 的 `unconfirmable` 形狀），
> NEVER 用 `gh-ci-watch.sh --tag` 代替上面這段**：那個旗標把 tag 解析成 SHA 再用 `-c <SHA>` 過濾
> （`TAG_SHA=$(git rev-parse …)`），而 main-first 之下兩條 run **本來就在同一個 SHA 上**——它分不開
> 兩者，於是「tag 沒觸發」會被 main 那條 run 報成綠。（純 `tag-v` 形狀下 main push 不會產生這個
> workflow 的 run，`--tag` 是對的——那正是 gh-ci-watch skill 逐字要求用 `--tag` 的情境。）
>
> 也 **NEVER 換成 `gh-ci-watch.sh --branch "v<版本>" --timeout 60`** 當「等價寫法」：那支要輪到
> **終態**才回，production run 幾乎不可能在 60 秒內跑完，於是正常情況也回 `WATCH_TIMEOUT` exit 3；
> 它的 `--branch` 模式還自帶 `SINCE = now-120s` 的時間窗與 ≥30s 的輪詢間隔。這裡要問的只是
> 「run 建立了沒」，用上面那圈就好；要看部署**跑完**才用 gh-ci-watch。
>
> **判「未觸發」之前 MUST 先確認 `gh` 本身是好的**（`gh auth status` 或看上面那圈有沒有印出錯誤）：
> auth／網路壞掉時 stdout 一樣是空的，而空與「沒觸發」在這裡長得完全一樣——照著往下走就是對一個
> **已經公開**的 tag 做刪除重推，正好是本檔唯一被特別授權、也唯一不可逆的動作。
>
> **`gh` 正常、且輪詢滿 60 秒（t=0 起每 10 秒一次，共 7 次）仍查不到該 tag 的 run，才判未觸發**，再走上面的刪並重推，**NEVER** 改回 tags-first
> 去繞過 `tag-position`。
