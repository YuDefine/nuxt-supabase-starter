<!--
🔒 LOCKED — managed by clade
Source: rules/core/scope-discipline.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Scope discipline 規則——不擴散、必登記、不擅改他人成果，避免 AI 工作流吞掉 WIP 或把範圍外問題靜默遺失
globs: ['openspec/**', 'docs/tech-debt.md', 'docs/decisions/**', 'HANDOFF.md']
---

# Scope Discipline

繁體中文 | [English](./scope-discipline.en.md)

**核心命題**：scope discipline 不是「範圍外就裝沒看到」，而是三件事一起成立：

1. **不擴散**
2. **必登記**
3. **不擅改他人成果**

少任何一項，都會讓 AI 工作流默默吞掉風險、遺失 WIP，或把範圍外問題埋進歷史。

## 正確的 scope discipline

| 要素 | 意思 | 反例 |
| --- | --- | --- |
| **不擴散** | 當前 task 範圍外的檔案 / 模組，不順手改 | 改 A 檔順便重構 B 檔 |
| **必登記** | 途中發現的問題、技術債、改進點一律登記 | 「這不在 scope，先不管」然後永遠消失 |
| **不擅改他人成果** | 看到未知 / 未提交 / 跨 session 變更先問 | `git reset --hard`、`git checkout --` 直接清場 |

## 意外發現的登記路徑（強制）

發現範圍外問題時，**MUST** 選一條路徑登記：

| 發現類型 | 登記位置 | 做法 |
| --- | --- | --- |
| 技術債 / bug / 邊界情況 | `docs/tech-debt.md` | 建 `TD-NNN` entry，並在當前 change `tasks.md` 加 `@followup[TD-NNN]` |
| session 尚未完成的 WIP / blocker | `HANDOFF.md` | 留下目前狀態、阻擋原因、下一步 |
| 未來要做但尚未 propose 的工作 | `openspec/ROADMAP.md` `## Next Moves` | 以 `high/mid/low` + 依賴關係記錄 |
| 當前 change 本身的 scope 漏項 | `spectra-ingest` | 更新 proposal / tasks / design artifact |
| 架構層級決策 | `docs/decisions/YYYY-MM-DD-<topic>.md` | 用 ADR 格式記錄 |

**登記後才能回到當前 task。**

## 未知變更的處理方式

看到以下任一狀態時，視為**未知成果**，必須先回報、再行動：

- `git status` 有你不認得的 modified / untracked 檔案
- 有不屬於當前 scope 的 active change / worktree / stash
- `openspec/changes/<name>/` 裡出現你不清楚來源的 artifact
- **hook / automation 自動產出的 working tree 變動**：
  - pre-commit / post-commit / spectra-archive / sync-vendor 等 hook 自動建立 / 刪除 / 移動的檔案或目錄
  - hook 自動寫入的 annotation（例：`(claude-discussed: ...)`、`(verified-*: ...)`、`@followup[TD-NNN]`）
  - hook 自動觸發的 archive directory（`openspec/changes/archive/YYYY-MM-DD-*/`）
  - hook 自動 propagate 到 spec.md / rule 投影層的內容
  - chmod 設定的 LOCKED projection 改動

正確流程：

1. 列出未知狀態並告知使用者
2. 問清楚是否為其他 session / 使用者 / subagent / hook / automation 的產出
3. 在取得明確指示前，**不清理、不覆寫、不 revert、不還原、不修正**

**自動產出 = 跨 session 成果**：hook / sync-vendor / spectra-archive 等 automation 在 commit / archive / propagate 流程中自動建立的東西，**MUST** 視同其他 session 或使用者本人的 WIP。看到時 **MUST** AskUserQuestion，**禁止**以「這違反 X rule 應該還原」的理由自行處置 — automation 是使用者環境的一部分，行為對錯由使用者判斷，不是當前 session 判斷。

## Rule 衝突解法（preserve > revert）

偵測到「rule A 被 rule B / hook / 其他 session / automation 違反」的當前狀態時（例：`manual-review.md` 規定 `[discuss]` items 應由使用者 walkthrough，但 hook 自動勾 `[x]` + 寫 `(claude-discussed:)` annotation），**MUST** 走以下流程：

1. **保留現狀**（preserve）— **NEVER** 動手「修正」目前狀態以對齊另一條 rule
2. **AskUserQuestion** — 列出觀察、可能成因、可選處理路徑，讓使用者拍板
3. 取得使用者明確指示後才行動

**錯誤的內部反射**：

> 「rule A 規定 X 必須 Y / Y 必須 user walkthrough，但現在狀態是 Z（被 hook 自動做了）— 違反 rule A，應該 revert / 還原 / 對齊」

**這個推理鏈在本 rule 之下是非法的。** Rule 之間衝突時，**保留現狀**是預設，不是「找出哪條優先 + 動手 reconcile」。理由：

- Rule A 與 Rule B 不一定真衝突（rule A 通常是「未來應該怎做」、rule B 是「現有狀態不准擅自動」— 兩者正交）
- 即使真衝突，當前 session 沒有「rule 仲裁權」— 仲裁權在使用者
- 拿 rule A 當理由 revert rule B 的產出，是把限制變武器 — 本 rule 明文禁止

**唯一例外**：使用者在 AskUserQuestion 後明確說「請 revert / 還原 / 對齊 rule A」。

## 破壞性指令的 guardrails

以下指令 **MUST** 先經使用者明確同意，且不得在 subagent 內自主執行：

### Git 命令

- `git reset --hard`
- `git checkout -- <paths>` / `git restore <paths>`
- `git clean -fd` / `git clean -fdx`
- `git revert <commit>`
- `git stash drop` / `git stash clear`

### 檔案系統等效動作（同樣 destructive，但容易誤以為「不是 git 命令所以 OK」）

