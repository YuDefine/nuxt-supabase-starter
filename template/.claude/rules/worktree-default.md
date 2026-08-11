<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Worktree Default

> **無 frontmatter — unconditional always-load**。規約必須在每個會改 code 的 session Read 任何檔之前生效。

繁體中文

**核心命題**：multi-session 並行開發共用單一 working tree，staged 區、branch HEAD、partial WIP 都會跨 session 滲漏。

操作層面由 `/wt` 全自動 orchestrate — user 不需手動 add / merge / cleanup，主線 cwd 全程不動。

此規則優先於全域 `~/.claude/CLAUDE.md` 的「git workflow」相關段落（若存在）。

---

## §1 預設用 worktree

要寫、改、刪 tracked file 的工作 **MUST** 在獨立 worktree 內執行，**NEVER** 直接在 main 改。

**操作方式**：user 在 main 直接打 `/wt <task>` — `/wt` 建 worktree、dispatch subagent 進去做事（細節見 [[wt]]）。主線 chat session 全程 cwd 不動、不切 terminal、不開新 session。

**判定「要動 code」**：請求含 implement / fix / refactor / add / edit / 部署準備 / migration / config 寫入等動詞，且目標是 tracked file。

**例外：read-only session**。只讀不寫檔（grep / log / audit / git history / 解釋 code），**MAY** 在 main worktree。

**例外：main-bound skill（`/spectra-archive`）**。archive 語意就是「把 change 合併進 main」：Step 0 先 `wt-helper merge-back` 吸收對應 worktree，再做 bookkeeping（mv folder / delta sync / screenshot sweep）— 所有寫入目標都是 main，走 worktree 只多一道 merge-back、無 isolation benefit，因此 **MAY** 在 main worktree 直接跑。其他 spectra-* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）**不在此例外**，仍須走 `/wt`。

**判定「已在 worktree」**：`git rev-parse --git-dir` 含 `/worktrees/` 子路徑即已在 worktree，**不要**疊建新 worktree。

### §1 archive-on-main 的 clobber 窗口（pitfall 2026-06-01）

archive-on-main 例外讓未 commit 的 archive batch 躺在 **shared main**；`/commit` 因 gate halt 時這批 dirty 長期留在 main，會被別 session 的 `wt-helper add --baseline-strategy stash` 當 unclaimed dirty 整批捲進 `refs/wt-baseline/*`（實證見 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]]）。

**MUST**（縮短 / 消除窗口）：

- **archive 收尾的 follow-up fix（修測試 / 補 code / 加 migration）走 `/wt` 進隔離 worktree**，**NEVER** 在 main 累積多步 in-flight 工作等 commit；archive bookkeeping 本身才 MAY 在 main 跑。
- `/commit` 因可恢復的 gate halt、batch 需進一步 code 改動才能過 gate 時，**SHOULD** 立即把 batch 移進隔離 worktree 修。
- 跨多步在 main 累積 batch 且無法立刻 commit 時，**SHOULD** 寫 coarse claim 讓別 session 的 `otherSession` guard 看得到這批 dirty，commit 後 `drop`：

  ```bash
  node scripts/claim-helper.ts add --change-id main-session-wip \
    --branch main --worktree-path "$(pwd)" \
    --expected-paths "$(git status --porcelain | awk '{print $2}' | paste -sd, -)"
  # 完成 / commit 後：
  node scripts/claim-helper.ts drop <session-id>
  ```

  claim 檔 schema、誰讀、stale 處理見 [[session-claims]]（path-scoped）。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch。

**無例外**。先前的 `--dispatch-from-handoff` flag 已**移除** — subagent 隔離 cwd 達到同樣 UX。理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash cwd state、未完成 Read window。

### §1.x 階段間 setup chore：主線一行式 `cd` 進 worktree 自動跑

Phase 切換之間若需在 worktree 跑 **local-only** setup chore，主線 **MUST** 用 Bash `cd <wt> && <cmd>` 一行式自跑，**NEVER** 把指令清單推回 user。subshell `cd` 不影響 parent cwd（§1 invariant 講 sticky cwd，不禁 subshell cd）。

