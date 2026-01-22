// @ts-expect-error - better-auth client 尚未安裝（模組暫時停用）
import { createAuthClient } from "better-auth/client";

// 建立並導出 auth client
// 這個函式會被 nuxt-better-auth 模組使用
export function createAppAuthClient(baseURL?: string) {
  return createAuthClient({
    baseURL: baseURL || "",
    // 可在此加入 plugins，例如：
    // plugins: [
    //   twoFactorClient(),
    //   passkeyClient(),
    // ]
  });
}
