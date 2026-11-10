<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

ci-workflow.md — CI workflow 撰寫規約——外部 GitHub Action 的 uses: MUST SHA-pin、CI 三層分工（PR 只跑必要、e2e 在合併後、0-A 在 PR 開出後）；動 .github/workflows 或 .github/actions 時載入
5-7 前導 — CI Workflow 撰寫規約
9-30 External action MUST SHA-pin
32-58 CI / test workflow MUST cancel superseded runs on the same ref
60-87 CI 三層分工
89-110 job 內 step 並行（`parallel`／`background`）：建議，不是預設

commit.detail.md — Commit 全文規約（gate 清單、Single Session Lock、WIP 處置決策樹、main worktree 預設位置、ad-hoc `git commit --only` 紀律與 Verify / Recovery、路徑白名單、trunk hard gate、Stash 自動處置 gate、分組與訊息規範、Tag 位置 release hard gate）；always-load 的薄 pointer 在 [[commit]]，觸發時機是「下任何 git commit / git add / git stash / git tag / git push --tags / git push origin v<版本> / /commit 之前」，由 [[commit]] 的 MUST-Read 指針叫醒
5-12 前導 — Commit（全文）
14-38 理由
40-44 Single Session Lock
46-81 WIP 處置決策樹
83-126 Commit 預設位置：main worktree
128-130 Ad-hoc commit 必走 `git commit --only -- <paths>`
132-152 Ad-hoc commit 必走 `git commit --only -- <paths>` › Hard rule
154-158 Ad-hoc commit 必走 `git commit --only -- <paths>` › Why
160-171 Ad-hoc commit 必走 `git commit --only -- <paths>` › `--only` 限的是路徑，不是內容（hard rule）
173-175 Ad-hoc commit 必走 `git commit --only -- <paths>` › Untracked file 例外
177-200 Ad-hoc commit 必走 `git commit --only -- <paths>` › Verify hard rule
202-215 Ad-hoc commit 必走 `git commit --only -- <paths>` › Recovery from mixed commit (multi-session safety) — hard rule
217-219 Ad-hoc commit 必走 `git commit --only -- <paths>` › Fleet sweep 升級規約
221-231 Ad-hoc commit 必走 `git commit --only -- <paths>` › 隔離 worktree ≠ 繞過 /commit（hard rule）
233-251 Ad-hoc commit 必走 `git commit --only -- <paths>` › `--only` 適用範圍 = 路徑白名單（hard rule）
253-276 Ad-hoc commit 必走 `git commit --only -- <paths>` › 推 default branch 前 MUST 列舉並宣告 ahead 範圍（pre-push ahead-ownership gate）
278-309 程式化區段編輯的定界（hard rule）
311-315 Multi-session shared working-tree 的 git hazard
317-319 main / master 限定的 hard gate
321-330 禁止事項
333-372 Stash 自動處置 gate
374-385 例外（極少）
387-399 Commit 分組與訊息規範
401-437 Tag 位置（release hard gate）
439-492 Tag 位置（release hard gate） › 機械 gate 與它的邊界
494-507 Tag 位置（release hard gate） › CI 紅在 tag-triggered run 時，第一件事
509-511 搭配

commit.md — 要 commit，或要處置 WIP／stash 之前
4-11 前導 — Commit
13-17 強制載入指針（thin pointer；全文在 [[commit.detail]]）
19-40 pre-commit hook 三條紀律（hook 是 fleet 預設形態）
42-89 禁止事項 — WIP 處置禁令（嚴格，NEVER 下推）

commit.trunk-gates.md — main / master 限定的人工檢查 commit hard gate 與 multi-session git hazard 交叉索引；觸及 work item carrier（tasks/**、specs/plans/**、docs/plans/**）時 path-scoped 載入
8-15 前導 — Commit — Trunk Gates（[[commit]] detail）
17-31 Multi-session shared working-tree 的 git hazard 地圖
33-57 人工檢查 Gate（main / master 限定，**hard rule**）

github-flow.md — GitHub Flow 事件責任與成本邊界 — checkpoint、review、合併、回收、發版分成不同事件
13-18 前導 — GitHub Flow 事件契約
20-36 事件與成本
38-66 Integration branch（預設開發模式：小步快跑）
68-117 各事件的 test-lane
119-176 Draft 不是 ready
178-201 發版的部署窗口（production）
203-207 證據綁定
209-217 遠端強制與本機契約
219-264 本機 main 與 origin 的對齊
266-276 合併後分支回收
278-280 失敗路徑

self-hosted-runner.md — Self-hosted GitHub Actions runner 的標籤設計、job 路由契約與職責分工
5-12 前導 — Self-Hosted Runner 標籤設計與職責分工
16-21 MUST › 1. 標籤只宣告該 runner 真正具備的能力
23-36 MUST › 2. 有主機硬需求的 job MUST 釘到只有合格 runner 才有的標籤
38-44 MUST › 3. 標籤語意分兩層：能力標籤 vs 位置標籤
46-57 MUST › 4. 職責分工（三類 runner）
59-76 MUST › 5. 清理（housekeeping）NEVER 擋住部署
78-95 MUST › 6. Action 版本釘選要考慮 runner 的 persistence
97-105 MUST › 7. 同一台機器上的 runner 共享 home，NEVER 在 job 執行中動共用目錄
107-119 MUST › 8. Runner auto-update 會破壞 node externals 的 symlink
121-154 MUST › 9. GitHub-hosted 的「跳過下載」建議 NEVER 直接套到 self-hosted
156-209 MUST › 10. 信任分層：untrusted-execution job NEVER 落在 production-access runner
211-260 MUST › 11. Deploy 私鑰只活在 job 內：寫進 `$RUNNER_TEMP`，`always()` 收尾刪除
262-297 MUST › 12. Runner 主機憑證衛生：runner user 碰得到的一切，都等於交給每一個 job
299-347 MUST › 13. production-access runner 的 GitHub 端准入
349-377 MUST › 14. CI step 寫法：pnpm store 走本機、env 只靠 secret 注入
379-383 NEVER
385-440 診斷 SOP
442-451 修復的兩層