**自動代勞 OK**：`pnpm install` / `pnpm db:*` / `pnpm supabase:sync` / `pnpm build` / `pnpm lint` / `pnpm test` / `vp check` / `tsc --noEmit` / local pnpm script（無 push/publish/deploy 副作用）。

**仍需 user 拍板（真 destructive）**：`rm -rf <wt>`、`git push`（已被 §5 禁）、Prod DB migration / Prod creds、outbound 訊息、shared infra。

**失敗處理**：跑爆主線自己診斷修復，不丟回 user。**反模式**（立刻停手）：列「請你 cd 過去跑」清單、「跑完回我 OK」。**例外**：user 明確說「我自己跑」/「先別動」尊重。

### §1 Pre-fork baseline guard（契約）

`wt-helper add` fork 之前會先偵測 main working tree 狀態再決定策略。**四條契約在每個 session 都成立**：

1. **預設完全不 capture main dirty** — main 原封不動、worktree 從 HEAD fork clean。
2. **要把 main WIP 帶進 worktree 必須顯式傳 flag** — `--include-unrelated-dirty`（bulk 全帶）或 `--baseline-scope-paths <comma>`（scoped，走 commit strategy）。有 change context 時 scoped 才是正解，bulk 是無從 scope 時的鈍器。
3. **傳了 `--include-unrelated-dirty` 之後，NEVER 對 user 宣稱「main working tree 不變」/「main 沒被動到」/「你的 WIP 還在 main」** —— 傳了它，那三句話**必然**是假的。**MUST** 明確告訴 user：main 上原有的 N 個 dirty 檔已搬進 worktree `<path>`，main 端現在是乾淨的。（per [[pitfall-include-unrelated-dirty-claimed-main-untouched]]）
4. **NEVER 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>`** 做 selective baseline sync —— git 2.50.1 pathspec stash 有 scope leak，stash commit 會包整個 tracked tree 的 modifications。任何「想把 X、Y、Z 三個檔搬去別 worktree」的場景，第一反應是 wt-helper 或 patch route。（per [[pitfall-git-stash-pathspec-scope-leak]]）

> **決定要 fork worktree 之後、送出 `wt-helper add` 之前，MUST 先讀 [[wt]] skill 的 `baseline-guard.md`**（SKILL.md Step 1 帶 MUST Read 指示；該 skill 由 hub-core plugin 提供，不在 consumer 的 `.claude/skills/` 下）—— unmerged / clean / dirty 三路分流、`--baseline-scope-paths` 的對齊要求、stash strategy 的隱性風險與 `rescue` 救援、bulk-capture 的還原三步驟都在那裡。

### Pre-flight guard 不適用範圍：spectra-propose

`spectra-propose` Step 11 的 `wt-helper add "<change-name>"` 呼叫**預設不帶** `--precheck-baseline`，整套 dirty / unmerged / scope guard **不適用**於 propose。理由：propose 全程只寫 `openspec/changes/<change-name>/`、跟 main 的 staged / modified / untracked 完全不撞檔；fork 基於 main HEAD commit，working tree state 留在 main；product code 要到 apply 階段才動。

**操作守則**：

- 看到 main dirty / staged / unmerged 時**直接** `/spectra-propose <name>`，**NEVER** 反射性建議 user 先 commit / stash / 詢問 staged 內容
- 例外：若 user 的 staged / WIP **就在** `openspec/changes/<change-name>/` 子目錄裡（重跑同名 propose 的 path collision 場景），先 inspect、跟 user 對齊是否覆蓋

> Anti-pattern 警示：別把這條鬆綁推廣到 `/spectra-apply` / `/spectra-ingest` / `/spectra-debug` — 這些 skill **會**寫 tracked product code，**仍須**走 §1 Pre-fork baseline guard。本例外**僅限** propose（fork 純粹為 apply 預備 worktree，不寫 product code）。

## §2 禁止 silent branch 建立

Agent **MUST NOT** 跑 `git checkout -b`、`git branch <name>`、或任何會產生新 ref 的指令，**除非**先取得使用者明確同意。

**唯一例外**：`/wt` 規約定義的 `session/<YYYY-MM-DD-HHMM>-<slug>` 自動命名 — 命名完全由 convention 決定，`/wt` invocation 本身就是 user 對該 branch 的授權。

### 工具內部 branch 建立不受此規約限制

User 顯式呼叫的 script（如 `propagate.ts` 建 `bump/<version>`）有 documented behavior，屬於 user authorized invocation。判定原則：「branch 是不是 user 透過工具 invocation 隱含授權的？」是 → 通過；不是 → 必須先問。

### Agent 想自由發揮命名（如 `feature/x` / `fix-bug-y`）

**ASK FIRST**。即使 agent 認為 branch 很合理，仍須先取得 user 同意。**NEVER** 偷偷建好再說。

## §3 Worktree 命名與位置

### Branch 命名

`session/<YYYY-MM-DD-HHMM>-<slug>`

- 時間戳對齊 [[session-tasks]] 慣例
- `<slug>` 經 `wt-helper` 的 normalization：lowercase、空白與特殊字元轉 `-`、collapse 重複 `-`、trim 首尾 `-`

### 檔案系統位置

`<consumer-parent>/<consumer-name>-wt/<slug>/`，即 `~/offline/<consumer>-wt/<slug>/`。

**Monorepo 子目錄 consumer**：`wt-helper` 走最外層 `.git` 解析 consumer root（例：starter 的 worktree 落在 `~/offline/nuxt-supabase-starter-wt/<slug>/`，**不是** `~/offline/template-wt/<slug>/`）。

## §4 與 propagate 的互動

`scripts/propagate.ts` 的 worktree-aware preflight 偵測 cwd 在非 main worktree 即 exit non-zero — **publish + propagate 必須在 clade 主 worktree 跑**（先 `cd ~/offline/clade`）。理由：跨 worktree 寫投影層在 file watcher / staging 區會撞，refuse-and-guide 比悄悄出錯安全。

`/wt` 建 worktree 時已由 `wt-helper add` 跑 `git merge --ff-only origin/main` 拉最新投影層，一般不需再手動 sync。

## §5 Commit 階段：subagent commit → archive 吸收 → user `/commit`

v3 atomic landing：`/wt` 跑完 subagent 在 worktree commit、worktree+branch **保留**（不 squash 不 cleanup）；`/spectra-archive` Step 0 `wt-helper merge-back` atomic 吸收進 main，user 再在 main 跑 `/commit`。Skill-owned worktree（`/dep-upgrade` 等有清楚完成點）**MUST** 自主 merge-back，不丟回 user。**NEVER** 在 subagent prompt 叫它跑 `/commit` / 在 worktree `git push` / `/wt` 返回時 squash。

> 完整 Codex 派工規約、auto merge-back contract、禁止項詳見 [[worktree-default.commit-ceremony]]（path-scoped：動 `openspec/changes/**` / `HANDOFF.md` / wt-helper 時載入）。

### §5.1 Visibility before landing（hard rule）

User 報告看不到 worktree 改動（「看不到變化」「沒反映」「dev server 沒更新」）時，正確做法是**把 dev server 切到 worktree**，**NEVER** merge-back。

- **MUST**：切 dev server 到 worktree cwd — 走 `dev-session.ts --cwd <worktree-path>` 或等效方式，讓 user 在 worktree 內驗收
- **NEVER**：用 `wt-helper merge-back` / `git merge --squash` / 任何把 worktree 改動帶回 main 的動作來「讓 user 看到」— 那是繞過驗收的捷徑

**話術關鍵詞停手信號**：主線 thinking / tool call description 中出現以下任一詞彙且 worktree 改動尚未經 user 驗收（無 `/spectra-archive` 完成紀錄），**MUST** 立即停手，改走「切 dev server」路徑：

- 中：`合進 main` / `帶回 main` / `merge-back` / `讓你看到` / `讓改動可見`
- En：`merge back` / `squash to main` / `land on main` / `make visible`

**為什麼**：merge-back 是 `/spectra-archive` Step 0 的事（§5），不是「user 有需求」時的快捷鍵。Agent 把「解決 user 眼前不便」偷換成任務目標，繞過驗證流程，是反覆出現的 workflow-discipline 違反模式（pitfall ref: [[pitfall-reflexive-merge-back-before-worktree-verification]]）。

## §5.5 Merge-back ceremony

`wt-helper merge-back <slug>` 是 atomic landing 核心命令。`--auto-stash` 實為 **bulk-stash**（捲走 main **全部** dirty，不只 blockers）→ claim guard 檢查範圍 **MUST ⊇** 全部將被捲走的 dirty，撞別 session 認領 → **fail-loud STOP**。`git stash push` 必 verify create（乾淨 tree 不丟 exception）。

> 完整 flags / claim guard scope / stash reconcile 詳見 [[worktree-default.commit-ceremony]] § Merge-back ceremony。

## §6 操作工具：`/wt`、`wt-helper.ts`、`stash-reconcile.ts`

> 工具速查（list / merge-back / rescue / stash-reconcile）詳見 [[worktree-default.commit-ceremony]] § 操作工具；完整表見 `~/offline/clade/vendor/snippets/wt-helper/README.md`。

## §7 升級路徑與 grandfathered worktree

> 命名不符 `session/*` 的舊 worktree grandfathered；V2→V3 in-flight 處置、legacy stash / HANDOFF drift 詳見 [[worktree-default.troubleshooting]]。

## §8 Stop hook 死鎖 fallback

主線在 main 累積 dirty WIP + Stop hook 攔住 + 還要繼續：剩下可隔離 → `/wt <剩下的事>`；必須 main 直接處理（罕見）→ escalate `/handoff`（Mode A 自動偵測）。**預防**：session 開頭判定要動 code 就 SHOULD 立刻打 `/wt`。

> 詳見 [[worktree-default.troubleshooting]] § Stop hook 死鎖 fallback。

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是**跨所有 worktree 共享的單一 SQLite**。**NEVER** 對它跑 `DELETE` / `UPDATE` / `INSERT`；「main 無 directory + `spectra list` 顯示 active + park/unpark 失敗」**不**等於 zombie（多半別 session 在 sibling worktree 物化）。偵測 zombie 前 **MUST** 先 `git worktree list` + `find` + `mdfind`，看似 zombie 一律 **STOP + AskUserQuestion**。

> 詳見 [[worktree-default.troubleshooting]] § spectra DB 跨 worktree。

## §9.5 Spectra change artifact 必須活在 git

`Agent` tool subagent 的 ephemeral worktree（`.claude/worktrees/agent-*`）session 結束 GC，裡面 `spectra unpark` 的 artifacts 永久遺失。propose 收尾 **commit 進 git**；apply Step 2 unpark 移主線預先做；**NEVER** 假設 subagent cwd = `<consumer>-wt/<slug>/`（派工前 echo cwd 確認）。

> 詳見 [[worktree-default.troubleshooting]] § artifact 活在 git。

### §9.5.1 Phase-tick commit 紀律（TD-216）

worktree subagent 完成每個 tasks.md phase section 的最後一個 `- [ ]` → `- [x]` 後 **MUST** commit tasks.md 到 worktree branch：

```bash
git commit --only -m "📝 docs(spectra): phase N done (<change-name>)" -- openspec/changes/<change-name>/tasks.md
```

type **MUST** 是 `📝 docs`，**NEVER** 是 `📝 spectra` —— 後者不在 conventional type 集合內，帶 emoji 型 `type-enum` 的 consumer（<consumer-b> 等）會在 commit-msg hook 擋下，而報的錯是 `subject may not be empty`，跟真因對不上。

**Why**：`merge-back --squash` 只帶 committed changes 回 main。未 commit 的 checkbox 更新留在 worktree working tree → merge-back 不帶回 → review-gui 讀 main tasks.md 永遠看到 `[ ]` → impl-gate 誤判 <90%。

**NEVER** 只在 worktree working tree 勾 checkbox 而不 commit — 即使「等做完一起 commit」也 **MUST** 至少在 build 結束前批次 commit 一次。

**NEVER** 把 `openspec/changes/<change-name>/tasks.md` 以外的路徑加進這個 commit。契約 SoT 在 [[commit]] § worktree 內唯一合法的 commit：artifact-tick —— 那裡的 `git commit` 禁令對 worktree 內**其他任何**改動仍然成立，本節是它唯一的例外。

## §9.7 Artifact Reading SOP — 讀進度前先查 active worktree

讀 spectra change 進度（`tasks.md` / `openspec/changes/<slug>/` artifacts / WORKTREE-BRIEF.md）時 **MUST** 先查有沒有 active worktree：

```bash
ls ~/offline/<consumer>-wt/<change-slug>/ 2>/dev/null || git worktree list
```

- **有 active worktree** → 讀 worktree 內的 `tasks.md`（working truth）；main 的 `tasks.md` 是 fork-time snapshot，不代表當前進度
- **無 active worktree** → 讀 main（change 尚未 `/wt` 物化，或已 merge-back）

只讀 main 會誤判「還沒開始實作」— 實際可能 worktree 已推進數個 phase。`/handoff` scan、`/spectra-ask` status check、主線 cross-check 都適用本 SOP。

### §9.7.1 main 端出現 tasks.md 改動時，方向由 diff 判，不由本節外推

上一段的「main 的是 fork-time snapshot」管的是**讀**。它**不保證** main 上的改動一定比較舊 —— 有人在 main 補勾 checkbox（因為 worktree 沒依 §9.5.1 commit tasks.md，main 看起來落後）是常態。把它外推成「main 端出現的 tasks.md 改動一律是退化副本」，丟掉的會是**唯一**那份較新的進度。

main 端出現 `openspec/changes/**/tasks.md` 改動時 **MUST** 先量打勾方向：

```bash
git diff -- openspec/changes/<change>/tasks.md | grep -c '^+.*- \[x\]'   # 新增的打勾
git diff -- openspec/changes/<change>/tasks.md | grep -c '^-.*- \[x\]'   # 移除的打勾
```

再依下表處置：

| 可觀察 predicate | 動作 |
| --- | --- |
| 有 active worktree，且 worktree 內 tasks.md 的打勾數 ≥ main 端 | main 這份確實多餘 → 可 stash / 捨棄 |
| 有 active worktree，但 **main 端打勾數較多** | main 這份是唯一記錄 → **NEVER** stash。先帶進 worktree（`git -C <wt> checkout main -- <path>`）再依 §9.5.1 commit |
| 無 active worktree（已 merge-back / 已 archive） | main 就是 working truth → **NEVER** 以「working truth 在 worktree」為由處置 |

**NEVER 只看 `git stash show --stat` 或 `git diff --stat` 判方向** —— `[ ]` → `[x]` 與 `[x]` → `[ ]` 在那裡給出**完全相同**的 insertions / deletions 數字（實證 2026-08-11 <consumer-b>：`21 insertions(+), 21 deletions(-)`，訊息標「退化副本」，實際是多勾了 21 項）。

**NEVER** 因為 stash 訊息自稱那是過期內容就採信 —— 寫那句訊息的 session 依據的正是本節被外推的那句話。詳見 [[pitfall-main-side-tasks-md-tick-stashed-as-stale-copy]]。

## §10 review-gui 與 worktree 互動的已知坑

> 3 條已記坑（home list silent skip / source aggregation collision / apply-pending 按前 spot check）詳見 [[worktree-default.troubleshooting]] § review-gui 坑。改 review-gui.ts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃新版。

## §11 WORKTREE-BRIEF.md — 持久化任務交接上下文

Session worktree 攜帶 `WORKTREE-BRIEF.md`（原始任務 + thin brief + Progress checklist）。cwd 在 session worktree 且 brief 存在時 **MUST** 先讀它再做事。`/wt` 派的 subagent **MUST** 更新 Progress + 完成時改 frontmatter `status`。檔不進 git（已在 per-worktree exclude），**NEVER** `git add` 它、**NEVER** 加進 `.gitignore`。

> 詳見 [[worktree-default.troubleshooting]] § WORKTREE-BRIEF。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（含 Step 0 resume detection、Step 1.5 寫 brief、Form 4 resume）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony
- [[scope-discipline]] — scope 外的工作另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用 `/wt <slug>: /<next-skill>` form
