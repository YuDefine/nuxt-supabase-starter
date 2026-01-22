import { defineServerAuth } from "@onmax/nuxt-better-auth/config";

export default defineServerAuth(({ _runtimeConfig }) => ({
  // 啟用 Email + Password 認證（開發測試用）
  emailAndPassword: { enabled: true },

  // OAuth providers（根據需要啟用）
  // socialProviders: {
  //   google: {
  //     clientId: _runtimeConfig.oauth.google.clientId,
  //     clientSecret: _runtimeConfig.oauth.google.clientSecret,
  //   },
  //   github: {
  //     clientId: _runtimeConfig.oauth.github.clientId,
  //     clientSecret: _runtimeConfig.oauth.github.clientSecret,
  //   },
  // },

  // Session 設定
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 每 24 小時更新
  },
}));
