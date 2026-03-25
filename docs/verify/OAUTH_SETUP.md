# OAuth 設定指南

## Google OAuth

### 1. 建立 OAuth Client

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. 建立 OAuth 2.0 Client ID
3. 應用類型：Web application

### 2. 設定 Redirect URI

| 環境       | URI                                           |
| ---------- | --------------------------------------------- |
| 本地開發   | `http://localhost:3000/auth/google`           |
| Staging    | `https://staging.your-domain.com/auth/google` |
| Production | `https://your-domain.com/auth/google`         |

### 3. 環境變數

```bash
NUXT_OAUTH_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
```

## LINE OAuth（可選）

### 1. 建立 LINE Login Channel

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立 Provider → 建立 LINE Login Channel
3. 啟用 Web app

### 2. 設定 Callback URL

格式同 Google，路徑改為 `/auth/line`

### 3. 環境變數

```bash
NUXT_OAUTH_LINE_CLIENT_ID=your-channel-id
NUXT_OAUTH_LINE_CLIENT_SECRET=your-channel-secret
```

## 注意事項

- Redirect URI 必須完全匹配（包含 protocol 和 port）
- 本地開發使用 `http://localhost:3000`，不要用 `127.0.0.1`
- 新增 OAuth provider 後，需同時更新：
  1. `.env` / `.env.example`
  2. `nuxt.config.ts` runtimeConfig
  3. CI/CD secrets
  4. Cloudflare Workers secrets
