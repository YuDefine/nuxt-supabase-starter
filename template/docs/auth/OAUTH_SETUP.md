# OAuth 設定流程（nuxt-auth-utils）

本系統使用 **nuxt-auth-utils** 進行 Cookie-based Session 認證，支援 Google 登入（可擴充其他 OAuth Provider）。此文件說明如何從零設定 OAuth Provider。

---

## 1. Google OAuth 設定

### 1.1. 建立 Google Cloud OAuth Client

1. 登入 [Google Cloud Console](https://console.cloud.google.com/) 並選定專案。
2. 於 **APIs & Services → OAuth consent screen**
   - User type：`Internal`（僅公司內部）或 `External`
   - 填寫 App name / Support email / Domain
   - Scopes：至少 `openid`, `email`, `profile`
3. 於 **Credentials → Create Credentials → OAuth client ID**
   - Application type：`Web application`
   - Authorized JavaScript origins：
     ```
     http://localhost:3000
     https://<production-domain>
     ```
   - Authorized redirect URIs：
     ```
     http://localhost:3000/auth/google
     https://<production-domain>/auth/google
     ```
   - 建立後記下 `Client ID` 與 `Client Secret`。

### 1.2. 環境變數設定

```bash
# .env.local
NUXT_OAUTH_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
```

### 1.3. 登入流程

```
使用者點擊「Google 登入」
     ↓
訪問 /auth/google
     ↓
重導向至 Google OAuth
     ↓
使用者授權
     ↓
Google 回調 /auth/google?code=...
     ↓
Server 驗證 + 檢查白名單 + 建立 Session
     ↓
重導向至首頁（已登入）
```

---

## 2. 新增其他 OAuth Provider（可選）

nuxt-auth-utils 支援多種 OAuth Provider。以下為新增 Provider 的通用步驟：

1. 在該 Provider 的開發者後台建立 OAuth App
2. 設定 Callback URL 為 `/auth/<provider>`
3. 在 `.env.local` 中設定對應的環境變數：
   ```bash
   NUXT_OAUTH_<PROVIDER>_CLIENT_ID=your-client-id
   NUXT_OAUTH_<PROVIDER>_CLIENT_SECRET=your-client-secret
   ```
4. 建立 `server/routes/auth/<provider>.get.ts` handler

詳細支援的 Provider 列表請參閱 [nuxt-auth-utils 文件](https://github.com/atinux/nuxt-auth-utils)。

---

## 3. Session 設定

nuxt-auth-utils 使用加密的 Cookie 來儲存 Session，需要設定密碼：

```bash
# .env.local
# 至少 32 字元，可使用 openssl rand -base64 32 產生
NUXT_SESSION_PASSWORD=your-session-password-at-least-32-characters
```

### Session 配置（nuxt.config.ts）

```ts
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils'],
  runtimeConfig: {
    session: {
      maxAge: 60 * 60 * 24 * 7, // 7 天
      password: process.env.NUXT_SESSION_PASSWORD || '',
    },
  },
})
```

---

## 4. 驗證清單

- [ ] Google Cloud OAuth 同意畫面已發布（不是 Draft）
- [ ] `.env.local` 內的 `NUXT_OAUTH_GOOGLE_CLIENT_ID` 與 Google Cloud 版本一致
- [ ] `NUXT_SESSION_PASSWORD` 至少 32 字元
- [ ] `SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SECRET_KEY` 為正確專案
- [ ] Admin 帳號 Email 已在 `app.allowed_emails` 白名單中
- [ ] 首次登入後，`app.user_roles` 自動建立記錄

---

## 5. 登入端點

| 端點                    | 說明              |
| ----------------------- | ----------------- |
| `GET /auth/google`      | Google OAuth 登入 |
| `GET /api/auth/session` | 取得目前 Session  |
| `POST /api/auth/logout` | 登出              |

---

## 6. 疑難排解

| 症狀                               | 可能原因                             | 解法                                        |
| ---------------------------------- | ------------------------------------ | ------------------------------------------- |
| OAuth 失敗 `redirect_uri_mismatch` | Redirect URL 不在 Google 清單        | 確認 `/auth/google` 已加入                  |
| Session 無法建立                   | `NUXT_SESSION_PASSWORD` 未設定或太短 | 設定至少 32 字元的密碼                      |
| 登入後被導向 `/forbidden`          | Email 不在白名單或角色為 `pending`   | 檢查 `app.allowed_emails` 和 `app.user_roles` |
| API 回傳 401                       | Cookie 未正確設定或已過期            | 檢查瀏覽器 Cookie，重新登入                |

確保上述步驟完成後，再開始測試登入流程；任何調整（例如換 Domain）都要同步更新 Google 設定與環境變數。
