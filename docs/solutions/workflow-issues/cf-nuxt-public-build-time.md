---
module: deployment
date: 2025-01-01
problem_type: workflow-issues
component: nuxt.config.ts / CI/CD workflows
symptoms:
  - 環境變數在 production 是 undefined
  - NUXT_PUBLIC_* 變數在 client-side 讀不到
  - 本地開發正常但部署後壞掉
root_cause: NUXT_PUBLIC_* 變數在 build time 注入到 client bundle，不是 runtime；CI/CD build 時未傳入
resolution_type: configuration
severity: high
tags:
  - cloudflare-workers
  - environment-variables
  - nuxt-public
  - ci-cd
---

## Problem

Cloudflare Workers 的 `NUXT_PUBLIC_*` 環境變數在 **build time** 注入到 client bundle，不是 runtime 讀取。如果 CI/CD build 時沒有傳入這些變數，production client bundle 中的值會是 `undefined`。

## What Didn't Work

- 在 Cloudflare Dashboard 設定環境變數 — 這只影響 server runtime，不影響已打包的 client bundle
- 以為跟 Node.js 一樣 runtime 讀 process.env — Workers client 是靜態打包的

## Solution

確保 CI/CD workflow 在 build 步驟傳入所有 `NUXT_PUBLIC_*`：

```yaml
- name: Build
  run: pnpm build
  env:
    NUXT_PUBLIC_SUPABASE_URL: ${{ secrets.NUXT_PUBLIC_SUPABASE_URL }}
    NUXT_PUBLIC_SUPABASE_KEY: ${{ secrets.NUXT_PUBLIC_SUPABASE_KEY }}
    NUXT_PUBLIC_SITE_URL: ${{ secrets.NUXT_PUBLIC_SITE_URL }}
```

## Prevention

- 新增 `NUXT_PUBLIC_*` 變數時，同步更新 GitHub Secrets **和** CI/CD workflow
- 統一用 GitHub Secrets 管理，**禁止** Cloudflare Dashboard 設定
- 見 `docs/verify/ENVIRONMENT_VARIABLES.md` 完整清單
