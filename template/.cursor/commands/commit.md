---
description: 依功能分組變更並逐步完成 commit，遵循專案品質閘門
---

## User Input

```text
$ARGUMENTS
```

政策、禁止事項、commit 類型表見 `.cursor/rules/commit.mdc`。

## Step 0: 品質閘門

1. 先派 `code-review` subagent 做 readonly review；所有 Must Fix 先修完
2. 若變更涉及明顯 UI 畫面，派 `screenshot-review` 做截圖驗證
3. 執行：

```bash
pnpm check
```

失敗就進入 fix-verify loop，直到全綠。

## Step 1: Schema 同步檢查

若 `app/types/database.types.ts` 有變更，執行：

```bash
pnpm db:reset
pnpm db:types
git diff -- app/types/database.types.ts
```

若 types 與 migration 不一致，停止 commit 並先修正。

## Step 2: 盤點變更

```bash
git status
git diff --stat
```

若 `.gitignore` 有變更，先還原，不要納入 commit。

## Step 3: 分組

依功能或目的分組，逐組列出：

```text
### Group 1: 功能描述
類型: ✨ feat
檔案:
- path/to/file.ts
```

## Step 4: 逐組 commit

對每一組執行：

```bash
git add <files>
git commit -m "✨ feat: 功能描述"
git log -1 --oneline
```

不要自動加入 Claude 專屬 co-author footer；若團隊另有 AI footer 規範，再依團隊格式補上。

## Step 5: deploy commit

判斷版本升級類型：

- 有 `✨ feat` → `pnpm version minor --no-git-tag-version`
- 只有修復或維護 → `pnpm version patch --no-git-tag-version`

之後建立 deploy commit 並執行：

```bash
pnpm tag
```

## Step 6: 完成報告

回報：

- 建立了幾個 commit
- 版本號如何變更
- tag 是否已建立
- 是否需要更新 `template/HANDOFF.md`
