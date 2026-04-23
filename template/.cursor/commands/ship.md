---
description: 自動發布流程：check → push → PR
---

# /ship — 自動發布

## Pre-flight 檢查

1. 確認目前不在 `main` branch
2. 確認有尚未 push 的 commits
3. 確認工作樹乾淨

任一條件不成立就停止並回報原因。

## Step 1: 品質檢查

```bash
pnpm check
```

失敗時先修復，再重跑到全綠。

## Step 2: Push

```bash
git push -u origin HEAD
```

## Step 3: 建立 PR

使用 `gh pr create`，PR body 至少包含：

- `Summary`
- `Test plan`
- 後續風險或待確認事項（若有）

不要硬編 Claude 專屬 footer；若團隊有自訂 AI 註記格式，再依團隊規範加入。

## Step 4: 報告

回報 PR URL、標題、測試結果與任何殘留風險。
