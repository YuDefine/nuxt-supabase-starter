---
description: 依功能分類變更並逐步完成 commit，遵循 commitlint 規範
---

## User Input

```text
$ARGUMENTS
```

政策、禁止事項、commit 類型表見 `.claude/rules/commit.md`。本檔只定義執行流程。

## Step 0: 品質檢查

### 0-A. 程式碼審查（平行）

**在同一訊息內**平行派兩個 subagent，等兩者都回報：

1. **general-purpose agent** — 於 agent 內透過 Skill tool 呼叫 `simplify` skill，審查重用性、品質、效率
2. **code-review agent**（`agent_type: code-review`）— 審查邏輯與安全

**所有回報的問題必須修正**。完成後明確輸出：

```text
✅ 0-A-1 simplify 通過
✅ 0-A-2 code-review 通過
```

兩個 ✅ 都出現才進入 0-B。

### 0-B. CI 等效檢查（Fix-Verify Loop）

```bash
pnpm check
```

失敗時進入 loop：修復 → `vp fmt` → `pnpm check` → 重複直到 0 errors + 0 warnings。

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check`。若 `.claude/worktrees/` 干擾結果，先清理再跑。

通過後輸出 `✅ 0-B 通過`。

## Step 1: Schema 同步檢查（條件觸發）

```bash
git diff --name-only | grep -q "database.types.ts" && echo HAS || echo NO
```

若 `database.types.ts` 有變更：

```bash
supabase db reset
supabase gen types typescript --local > /tmp/types-from-migration.ts
diff app/types/database.types.ts /tmp/types-from-migration.ts
```

有差異 → **停止 commit**，提示使用者建立對應 migration。

> 若專案改用遠端 LXC Supabase，將上述指令改為 `pnpm db:reset` / `pnpm db:types`（見 `.claude/rules/migration.md`）

## Step 2: 檢查變更狀態

```bash
git status
git diff --stat
```

若 `.gitignore` 有變更 → `git checkout .gitignore` 還原。

## Step 3: 分析變更並分組

依功能/目的分組，輸出給使用者確認：

```text
### Group 1: [功能描述]
類型: ✨ feat
檔案:
- path/to/file.ts
```

## Step 4: 確認分組

向使用者確認分組是否合適。

## Step 5: 逐一執行 Commit

對每個分組：

```bash
git add <files>
git commit -m "$(cat <<'EOF'
✨ feat: 功能描述

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git log -1 --oneline
```

## Step 6: 版本號升級與 Deploy Commit

判斷升級類型：

- 包含 `✨ feat` → `pnpm version minor --no-git-tag-version`
- 只有 `🐛 fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git add package.json
git commit -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
pnpm tag
```

`pnpm tag` 會建立 `v{版本號}` tag 並推送到 origin。

## Step 7: 完成報告

```text
✅ Commit 完成！

共建立 N 個 commit：
1. abc1234 ✨ feat: ...
2. def5678 🐛 fix: ...
3. ghi9012 🚀 deploy: 發布新版本 v1.8.0

版本：1.7.1 → 1.8.0 (minor)
Tag：v1.8.0 已建立並推送
```
