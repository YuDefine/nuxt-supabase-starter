---
description: 依功能分類變更並逐步完成 commit，遵循 commitlint 規範
---

## User Input

```text
$ARGUMENTS
```

## Commit 類型規範

依照 commitlint.config.js，使用以下格式：

| Emoji | Type     | 用途     |
| ----- | -------- | -------- |
| ✨    | feat     | 新功能   |
| 🐛    | fix      | Bug 修復 |
| 🧹    | chore    | 維護工作 |
| 🔨    | refactor | 重構     |
| 🧪    | test     | 測試     |
| 🎨    | style    | 樣式調整 |
| 📝    | docs     | 文件     |
| 📦    | build    | 建置系統 |
| 👷    | ci       | CI/CD    |
| ⏪    | revert   | 還原     |
| 🚀    | deploy   | 部署     |
| 🎉    | init     | 初始化   |

## Outline

### Step 0: 品質檢查

#### 0-A. 程式碼審查 — MANDATORY, NEVER SKIP

**此步驟為強制執行，不論變更量大小、時間壓力或任何理由，都不得跳過。**
**違反此規則等同於跳過整個品質檢查流程。**

依序執行以下審查（每個都必須完成，不可合併或省略）：

1. **`/simplify`** — 審查重用性、品質與效率
   - 執行方式：呼叫 simplify skill，傳入變更檔案清單
   - 完成條件：skill 回報結果且所有發現的問題已修正

2. **`/code-review:code-review`** — 審查邏輯與安全性
   - 執行方式：使用 code-review agent（`subagent_type: code-review`）
   - 完成條件：agent 回報結果且所有 Critical/Major 問題已修正

**執行規則：**

- 審查可以平行啟動（用 background agents），但必須等所有結果回來
- **所有發現的問題都必須修正後才能繼續**
- 不可以「不在本次範圍」「建議性質」「變更量太大」「效率考量」為由跳過任何一個審查
- 每個審查完成後，明確輸出 `✅ 0-A-1 simplify 通過` / `✅ 0-A-2 code-review 通過`
- **所有 ✅ 都出現後才能進入下一步**

#### 0-B. CI 等效檢查（Fix-Verify Loop）

執行與 CI 完全相同的檢查命令：

```bash
pnpm check
```

此命令依序執行 format → lint → typecheck → test，與 CI pipeline 完全一致。

**如果失敗，進入 Fix-Verify Loop：**

1. **修復錯誤** — 根據錯誤訊息修正程式碼
2. **重新格式化** — 每次修改程式碼後，先執行 `vp fmt` 再重新檢查（程式碼修改會引入新的 format 問題）
3. **重新執行 `pnpm check`** — 確認所有錯誤歸零
4. **重複直到通過** — 0 errors + 0 warnings 才算通過

```
pnpm check → 失敗 → 修復 → vp fmt → pnpm check → ... → 通過 → 繼續
```

**重要：**

- **禁止跳過任何錯誤**，即使認為是「來自 worktree」或「不影響」也不行
- **禁止用個別工具替代** `pnpm check`（如 `npx vitest run`、`npx eslint`）
- 如果 `.claude/worktrees/` 目錄干擾檢查結果，先清理 worktrees 再跑檢查
- **未通過 `pnpm check` 之前，絕對不進入 Step 1**

### Step 1: 資料庫 Schema 同步檢查（條件觸發）

檢查 `database.types.ts` 是否有變更：

```bash
git diff --name-only | grep -q "database.types.ts" && echo "HAS_TYPES_CHANGE=true" || echo "HAS_TYPES_CHANGE=false"
```

**如果 `database.types.ts` 有變更，執行以下驗證：**

1. **重置 DB 並重新產生 types**（確保 types 來自 migration）：

   ```bash
   supabase db reset
   supabase gen types typescript --local > /tmp/types-from-migration.ts
   ```

2. **比對 types 檔案**：

   ```bash
   diff app/types/database.types.ts /tmp/types-from-migration.ts
   ```

