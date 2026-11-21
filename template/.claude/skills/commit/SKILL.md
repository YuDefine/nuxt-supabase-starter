---
name: commit
description: >-
  Use when 使用者要提交工作區變更、merge back 已完成 worktree，或拆多筆提交（PR 前準備器）。NOT for 散播
  clade（/clade-publish）、開 worktree（wt）、session 交接（/handoff）。
metadata:
  clade:
    permission_tier: action
effort: high
---


## User Input

```text
$ARGUMENTS
```

# SOP

`/commit` 是 **PR 前準備器**：只做 D0 起手 → D1 hook → D2 作者自驗 → D3 開 PR。D4 CI-fast、D5 0-A 審查、D6 處置、D7 CI-full、D8 放行合入在 PR 之後，由 CI、coordinator 與 merge-queue 承接，**NEVER** 在本 skill 內重跑它們（決策：D0–D9 重做 Q1=A，`yudefine-hq/plans/22-commit與CI流程重做.md`）。照順序走；每步條件成立才讀該條判準，讀完照做。

| 編號 | 本 skill 做什麼（舊編號） |
| --- | --- |
| D0 | 批次入口、鎖、範圍、跨 repo 交集（0-Batch、0-Lock、0-Coord、0-Transport、0-Scope、0-MR） |
| D1 | hook 自動跑（fmt、lint、TD、commitlint、truth-delta、secret 掃描），不用讀（0-S.1） |
| D2 | 作者自驗：typecheck、affected 測試、schema sync、意圖卡（0-A.0、0-C、Step 1） |
| D3 | 分組 commit、push、開非 draft PR（Step 2–4） |
| D4–D8 | 不在本 skill：CI、0-A、處置、合入由 PR 流程承接（0-A.1、0-F、Step 6-A）；0-B、0-D、0-E 仍是 D2 條件自驗（品質檢查判準 Rule 4），CI 另兜底 |
| 移出 | 交接 → `/handoff`；Notion → `notion-hub`；報告 → PR body（Step 5、6b、7–8） |

1. D0｜READ 每次進入 `/commit`，讀取 `rules/批次入口判準.md`，先跑 `wt-helper batch status`。
2. D0-Lock｜READ 若要在多 session 共用樹（main checkout 或 batch integration 區）提交，讀取 `rules/鎖與退出判準.md` Rule 1 取鎖；自己專屬的 worktree 跳過。
3. D0-Scope｜READ 若候選已定（每次），讀取 `rules/前置探測判準.md`。
4. D2｜READ 若候選已定（每次），讀取 `rules/品質檢查判準.md`，跑本機自驗並填意圖卡。
5. D2-Schema｜READ 若候選已定（每次，不先判 diff），讀取 `rules/schema觸發判準.md` 跑 Rule 1 的無條件判定；印 `HAS` 才續讀 `schema-sync.md`。
6. D3｜READ 若自驗已過，讀取 `rules/分組與提交判準.md`，分組 commit、push、開 PR。
7. D9-Gate｜READ 僅當 workflow 是 trunk-based、使用者要發版且已 land：先跑 `/handoff` 寫完 HANDOFF／ROADMAP（`/handoff` 不 commit），接著讀取 `handoff-steps.md` § 5-E，以精確 paths `git commit --only` 提交那幾個 carrier（不 push，讓它跟發版 commit 同一次 push；**NEVER** `git add` ＋裸 `git commit`，共用 main checkout 會吞掉別 session 的 staged），再讀取 `rules/發版授權判準.md`，跑 `deploy-trigger-check.ts`（PR 制 consumer 的發版走 publish，不在這裡）。trunk-based 沒有 PR，push main 前 MUST 先有 0-A 的 `FINALIZE` verdict（見 `rules/分組與提交判準.md` Rule 4）。
8. D9 Step 6-A｜READ 若 `verdict=confirmed-push-main`，讀取 `rules/push-main發版判準.md`，先照 Rule 0 查 consumer `.clade/rules` 的 `> Overrides:`，有就以該檔為準。
9. D9 Step 6-B｜READ 若 `verdict=needs-approval` 或腳本不存在，讀取 `rules/停在push-main判準.md`。
10. D9-Notion｜READ 若 tag 已推出且 consumer 宣告 `notion.hub`，每件 work 跑 `notion-sync.ts release --work <id> --tag <tag>`：記修復版本／上線日期／PR，還沒掛完成說明的票留在進行中、不寫驗收中。本步不等部署，**NEVER** 持鎖 park 或延後放鎖。實查正式機已是 tag 版本的票，可在本步直接走 `notion-hub` Phase 9 `ticket-article.ts ship --work <id> --tag <tag>`；其餘待補票交步驟 12。
11. Final｜READ 若有取鎖且要退出（完成、gate 失敗、中止皆同），讀取 `rules/鎖與退出判準.md` Rule 2 釋放鎖。**鎖是最後一步才放**：trunk-based 的 HANDOFF commit、版本 bump、deploy commit、tag 與 `git push origin main`（步驟 7–10）都在持鎖期間做完，**NEVER** 在 D3 之後先放鎖再發版。
12. D9-Notion 上線後｜READ 若步驟 10 留下待補完成說明的票：鎖放掉之後由本 session 接手，**NEVER** 留給下次想起來。實查正式機版本已是 tag → 照 `notion-hub` Phase 9 `ship --work <id> --released <tag>`；還沒上線 → 有 `CLADE_DISPATCH_ID` 的 session 以 `--complete blocked --wait-until in:<部署預估分鐘>m` 交回（續接筆記寫「實查正式機版本 → ship --released <tag>」），互動 session 留在本 session 等部署跑完再做；session 結束時仍沒上線就逐張寫進 HANDOFF 待辦（notion-hub Phase 6 step 2 與看板 `⚑ 已發版待完成說明` 兜底）。

D9 三份判準與 `release-push.md` 內的舊編號對照：Step 4→D3、Step 5→`/handoff`、Step 6b→步驟 10、Step 7–8→PR body／回報。

## 必讀量（驗收 ≤40KB）

預設執行 = `SKILL.md` ＋ 步驟 1、3、4、5、6 的判準；步驟 2、7–12 與 `gates.md`、`handoff-steps.md`、`batch.md`、`schema-sync.md`、`release-push.md` 命中才讀。量測：

```bash
cd capabilities/core/skills/commit && wc -c SKILL.md rules/{批次入口,前置探測,品質檢查,分組與提交,schema觸發}判準.md | tail -1
```

## Description 原文（E1 搬入）

> frontmatter description 上限 250 字元（白名單 300）；被縮掉的觸發詞、流程敘述與 NOT for 全文留在這裡，不刪內容。

> Use when 使用者要求提交工作區變更、merge back 已完成 worktree，或 worktree 就緒佇列達到提交條件；需要拆成多筆時同樣適用。這是 PR 前準備器（D0 起手、D2 作者自驗、D3 開 PR），CI 與 0-A 審查在 PR 之後。NOT for 把 clade 改動散播到 consumer（走 /clade-publish），NOT for 新建實作 worktree（交 wt 建立），NOT for session 交接（走 /handoff）。


