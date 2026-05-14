<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# Commit

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 理由

`/commit` 封裝了品質閘門，繞過等於讓壞 code / 壞版本號 / 壞 tag 進 repo：

- **0-A** `codex review --uncommitted`（GPT 5.5，最多 2 輪 review-fix loop：Round 1 = `high`、Round 2 = `xhigh`）— 重用性、品質、邏輯、安全；review 由 codex 執行，修正由 Claude Code 主線執行
- **0-B** UI Design Review（條件觸發）— 含 `.vue` 模板變動 + 屬於頁面/元件/佈局/互動/樣式變更時派 screenshot-review agent
- **0-C** **format / lint / typecheck / test 全綠**：跑 `pnpm check`（多數專案含 format/lint/typecheck）**並且**確認 test 也有跑。**若 `package.json` 的 `scripts.check` 不含 `test` / `vitest`，必須額外跑 `pnpm test`（或 `vp test run` / `pnpm test:unit`），否則 CI 抓到的測試失敗（hook timeout、flake、新增測試壞掉）會在 commit 後才暴露**

**並行執行**：0-A.0 simplify 序跑完後，**0-A.1（codex high 背景）/ 0-B（screenshot subagent）/ 0-C（主線 foreground check）三軸 MUST 並行**——序跑會浪費 5–10 分鐘閘門時間。`codex review --uncommitted` 啟動時讀 working tree snapshot，後續變動不影響它正在進行的 review，所以三軸並行安全。詳細啟動順序與大改動 fallback 見 `.claude/commands/commit.md` 的「0-A/B/C 並行策略」。
- **Step 1** Schema 同步檢查 — `database.types.ts` 與 migration 對齊
- **Step 5** 版本號升級 + tag push — `feat` → minor、其他 → patch

這些檢查**無法事後補跑**：漏跑的 commit 已經在 history 裡，壞版本號已經 push 出去。

## Single Session Lock

**同時只能有一個 session 跑 `/commit`**。由 `.claude/scripts/commit-lock.mjs` 實作，鎖檔 `.claude/.commit.lock`（已 gitignored）：

- Command 流程 **Step 0-Lock** 必跑 `node .claude/scripts/commit-lock.mjs acquire`；若失敗（另一 session 佔用）→ **停下**回報使用者，不自行 `rm` 清鎖
- **Final Step** 必跑 `release`；即便中間失敗、使用者中止，也要釋放，**NEVER** 讓鎖長期遺留
- Stale 閾值預設 30 分鐘（`COMMIT_LOCK_STALE_MINUTES` 可調），超過即自動清除

**理由**：commit 流程同時跑兩次會撞 staging、品質檢查互踩、版本號升級競態、tag push 衝突；一次抓牢節省整體 token。

## WIP 預設範圍

**預設所有 `git status` 顯示的 uncommitted 變更都納入本次 `/commit`**，照常跑 review（0-A）並在分組階段依功能拆成獨立 commit。**這是無條件預設，不需要徵詢使用者。**

- **看到不認得的變更**：直接納入分組流程。**NEVER** 為了「決定要不要納入」而向使用者徵詢；分組是 Step 3 的工作，不是 Step 0 的判斷題
- **排除條件（唯一）**：使用者在 `$ARGUMENTS` 中**明確**指名排除（例如「排除 .env.local」「只 commit app/」）。其他任何情境一律全包
- **NEVER** 以「這個不在我 scope」「看起來是別的 session 做的」「不確定是否該 commit」自行排除或徵詢使用者意見 — 先假設是使用者並行工作 + 一律保留並走分組流程

**理由**：品質閘門成本高，把 WIP 分次 commit 等於多跑一次閘門，浪費時間與 token。`/commit` 的分組階段就是設計來把「主線工作 + 並行 WIP」自然分類到不同 commit group。

## WIP 阻礙處理（**極少數例外**，預設一律靠分組納入）

**預設一律靠 Step 3 分組納入處理 WIP**，stash 是**極少數例外**。「主題不同 / 看起來不相關 / 不認得來源」**全部**透過拆獨立 commit group 解決，**NEVER** 因此啟動 stash —— Step 3 分組就是設計來把多主題、跨 session 的 WIP 自然拆成多個 commit group 的。

**下列情境不是阻礙，不能啟動 stash 流程**：

- 「這些變更跟本次主題不一樣」→ 拆成另一個 commit group（feat / fix / chore / refactor / docs 各自獨立 group）
- 「不認得這些變更來自哪」→ 假設是並行 session 的工作，照常納入分組
- 「想讓本次 commit 主題乾淨」→ commit 不需要乾淨，每個 group 內部完整即可
- 「這個檔案跟我手上工作無關」→ 不關你的事，納入分組