3. **結果判斷**：
   - ✅ **無差異** → 繼續 commit 流程
   - ❌ **有差異** → **停止 commit！** 顯示以下訊息：

   ```text
   ⛔ Schema 不同步！

   database.types.ts 的內容與 migration 檔案不一致。
   這通常表示有人直接修改了 local DB（透過 MCP 或手動 SQL）但沒有建立 migration。

   請執行以下步驟修復：
   1. 確認需要的 schema 變更
   2. 建立正確的 migration 檔案
   3. 重新執行 /commit
   ```

### Step 2: 檢查變更狀態

```bash
git status
git diff --stat
```

列出所有變更的檔案，並依功能分組。

**重要規則：**

- 若有 `.gitignore` 的變更，先執行 `git checkout .gitignore` 還原
- **除了 `.gitignore` 之外，所有變更都必須納入 commit，禁止自行判斷跳過任何檔案**

### Step 3: 分析變更並分組

將變更依照功能/目的分組：

```text
## 變更分組

### Group 1: [功能描述]
類型: ✨ feat / 🐛 fix / ...
檔案:
- path/to/file1.ts
- path/to/file2.vue

### Group 2: [功能描述]
類型: ...
檔案:
- ...
```

### Step 4: 確認分組

向使用者確認分組是否合適，是否需要調整。

### Step 5: 逐一執行 Commit

對每個分組：

1. Stage 該組的檔案：

   ```bash
   git add <files>
   ```

2. **建立 commit 許可 marker**（pre-commit hook 會檢查此檔案，沒有會被阻擋）：

   ```bash
   openssl rand -hex 16 > .claude/.commit-approved
   ```

3. 執行 commit（使用 HEREDOC 確保格式正確）：

   ```bash
   git commit -m "$(cat <<'EOF'
   ✨ feat: 功能描述

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

4. 確認 commit 成功：
   ```bash
   git log -1 --oneline
   ```

### Step 6: 版本號更新與 Deploy Commit

所有功能 commit 完成後，自動更新版本號：

1. **判斷版本升級類型**：
   - 如果本次 commit 包含 `✨ feat` → **minor** 升級（x.Y.z → x.Y+1.0）
   - 如果只有 `🐛 fix` 或其他類型 → **patch** 升級（x.y.Z → x.y.Z+1）

2. **更新 package.json 版本號**：

   ```bash
   # minor 升級
   pnpm version minor --no-git-tag-version

   # 或 patch 升級
   pnpm version patch --no-git-tag-version
   ```

3. **建立 deploy commit**：

   根據本次所有 commit 的內容，摘要異動重點：

   ```bash
   git add package.json
   openssl rand -hex 16 > .claude/.commit-approved
   git commit -m "$(cat <<'EOF'
   🚀 deploy: 發布新版本 v{新版本號}

   - 功能描述一
   - 功能描述二
   - ...

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

4. **建立 git tag 並推送**：

   ```bash
   pnpm tag
   ```

   此命令會建立 `v{版本號}` tag 並推送到 origin。

### Step 7: 完成報告

```text
✅ Commit 完成！

共建立 N 個 commit：

1. abc1234 ✨ feat: 新增某功能
2. def5678 🐛 fix: 修正某問題
3. ghi9012 🚀 deploy: 發布新版本 v1.8.0

版本：1.7.1 → 1.8.0 (minor)
Tag：v1.8.0 已建立並推送

執行 `git log --oneline -N` 查看完整記錄。
```

## 核心原則

**這是一個處理所有 uncommitted 檔案的通用指令。** 執行時必須：

- **修正所有發現的問題** — review、lint、typecheck、test 發現的任何問題都必須修正，不可以「不在本次範圍」、「建議性質」、「影響不大」為由跳過
- **納入所有變更** — 除了 `.gitignore` 之外，所有 uncommitted 檔案都必須 commit，不得自行跳過

## 注意事項

- 每個 commit 應該是獨立且完整的變更
- 不要把不相關的變更混在同一個 commit
- Commit message 使用繁體中文描述
- `.gitignore` 檔案的變更不應該 commit，若發現有變更應先還原
- **除了 `.gitignore` 之外，所有變更都必須 commit，不得自行跳過**
- 如果有 .env 或敏感檔案，僅需警告使用者，但仍應詢問是否要 commit
- 遵循 CLAUDE.md 的 Git 規範
