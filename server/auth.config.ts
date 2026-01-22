import { defineServerAuth } from "@onmax/nuxt-better-auth/config";

export default defineServerAuth({
  // 啟用 Email + Password 認證（開發測試用）
  emailAndPassword: { enabled: true },

  // OAuth providers（根據需要啟用）
  // socialProviders: {
  //   google: {
  //     clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
  //     clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
  //   },
  //   github: {
  //     clientId: process.env.NUXT_OAUTH_GITHUB_CLIENT_ID,
  //     clientSecret: process.env.NUXT_OAUTH_GITHUB_CLIENT_SECRET,
  //   },
  // },

  // Session 設定
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 每 24 小時更新
  },
});
