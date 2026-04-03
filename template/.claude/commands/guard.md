---
description: '顯示和管理安全護欄'
---

# /guard — 安全護欄 Dashboard

## 顯示內容

### 1. 永久保護路徑

這些路徑由 `guard-check.mjs` 硬編碼，無法解凍：

- `supabase/migrations/` — 已套用的 migration 不可修改
- `.github/workflows/` — CI/CD 配置需人工審查
- `.env` / `.env.*` — 環境變數需人工管理
- `wrangler.jsonc` / `wrangler.toml` — 部署配置需人工審查

### 2. 自訂凍結路徑

讀取 `.claude/guard-state.json` 並列出 `frozen_paths`。

### 3. 危險指令警告

提醒以下指令需要額外確認：

- `git push --force`
- `git reset --hard`
- `rm -rf`
- `supabase db push`（production）

## 輸出格式

```
## 🛡️ Guard Status

### 永久保護
- 🔒 supabase/migrations/
- 🔒 .github/workflows/
- 🔒 .env / .env.*
- 🔒 wrangler.jsonc

### 自訂凍結
- 🧊 <path> (since <date>)
- （無）

### 管理
- 凍結: /freeze <path>
- 解凍: /unfreeze <path>
```
