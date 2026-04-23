---
description: 'Sprint 回顧 — 分析最近的開發指標'
---

# /retro — Sprint 回顧

## Step 1: 收集指標

```bash
# 最近 commits（自上次 tag 或最近 7 天）
git log --since="7 days ago" --oneline --stat

# 變更統計
git diff --stat $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD
```

收集：

- Commit 數量
- 檔案變更數
- 新增/刪除行數
- PR 數量（`gh pr list --state merged --search "merged:>=$(date -v-7d +%Y-%m-%d)"` 或同等）

## Step 2: 品質評分（0-10）

| 維度          | 評估方式                      |
| ------------- | ----------------------------- |
| Velocity      | Commits/天、feature 完成率    |
| Quality       | Test 覆蓋率、bug 修復比例     |
| Test Coverage | 新 feature 是否有配對測試     |
| Code Health   | Refactor 比例、tech debt 處理 |

## Step 3: Hotspot 分析

找出最常被修改的檔案（可能需要重構）：

```bash
git log --since="7 days ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -10
```

## Step 4: 報告

```
## Sprint Retro — [日期範圍]

### 📊 指標
- Commits: N
- Files changed: N
- Lines: +N / -N

### 📈 評分
| 維度 | 分數 | 備註 |
|------|------|------|

### 🔥 Hotspots
1. path/to/file (N changes)
2. ...

### 💡 建議
- [改善建議]
```
