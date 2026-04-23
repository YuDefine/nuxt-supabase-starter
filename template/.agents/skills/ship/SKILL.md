---
description: '自動發布流程：check → push → PR'
---

# /ship — 自動發布

## Pre-flight 檢查

1. 確認不在 `main` branch（`git branch --show-current`）
2. 確認有未 push 的 commits（`git log origin/HEAD..HEAD --oneline`）
3. 確認沒有未提交的變更（`git status --porcelain`）

如果任何檢查失敗，告知使用者並停止。

## Step 1: 品質檢查

```bash
pnpm check
```

如果失敗：

1. 嘗試自動修復（format/lint auto-fix）
2. 重新執行 `pnpm check`
3. 如果仍然失敗 → 報告錯誤並停止

## Step 2: Push

```bash
git push -u origin HEAD
```

## Step 3: 建立 PR

使用 `gh pr create`：

- Title: 從 commits 摘要生成（簡潔、< 70 字元）
- Body: 包含 Summary、Test Plan、Co-Authored-By

格式：

```bash
gh pr create --title "PR title" --body "$(cat <<'EOF'
## Summary
- bullet points

## Test plan
- [ ] checklist

🤖 Generated with [AI Agent](https://github.com)
EOF
)"
```

## Step 4: 報告

輸出 PR URL 和摘要。
