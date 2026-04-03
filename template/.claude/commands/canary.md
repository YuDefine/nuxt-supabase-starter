---
description: '部署後健康檢查'
---

# /canary — 部署後健康檢查

## Step 1: 確定目標 URL

從 `.env` 或 `nuxt.config.ts` 中找到 `NUXT_PUBLIC_SITE_URL`。
如果找不到，詢問使用者。

## Step 2: HTTP 檢查

```bash
curl -sf -o /dev/null -w '%{http_code}' <URL>
```

預期：200

## Step 3: 視覺驗證（可選）

如果 `browser-use` 可用：

1. `browser-use navigate <URL>`
2. `browser-use screenshot temp/canary-$(date +%Y%m%d-%H%M%S).png`
3. 檢查截圖是否正常
4. `browser-use close`

## Step 4: 報告

```
✅ Canary 通過
- URL: <URL>
- HTTP: 200
- 截圖: temp/canary-*.png（如適用）

❌ Canary 失敗
- URL: <URL>
- HTTP: <code>
- 可能原因: [分析]
```
