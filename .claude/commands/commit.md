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

依序執行以下三步驟：

1. 使用 `/simplify` skill 審查變更程式碼的重用性、品質與效率，發現問題立即修正
2. 使用 `/code-review:code-review` skill 審查邏輯與安全性，發現問題立即修正
3. 使用 `check-runner` agent 執行完整的程式碼檢查（format → lint → typecheck → test）

**任一步驟未通過，停止 commit 流程，先修復錯誤。**

### Step 1: 檢查變更狀態

```bash
git status
git diff --stat
```

列出所有變更的檔案，並依功能分組。

**重要規則：**

- 若有 `.gitignore` 的變更，先執行 `git checkout .gitignore` 還原
- **除了 `.gitignore` 之外，所有變更都必須納入 commit，禁止自行判斷跳過任何檔案**

### Step 2: 分析變更並分組

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

### Step 3: 確認分組

向使用者確認分組是否合適，是否需要調整。

### Step 4: 逐一執行 Commit

對每個分組：

1. Stage 該組的檔案：

   ```bash
   git add <files>
   ```

2. 執行 commit（使用 HEREDOC 確保格式正確）：

   ```bash
   git commit -m "$(cat <<'EOF'
   ✨ feat: 功能描述

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

3. 確認 commit 成功：
   ```bash
   git log -1 --oneline
   ```

### Step 5: 版本號更新與 Deploy Commit

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

### Step 6: 完成報告

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

## 注意事項

- 每個 commit 應該是獨立且完整的變更
- 不要把不相關的變更混在同一個 commit
- Commit message 使用繁體中文描述
- `.gitignore` 檔案的變更不應該 commit，若發現有變更應先還原
- **除了 `.gitignore` 之外，所有變更都必須 commit，不得自行跳過**
- 如果有 .env 或敏感檔案，僅需警告使用者，但仍應詢問是否要 commit
- 遵循 CLAUDE.md 的 Git 規範
