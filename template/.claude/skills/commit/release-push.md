# /commit Step 6-A 推送順序、失敗復原與 tag 觸發確認


> 本檔是 Step 6-A 的 branch 分頁。發版授權（Step 6-Gate）在 `rules/發版授權判準.md`，6-A 的串接命令在 `rules/push-main發版判準.md`；本檔只放 main 先、tag 後的理由與邊界、序列中途失敗的續跑判定（`release-resume.mjs`）、推 tag 後的觸發確認。**6-A 串接命令任一步失敗時 MUST 讀 § 序列中途失敗的復原並從失敗那一步接著做**；**Step 6-Gate 的 `derived=` 是 `tag-v`／`ambiguous` 時，推 tag 之後 MUST 讀 § 推 tag 後的觸發確認**。串接命令一次成功且 `derived=` 是其他值時不需要讀本檔。

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
過關**：tag 指向 origin 上還不存在的樹，是推出去就收不回的對外物件。（唯一例外是從舊 tag 開、
已推上 origin 的 hotfix branch，條件見 `rules/core/commit.detail.md` § 機械 gate 與它的邊界；
Step 6-A 的一般發版序列不會走到它。）

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
也一起禁掉。從舊 tag 開 hotfix branch、帶新修正發版時會兩邊同時命中，唯一的超前例外與它的三條
MUST 也在同一節。）

**main 先不牴觸 deploy-gate 的「發版窗口內不 push main」**：那條防的是**別的**工作在窗口內 push，取消掉發版 SHA 的 staging run。發版序列自己的那一次 main push 是窗口的**起點**，不是窗口內的干擾。窗口的完整定義見 `~/offline/clade/vendor/snippets/deploy-gate/README.md` § 操作規約，race 與 gate 的 recovery 見同檔的 § 這道 gate 有一個消不掉的 race 與 § Recovery。

**tag-only 那趟 push 會讓 pre-push 全套 8 支照跑**：`vendor/scripts/pre-push/runner.sh`
在只推 tag 時算不出 changed paths，刻意 fail-open 成全跑（該檔 `PATH_FILTER_ACTIVE` 的 `else`
分支印出「算不出 changed paths（新 branch 首推 / 手動執行 / 只推 tag）→ 全部照跑」）。8 支並行，
wall time 由最慢的單一 check 決定（某 consumer 2026-09-07 實測暖路徑 `nuxt-typecheck` 2m29s、冷路徑 push
全程 9m22s；該檔註解裡 2026-07-26 的 57.9s 已過期，**NEVER** 直接引用，要用先自己重量）。這是 main-first
的已知成本，**NEVER** 用 `--no-verify` 省它。

## 序列中途失敗的復原

6-A 串接命令任一步失敗時，先跑判定，再照代碼從失敗的那一步接著做：

```bash
node "$COMMIT_RESOURCE_DIR/scripts/release-resume.mjs" --repo "$COMMIT_REPO" [--push-error <上一趟 push 的 stderr 存檔>]
```

script 會先 fetch `origin/main`，查 package.json 版本、最近的 `🚀 deploy:` commit、本機與 remote 的 `v<版本>` tag，最後一行印 `resume_from=<代碼>`。推 tag 失敗時把 stderr 存檔用 `--push-error` 帶進去，它才分得出「被 `tag-position` 以外的 check 擋下」。連不上 remote（網路斷）時加 `--no-fetch`：改用本機的 `origin/main`，remote tag 查不到就印 `remote_tag=unreachable` 照本機狀態判。代碼集合以 script 為唯一定義，本表只把代碼對到動作。

評估：first-match；以上皆非 → RR*

| id | `resume_from` | 動作 |
| --- | --- | --- |
| RR1 | `tag-published` | 不用續；`derived=` 是 `tag-v`／`ambiguous` 時照 § 推 tag 後的觸發確認 |
| RR2 | `next-version` | `pnpm version patch --no-git-tag-version` 後重跑 6-A [^RR2] |
| RR3 | `retry-commit` | 照 gate 訊息修好，重跑 `rules/push-main發版判準.md` Rule 1 串接命令 [^RR3] |
| RR4 | `retry-push-main` | 先跑 `git log -1 --format=%s` 確認 tip，再跑 push main → 打 tag → 推 tag [^RR4] |
| RR5 | `push-main-then-tag` | 先推 main（帶 ahead 宣告），再打 tag／推 tag [^RR5] |
| RR6 | `rerun-on-new-head` | `git tag -d` 舊 tag → ff 併 `origin/main` → 下一個版本號重跑 6-A [^RR6] |
| RR7 | `retag-local` | `git tag -d "v<版本>"` 刪本機殘留，重打 tag 後推 tag |
| RR8 | `fix-check-then-push-tag` | 照那支 check 的訊息修；修出新 commit 就重跑判定，否則推 tag |
| RR9 | `push-tag` | 本機沒有 tag 就打，然後推 tag |
| RR11 | `confirm-tip` | `git log --format='%h %an %s' <deploy_commit>..HEAD` 逐筆認歸屬。`remote_only_commits` > 0 → `git pull --rebase` 後換下一個版本號重跑 6-A；否則全是本 session 為這次發版做的修正 → 照 RR5 推 main（若有未推）、在 HEAD 打 tag、推 tag；有任何別人的 commit → `git tag -d` 本機殘留後換下一個版本號重跑 6-A [^RR11] |
| RR10 | `not-in-release` | STOP：找不到本版號的 deploy commit，回報 script 輸出 |
| RR* | `unknown`、其他值、exit 非 0 | STOP，回報 script 的 stdout／stderr |