**stash 觸發條件（嚴格收斂為下列任一，且使用者明確要求視為涵蓋）**：

1. **品質閘門卡死且短時間修不好** — 壞掉的實驗碼讓 0-A / 0-B / 0-C 持續紅燈，且修復成本明顯超過本次 commit 範圍
2. **明確不該入庫的殘留** — debug print、暫時 `console.log`、假資料、敏感資訊（且使用者尚未確認要保留）
3. **使用者主動在 `$ARGUMENTS` 指名要 stash** 某些檔案 / 變更

確認觸發後（且優先 **stash 該檔本身**，而非整批 stash）：

```bash
git stash push -u -- <具體檔案路徑>          # 優先：只 stash 阻礙檔
# 確實必要時才整批：
git stash push -u -m "WIP: <簡述為何 stash> — see HANDOFF.md"
```

接著**MUST**在 `HANDOFF.md` 的 `In Progress` 或 `Next Steps` 區塊寫入：

- stash 訊息（讓人能用 `git stash list` 對應）
- 為何 stash（哪個檔、為何不能納入本次 commit；對齊上面 1/2/3 哪一條）
- 接手指引（要怎麼 `git stash pop` / 該如何收尾）

寫完 HANDOFF 後再繼續 `/commit` 的後續流程。

**理由**：

- 多主題 WIP 用分組就能乾淨入庫，stash 只會把工作往後推，違反「不要把工作往後放」原則。
- stash 仍保留變更可恢復、handoff 留下 paper trail，等同「延後處理」而非「丟棄」；但分組納入比 stash 更直接、更省下次 `/commit` 的閘門成本。
- 任何形式的 `git restore` / `git checkout --` / `git reset` / `git revert` 都會**永久毀掉使用者的 WIP**，這是不可接受的成本（見下節嚴格禁令）。

## 禁止事項

- **NEVER** `git commit` / `git commit -m` — 繞過 0-A / 0-B / 0-C 品質閘門
- **NEVER** `git commit --amend` 修改已 push 的 commit — 會破壞遠端 history
- **NEVER** `git commit --no-verify` — 繞過 pre-commit hook
- **NEVER** 以「變更很小」「只是 typo」「趕時間」為由跳過 `/commit`
- **NEVER** 讓 subagent 自主執行 `git commit` — commit **必須在主線執行**；使用者觸發 `/commit` 即代表授權整批分組，主線**不需**在分組後另行徵詢確認（policy 與 `/commit` Step 0-Scope 一致：commit 流程預設無互動）
- **NEVER** 在 lock 被佔用時自行 `rm .claude/.commit.lock` — 必須回報使用者由其判斷對方是否真的卡住
- **NEVER** 漏跑 Final Step `release` — 即使前面失敗也要釋放，避免下次 session 卡在 stale lock
- **NEVER** 把 `pnpm check` 當作完整 0-C；**MUST** 先 grep 確認 `scripts.check` 含 `test` / `vitest`，不含就額外跑 `pnpm test`。許多 consumer 的 `pnpm check` 只跑 format/lint/typecheck（CI 才跑完整 test），漏跑會讓 hook timeout / flake / 新增測試破壞在 commit 後才暴露

### WIP 處置禁令（嚴格）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

#### Git 命令禁令