以下動作**功能上等同破壞性 git 命令**，因此**同樣受本 rule 限制**：

- `mv <git-tracked-path> <elsewhere>` / `mv <elsewhere> <git-tracked-path>` — 把 hook 自動建立的 archive directory 搬回原位（等同 revert hook 工作）；把目錄反向搬等同 `git checkout --` 對 directory layout 操作
- `rm -rf <openspec/changes/**>` / `rm -rf <openspec/changes/archive/**>` / `rm -rf <screenshots/**>` 等批次刪除 user-authored 或 hook-authored 內容
- `cp --remove-destination` / `cp -f <source> <git-tracked-path>` — 覆蓋掉現有 working tree 內容
- `sed -i` / `awk -i inplace` / `perl -i` 等 in-place 文字替換在 git-tracked 檔案上**無 explicit Edit/Write tool 走的修改**
- 用 `echo > <git-tracked-path>` / `cat > <git-tracked-path>` / `tee <git-tracked-path>` 等覆蓋 git-tracked 檔案內容
- 任何 shell script / Python script 中包含上述動作的批次操作

### 總原則

**任何讓 working tree / git index 從現狀（含 hook 自動產出、其他 session WIP、第三方 automation 結果）回到「先前狀態」、「乾淨狀態」、「對齊 rule X 的狀態」的動作**，不論使用 git、shell、檔案系統、editor in-place 寫入、subprocess script — 都列為破壞性指令，**MUST** 先 AskUserQuestion。

判別測試（self-check）：

- 「這個動作執行後，是否會讓某個檔案 / 目錄消失、被覆蓋、被移到別處？」 → 是 → 破壞性
- 「執行後 user 想 undo，是否容易（git stash pop 可恢復 / 該檔在 git history 內）？」 → 否（檔案是 untracked / 已被 mv 走 / 已被 in-place 覆蓋）→ 高破壞性，絕對停手

## 話術關鍵詞 = 立即停手訊號

當前 session 的 chat 輸出、內部 thinking、tool call description 中出現以下任一**話術關鍵詞**時，**MUST** 立即停手：

### 關鍵詞清單

中文：
`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `先還原再...` / `先 revert 再...` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y`

English：
`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

### 停手定義

「停手」意指：

1. **NEVER** 下任何破壞性指令（含 git、shell、檔案系統、script）— **包含 dry run**
2. **NEVER** 在 chat 中向使用者建議 / 暗示這些動作
3. **MUST** 立即用 `AskUserQuestion` 給使用者看：當前狀態 / 觀察到的衝突 / 可能成因 / 兩個以上選項（含「保留現狀不動」）
4. 取得使用者明確指示後才繼續

### 為什麼是「話術 = 思考表徵」

關鍵詞出現代表 Claude 內部已經把「現狀 → 應該還原」的推理鏈走完一半 — **這個推理鏈本身是錯**（見上「Rule 衝突解法」）。攔住話術 = 攔住錯誤推理鏈。

**特別注意**：把破壞性動作包裝成「**清理**」「**重置**」「**回到乾淨狀態**」「**對齊規約**」「**修正一下**」等委婉說法繞過本節，**同樣違反本 rule**。委婉說法仍是話術關鍵詞，仍觸發停手訊號。

## Subagent brief 最低要求

委派 subagent 時，scope discipline 段落至少要包含：

```markdown
## Scope Discipline

- 範圍外檔案不要順手改
- 意外發現其他問題：不修，但必登記
- 看到不認識的 uncommitted 變更 / hook 自動產出 / archive directory：停下並回報
- 禁止跑 git reset / git checkout -- / git restore / git clean / git revert
- 禁止用 mv / rm -rf / cp -f / sed -i / 覆蓋 redirect 反向 hook 工作或丟棄 working tree 內容
- 看到 rule A 被 rule B / hook 違反：保留現狀 + AskUserQuestion，不准自行對齊
- 話術出現 revert / 還原 / 清掉 / 重置 / undo / rollback 等關鍵詞：立即停手 + AskUserQuestion
```

## 與其他規則的關係

- `follow-up-register.md`：提供技術債登記與 archive gate
- `handoff.md`：提供跨 session 交接出口
- `knowledge-and-decisions.md`：提供長期知識與 ADR 出口
- `ux-completeness.md`：補上「發現未登記 = 未完成」的完成度觀點

## 禁止事項

- **NEVER** 把「超出 scope」當成忽略發現的理由
- **NEVER** 把未知變更當作「上次沒清乾淨」直接清掉
- **NEVER** 在 subagent 內執行 `git reset` / `git checkout --` / `git restore` / `git clean` / `git revert`
- **NEVER** 用 `mv` / `rm -rf` / `cp -f` / `sed -i` / `echo >` / `tee` 等檔案系統等效動作反向 hook 工作、刪除 archive directory、覆蓋 working tree 內容（同樣受破壞性指令 guardrails 限制）
- **NEVER** 看到 hook / automation 自動產出時，自行判定「該保留 / 該還原 / 該修正」— **MUST** AskUserQuestion
- **NEVER** 拿 rule A 當理由 revert rule B 的產出（含 hook 自動產出）— rule 衝突一律保留現狀 + AskUserQuestion
- **NEVER** 在 chat / thinking / tool call description 中出現 `revert` / `還原` / `清掉` / `重置` / `undo` / `rollback` / 「對齊規約」「修正狀態」等話術關鍵詞後繼續動手 — 話術 = 停手訊號
- **NEVER** 把破壞性動作包裝成「清理」「重置」「回到乾淨狀態」「對齊規約」「修正一下」等委婉說法繞過上述禁令
- **NEVER** 寫只有「不擴散」沒有「必登記」的 brief
