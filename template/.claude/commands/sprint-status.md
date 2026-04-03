---
description: '顯示當前開發狀態 Dashboard'
---

# /sprint-status — 開發狀態 Dashboard

## Step 1: Branch 概覽

```bash
git branch -a --sort=-committerdate | head -10
git log --oneline -5
```

## Step 2: 未完成工作

```bash
# 未提交的變更
git status --porcelain

# 未 push 的 commits
git log origin/HEAD..HEAD --oneline 2>/dev/null

# Stash
git stash list
```

## Step 3: Spectra 狀態

```bash
# 列出 active changes
ls openspec/changes/ 2>/dev/null
```

如果有 active changes，顯示其 tasks 完成進度。

## Step 4: CI/CD 狀態

```bash
gh run list --limit 3 2>/dev/null
```

## Step 5: 輸出 Dashboard

```
## 📋 Sprint Status

### 🌿 Current Branch: <branch>
- Last commit: <hash> <message>
- Ahead of origin: N commits

### 📝 Working Tree
- Modified: N files
- Untracked: N files
- Stashed: N entries

### 📐 Spectra Changes
- [change-name]: N/M tasks done

### 🚀 CI/CD
- Latest run: ✅/❌ <workflow> (<time>)
```