[^RR2]: remote 已經有這個版本號的 tag，且不是本次 deploy commit：可能是 `git tag` 撞到殘留、或推 tag 被 `! [rejected] … (already exists)` 拒絕。`tag-position` 不看 remote 有沒有同名 tag，所以後者它會放行。
[^RR3]: 修正動到 `package.json` 以外的檔時，`--only … -- package.json` 的 pathspec 會把它們留在 working tree，下一趟 push 多半被同一支 gate 擋下。要一起進 deploy commit 就加進 pathspec，不要就先另外 commit。
[^RR4]: 這一串沒有 commit 那一節，「tip 必須是這次的 deploy commit」不再由 `&&` 保證。修 pre-push check 多半會多出 commit：要嘛 squash 進 deploy commit，要嘛接受 tag 打在新的 tip，但 MUST 是你知道的選擇。被 `ahead-ownership` 擋下＝列舉之後 remote 前移或 tip 換過：`git fetch origin main`，重跑 `git log --oneline origin/main..HEAD` 逐筆認得再推；有不是本 session 產生的 commit 就停下，照 `rules/core/commit.detail.md` § 推 default branch 前 MUST 列舉並宣告 ahead 範圍 查歸屬。remote 有新 commit 時先 `git pull --rebase`。
[^RR5]: tag 要指向修完之後的那棵樹。帶著本機未推的 commit 直接走 RR6，`git merge --ff-only origin/main` 必定回 `Not possible to fast-forward`。
[^RR11]: HEAD 已不是 deploy commit（推 main 之後又修了 commit、或 RR6 ff 併入別人的 commit 後中斷），或 main 已上之後兩邊各有 commit。git 拓樸分不出 `deploy..HEAD` 是誰的，所以 script 不給推 tag 的代碼；這正是 RC7 要擋的情形。
[^RR6]: 代表別的 session 在你推 main 與推 tag 之間又推了 main（本身違反 deploy-gate 的「發版窗口內不 push main」，見 `vendor/snippets/deploy-gate/README.md` § 操作規約）。那些插進來的 commit 一起出新版。

不論命中哪一列，下表每條都要遵守：

評估：all-match（逐條檢查，命中就套用）

| id | 條件 | 約束 |
| --- | --- | --- |
| RC1 | 任何一列 | **NEVER** 再 bump 一次版本號；只有 RR2、RR6、RR11 改用下一個版本號 [^RC1] |
| RC2 | 任何一列 | **NEVER** 刪遠端 tag 讓路 [^RC2] |
| RC3 | 任何一列 | **NEVER** 用 `--no-verify` 繞過 pre-push check |
| RC4 | 任何一列 | **NEVER** 用 `CLADE_ALLOW_STALE_TAG` 過關 [^RC4] |
| RC5 | 要推 main | **NEVER** `--force`；main push 一律帶 `CLADE_PUSH_MAIN_AHEAD` 宣告 |
| RC6 | RR2、RR6、RR11 換版號 | 替沒有 tag 的舊 deploy commit 留一行說明 [^RC6] |
| RC7 | RR6、RR7、RR11 刪本機 tag 後 | **NEVER** 把同一個版本號重打在別人的 commit 上 |
| RC8 | 改用下一個版本號 | `pnpm version` 必帶 `--no-git-tag-version` [^RC8] |
| RC9 | 推 tag 失敗而 main 已上 | **NEVER** 改回 tags-first [^RC9] |

[^RC1]: `pnpm version` 跑在 `&&` 串之前，進到任何一列時版本號都已經 bump 過了。
[^RC2]: 已公開的 tag 是對外物件。唯一例外是 § 推 tag 後的觸發確認 開頭那段 2026-06-03 的情形：刪並重推的是同一個 SHA 上的同名 tag，內容不變。
[^RC4]: 那個逃生口只留給 hotfix release tag：刻意打在舊 commit 上，或打在已推上 origin 的 hotfix branch head 上（後者的三條 MUST 見 `rules/core/commit.detail.md` § 機械 gate 與它的邊界）。本表各列都是 Step 6-A 的一般發版序列，兩者都不適用。
[^RC6]: 在新 deploy commit 訊息或 HANDOFF 寫「v<舊版本> 未發版，內容併入 v<新版本>」；否則下一個接手的人會照 Step 6-B 的理由，把 main 上那個 `🚀 deploy: … v<舊版本>` 誤判成已發版。
[^RC8]: 裸 `pnpm version` 會順手建 commit 與 tag，正好又撞上同名 tag。
[^RC9]: 走到 6-A 的一般路徑是 `confirmed-push-main`，剛才那次 main push 就是部署（見 Step 6-Gate 的判定表），tag 在這裡是紀錄，不是觸發器。

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
