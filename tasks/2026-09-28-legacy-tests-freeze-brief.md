---
coordinator_brief: worker
template: templates/worker-brief.md
template_sha256: e332ec34922373c48d1f9402048f7361a79c8ca2e527de9a28331ee1bf918de0
body_sha256: 5e17f357eebe6a9bc997d33a187ae2ae448623ccb5ebc8aff688cff40ccac212
generated_at: 2026-09-27T19:33:46.089Z
generator: scripts/brief.ts（NEVER 手改；要改就改 data 重新產生）
---
# nuxt-supabase-starter legacy-tests P7 凍結（冷續接 w94:p1）

你是 bounded worker，主持者是 desk w89:p8B。Charles 不在現場：**NEVER** 用 `AskUserQuestion` 或任何互動式選單等人；要決定的事一律走下方「回報」的 `--complete blocked`。

## 訊號
- 前任 w94:p1（dispatch 4f57d108）已修 consumer-meta（1f82fee8），blocked 在等 clade 送達 legacy-tests CLI；v1.13.41 已送達（main 1a64e709，`template/scripts/legacy-tests.ts` 存在），NEVER 對舊 pane 發訊
- 前任留的下一跳 brief：`tasks/2026-09-28-legacy-tests-p7-next-hop.md`（worktree 內同路徑），照它的前置條件與驗收
- Charles plan P1 Q3 A：六家都 relay；starter（template）未標記舊測試 40 支

標準 pointer：
- `rules/modules/capabilities/aixbdd/legacy-tests.md`（consumer 投影版在 `.claude/rules/`）
- `vendor/snippets/legacy-tests/README.md`（clade cookbook）
- clade `specs/plans/W-2026-09-26-legacy-test-absorption/plan.md` § Open work P7

## 唯一可寫的樹
`/home/charles/offline/nuxt-supabase-starter-wt/legacy-tests-freeze`（branch `session/2026-09-28-0333-legacy-tests-freeze`）。開工前 `export CLADE_WORK_ID=W-2026-09-26-legacy-test-absorption`。**NEVER** 在 main checkout 寫入。

## 檔案所有權
- 這段期間下列檔案歸你，主持者不動：
  - `/home/charles/offline/nuxt-supabase-starter-wt/legacy-tests-freeze/**`
- 下列檔案歸主持者或別人，你 NEVER 動：
  - starter main checkout 與其他 worktree
  - clade 任何檔
- 需要動上面兩份以外的檔 → 停下來回報，不要自己動手。

## 要做的事
照 `tasks/2026-09-28-legacy-tests-p7-next-hop.md` 在 template 內分類、mark、seal 凍結舊測試，commit `.legacy-tests.json` 走 starter 自己的落地流程。NEVER 為了讓狀態變綠而刪測試或改 CLI；殘 1W devSignin stale 屬 maintainer 決策，不在本件。

## 驗收
- `node scripts/legacy-tests.ts status --json`：`state`=`frozen`、`sealed`=`true`、`late_marked`／`malformed` 皆空
- `.legacy-tests.json` 已 commit 並落到 origin/main（未 commit 會被 clade audit 判 NOT-FROZEN）
- 該 consumer 完整測試綠（附指令與輸出摘要）
- 本機只跑相關測試＋`npx tsc -p tsconfig.clade.json --noEmit`＋`vp check`；廣範圍回歸看 PR CI，回報時分開寫。
- 落地：nuxt-supabase-starter 是 trunk-based：照該 repo 的 commit 規約落地並 push。

## 共通紀律
- Charles 不在現場：**NEVER** `AskUserQuestion`／互動式選單；要決定的事走 `--complete blocked --decision …`。
- commit 一律明確 pathspec；**NEVER** `git add -A`／`git stash`／`git reset --hard`／`--force`／`--no-verify`。
- **NEVER** 把 `vendor/ledger/signals.jsonl` 的追加行帶進 commit。
- **NEVER** 自己 ready／merge、**NEVER** 自己跑或派 0-A reviewer、**NEVER** relay 或另派 worker。
- 新能力還沒到（wrapper 不認得、seat 不存在）時停下來回報，**NEVER** 退回舊流程。
- `/tmp` 撞配額就改用 `TMPDIR=$HOME/.cache/clade/tmp`。
- context 快滿：先 commit＋push（有 push_hold 的 repo 只 commit，NEVER push），再 `--complete blocked` 寫明做到哪。

## 回報
- `node ~/offline/clade/vendor/scripts/herdr-session-handoff.ts --complete success|blocked|failed --summary '<PR 號、head SHA、改檔清單、驗證結果（本機／CI 分開）、剩餘事項>'`
- 留給主持者的下一步寫成 durable brief 檔，加 `--followup-brief <絕對路徑>`。
- `--complete` 一定要送：主持者靠它收割。
