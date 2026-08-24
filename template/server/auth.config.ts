import { defineServerAuth } from '@nuxtjs/better-auth/config'

export default defineServerAuth({
  // 啟用 Email + Password 認證（開發測試用）
  emailAndPassword: { enabled: true },

  // OAuth providers。
  //
  // 這裡的 key 同時是**型別來源**：`useSignIn('social')` 的 `provider` 只吃這個物件
  // 有列出來的 id（模組用 `AuthSocialProviderRegistry` 從本檔的回傳型別推導）。要在
  // 登入頁增減 OAuth 按鈕，先改這裡。
  //
  // credentials 留空不會讓 app 起不來 —— Better Auth 只在**實際發起授權**（使用者按下
  // 該 provider 按鈕）時才檢查，缺 credentials 會回錯誤訊息給登入頁。
  socialProviders: {
    google: {
      clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.NUXT_OAUTH_GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.NUXT_OAUTH_GITHUB_CLIENT_SECRET ?? '',
    },
    line: {
      clientId: process.env.NUXT_OAUTH_LINE_CLIENT_ID ?? '',
      clientSecret: process.env.NUXT_OAUTH_LINE_CLIENT_SECRET ?? '',
    },
  },

  // Session 設定
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 每 24 小時更新
  },
})