- **NEVER** 執行 `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>` 清場 — 這會永久毀掉 unstaged 變更
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash drop` / `git stash clear`
- **NEVER** 提議 `git revert` 或在輸出中暗示「可以 revert XX」「要不要還原 XX」「這部分先 revert」 — `revert` 在使用者語境通常意指**丟棄變更**，會誤導使用者破壞 WIP；真正需要還原既有 commit 的情境極罕見且應由使用者主動發起

#### 檔案系統等效動作禁令（同樣 destructive）

以下動作功能上等同破壞性 git 命令，**MUST** 視同 WIP 處置禁令範圍（容易誤以為「不是 git 所以 OK」）：

- **NEVER** `mv <git-tracked-path> <elsewhere>` / `mv <elsewhere> <git-tracked-path>` 反向 hook 工作（例：把 `openspec/changes/archive/2026-MM-DD-*/` 搬回 `openspec/changes/*/`、把 `screenshots/<env>/_archive/*` 搬回頂層）
- **NEVER** `rm -rf <openspec/changes/**>` / `rm -rf <screenshots/**>` 等批次刪除含 user-authored / hook-authored 內容的目錄
- **NEVER** `cp --remove-destination` / `cp -f` 覆蓋 git-tracked 檔案
- **NEVER** `sed -i` / `awk -i inplace` / `perl -i` 在 git-tracked 檔案上 in-place 寫入而**沒走 Edit/Write tool**（無 user 看得到的 diff）
- **NEVER** `echo > <git-tracked-path>` / `cat > <git-tracked-path>` / `tee` 覆蓋 git-tracked 檔案內容
- **NEVER** 用 shell script / subprocess 包裝上述動作試圖繞過 tool-level 觀察

#### 推理層禁令

- **NEVER** 以「這變更看起來壞掉了 / 不該存在 / 不在 scope，是否要還原？」徵詢使用者 — 唯一允許的選項是 `git stash` + `HANDOFF.md`，照「WIP 阻礙處理」流程走
- **NEVER** 把「revert / restore / discard」包裝成「清理」「重置」「回到乾淨狀態」「對齊規約」「修正狀態」等委婉說法繞過上述禁令
- **NEVER** 拿其他 rule（例 manual-review.md `[discuss]` 應 user walkthrough）當理由還原 hook 自動產出 — rule 衝突一律保留現狀 + AskUserQuestion（詳見 `scope-discipline.md`「Rule 衝突解法」）
- **NEVER** 看到 hook 自動 archive directory / spec 自動 propagate / annotation 自動寫入時，自行判定「應該還原」— 自動產出 = 跨 session 成果，必先 AskUserQuestion

#### 話術關鍵詞 = 立即停手訊號

chat / thinking / tool call description 中出現以下任一關鍵詞，**MUST** 立即停手（不下任何命令，AskUserQuestion 給使用者拍板）：

中：`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y` / `先還原再 …`

En：`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

詳細停手定義 + 為什麼話術即訊號，見 `scope-discipline.md`「話術關鍵詞 = 立即停手訊號」。

#### 唯一例外

使用者在 `$ARGUMENTS` 中**明確、主動、白紙黑字**寫出 `git restore` / `git checkout --` / `mv <具體路徑> <具體路徑>` / `rm -rf <具體路徑>` / `revert <具體 commit>` 等指令或具體變更名稱，且語意無歧義時才能執行。**NEVER** 從「不在 scope」「看起來壞掉」「違反 X rule」等模糊語氣自行解讀為「使用者想丟棄」。

## 例外（極少）

以下情境允許直接 `git commit`，**MUST** 在 commit message 註明理由：

1. **`/commit` 本身壞掉** — command 檔被改壞、依賴的 agent 不可用時的救火
2. **Merge commit / rebase resolution** — `git merge` / `git rebase --continue` 的自動 commit
3. **`git revert` 既有 commit** — 還原已 push 的 commit，無需重跑品質檢查。**注意**：此例外**僅**適用於使用者**主動**指明要 revert 哪個 commit（例如 `git revert abc1234`）的情境；**NEVER** 主線自行提議 revert，也**NEVER** 用 `git revert` 處理 uncommitted WIP（uncommitted 變更的處置一律走「WIP 阻礙處理」的 stash + handoff）

例外情境外，一律走 `/commit`。

## Commit 分組與訊息規範

- **每個 commit 獨立且完整** — 不相關的變更**MUST**分到不同 commit
- **Commit message 使用繁體中文**描述
- **所有 uncommitted 變更都必須入庫**，**NEVER** 以「不在本次範圍」「影響不大」為由跳過任何檔案
- **`.gitignore` 變更**：只允許保留 Clade 管理的 installation artifact / runtime state ignore 條目（例如 `.claude/.commit.lock`、`codex/`）；其他變更**MUST** `git stash push -- .gitignore` 並寫入 `HANDOFF.md`（**NEVER** `git checkout .gitignore` 直接還原），由使用者後續確認是否要保留
- **`.env` / 敏感檔案**：警告使用者但仍由使用者決定是否 commit，**NEVER** 自行跳過
- **修正所有發現的問題**：review / lint / typecheck / test 發現的問題都**MUST**修正，**NEVER** 以「建議性質」「不在本次範圍」為由跳過

## Commit 類型（commitlint.config.js）

| Emoji | Type     | 用途     |
| ----- | -------- | -------- |
| ✨    | feat     | 新功能   |
| 🐛    | fix      | Bug 修復 |
| 🧹    | chore    | 維護     |
| 🔨    | refactor | 重構     |
| 🧪    | test     | 測試     |
| 🎨    | style    | 樣式     |
| 📝    | docs     | 文件     |
| 📦    | build    | 建置     |
| 👷    | ci       | CI/CD    |
| ⏪    | revert   | 還原     |
| 🚀    | deploy   | 部署     |
| 🎉    | init     | 初始化   |

## 搭配

- Command 本體：`.claude/commands/commit.md` — 定義「怎麼做」（procedure）
- 本規則：定義「要不要做」— 政策、閘門、強制入口

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
