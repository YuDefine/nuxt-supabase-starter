# TD-010：Better Auth 與 nuxt-security CSRF 邊界裁決

日期：2026-09-26。範圍：只裁決與記錄後續實作；本次不變更執行碼。狀態：**裁決完成，修復與執行時驗收待後續工作**。

## 現況與證據

- `template/nuxt.config.ts:19,22,241-243` 同時載入 `@nuxtjs/better-auth`、`nuxt-security`，並設全域 `security.csrf: true`。`template/app/pages/auth/login.vue:7-10,27-37` 由 `useSignIn('email').execute()` 發送登入，沒有注入 nuxt-csurf token 的程式碼。TD-010 在 `docs/tech-debt.md` 記錄實測 `POST /api/auth/sign-in/email` 收到 `403 CSRF Token Mismatch`；本次沒有重新啟動 app 重現。
- `template/server/auth.config.ts:1-35` 使用 `defineServerAuth`，開啟 email/password 與 OAuth，設定 session 期限；此檔未設 `trustedOrigins`、`advanced.disableCSRFCheck`、`advanced.disableOriginCheck` 或自訂 cookie 屬性。`template/.env.example:58-75` 有 `BETTER_AUTH_SECRET` 與 `NUXT_PUBLIC_SITE_URL=http://localhost:3000` 範例，`template/package.json:24` 的 dev port 則是 3020。範例站點 URL 不能當作已驗證的 Better Auth origin 設定；部署時實際 base URL、可信 origin 與 cookie 屬性仍須實測核對。
- `template/package.json:72,79,86` 宣告 `@nuxtjs/better-auth ^0.1.4`、`better-auth ^1.7.1`、`nuxt-security ^2.5.1`；`template/pnpm-lock.yaml:51-53,72-74,2089-2094` 鎖在 Better Auth 1.7.1、nuxt-security 2.5.1，且 Nuxt 模組的 Better Auth peer 範圍是 `>=1.7.1 <2`。現有 [PR #1：升級到 1.6.11 處理 CVE-2026-53512](https://github.com/YuDefine/nuxt-supabase-starter/pull/1) 建於 2026-07-29，改的是 package 與 lockfile；其目標版本已低於目前 main 的 1.7.1，也低於目前 peer 下限。此 PR 若要落地，須先由 owner 重新對齊 main 與相依版本；本裁決不以該 PR 的舊版依賴為前提。
- [nuxt-security CSRF 文件](https://nuxt-security.vercel.app/middleware/csrf) 說明 `security.csrf: true` 啟用底層 nuxt-csurf，路由例外放在 `routeRules['/path'].csurf = false`（**不是** `routeRules.security.csrf`），也提供 `useCsrfFetch`、`useCsrf` 與 token header。其 [route rules 文件](https://nuxt-security.vercel.app/getting-started/usage) 說明 per-route 設定優先於全域；[Nuxt route rules 範例](https://nuxt.com/docs/4.x/guide/concepts/rendering) 使用 `/api/**` 類前綴通配。
- [Better Auth Security 文件](https://better-auth.com/docs/reference/security) 說明有 cookie 的請求會檢查 origin；email sign-in 等可接受 form 提交的路由另有首次登入的 Fetch Metadata/origin 檢查；session cookie 預設 `SameSite=Lax`、`HttpOnly`，HTTPS base URL 使用 Secure；OAuth callback 另驗 state/PKCE。無 cookie 且同時缺少 Fetch Metadata、Origin、Referer 的非瀏覽器請求有較寬鬆的 fallback，不能把 origin 驗證寫成「所有請求一律拒絕」。這些是上游描述的預設行為，**尚非本專案執行時驗證結果**。同頁說明 `disableCSRFCheck` 或 `disableOriginCheck` 會削弱這些檢查，本案不設定它們。

## 兩案比較

| 方案 | 變更與相容性 | 保護邊界與代價 |
| --- | --- | --- |
| A. `/api/auth/**` 排除 nuxt-csurf | 在 `template/nuxt.config.ts` 增加 `routeRules: { '/api/auth/**': { csurf: false } }`，維持全域 `security.csrf: true`。依 nuxt-security 的 `csurf` route rule 執行；也要在 `template/packages/create-nuxt-starter/src/assemble.ts:568-587` 的 security + Better Auth 產生路徑同步輸出例外。 | auth 路由改由 Better Auth 自身的 origin、cookie、Fetch Metadata 與 OAuth state 保護；其他 API 繼續用 nuxt-csurf。路徑通配若納入未來自寫的 `/api/auth/**` 端點，該端點也會失去 nuxt-csurf，故須限定該 prefix 為 Better Auth 所有並以測試守住。 |
| B. Better Auth client 帶 token | 在登入、註冊、忘記密碼等每個 Better Auth client 操作注入 `useCsrf()` token 或包裝 fetch（`useCsrfFetch` 只包 `useFetch`，不能直接替換 `useSignIn`）；需確認 `@nuxtjs/better-auth` 0.1.4 對 client fetch header 的正式擴充點。 | 保留 auth 路由的雙層 CSRF 檢查，但需要涵蓋模組自動發送的所有寫入、首次載入 token、OAuth callback、第三方/非瀏覽器 client 與 scaffold 輸出；漏任一路徑仍可能 403。目前登入頁只呼叫 `execute()`（`template/app/pages/auth/login.vue:27-29`），沒有已證實可全面注入的介面。 |

**推薦 A。** Better Auth 的 auth 路由由同一套認證框架管理；nuxt-security 文件提供精確的 `csurf: false` 路由例外，變更可限制在 `/api/auth/**`。這是由本 repo 配置與上游機制推得的設計裁決；需完成下列執行時驗收後，才可宣稱登入已修復。全域 `security.csrf`、Better Auth 的 CSRF/origin 檢查均須保持啟用。

## 本棒驗證

- `git fetch origin` 後 `git merge origin/main`：already up to date。
- 在 `template/` 執行 `pnpm typecheck`：exit 0；`vp check`：exit 0，格式檢查 286 檔、lint 檢查 253 檔通過（2026-09-26）。本 worktree 初始未安裝依賴，`pnpm typecheck` 自動補齊本機依賴後，`vp check` 重跑才通過；首次無依賴的 `vp check` 因無法解析 `vite-plus` 失敗。兩個通過結果不等於 auth 執行時驗收。
- 僅編修 docs，`git diff --check` 通過。沒有程式碼差異，因此本棒不執行登入 E2E；登入修復測試留在後續實作。

## 後續實作 brief（交接下一棒）

工作指針：`docs/tech-debt.md` TD-010、本文件、`template/nuxt.config.ts:241-243`、`template/packages/create-nuxt-starter/src/assemble.ts:568-587`。本棒只持有並變更 `docs/evidence/2026-09-26-td-010-csrf-decision.md` 與 `docs/tech-debt.md` 的 TD-010 段；下一棒需由 coordinator 另行宣告程式碼、測試及 scaffold 檔案所有權。

1. 在 `template/nuxt.config.ts` 加 `routeRules: { '/api/auth/**': { csurf: false } }`，保留 `security.csrf: true`。以 nuxt-security 2.5.1 / nuxt-csurf 實際執行確認通配路徑有效，必要時用更窄的 auth 子路由列舉；不要改成全域關閉或 Better Auth `disableCSRFCheck`。檢查 `routeRules` 與現有其他規則是否合併正確。
2. 在 scaffolder 的 `generateNuxtConfig`（`template/packages/create-nuxt-starter/src/assemble.ts:445-663`）只對同時選 Better Auth 與 security 的輸出加入同等例外；補對應 scaffold fixture/test。檢查是否有其他 Better Auth 生成路徑，避免只修參考 app。
3. 測 dev server：登入頁以有效測試帳密實際登入，不再收到 `CSRF Token Mismatch`；有 `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` 時跑 `template/e2e/auth.spec.ts:84-112` 的真實登入。此測試在缺帳密時會 skip，不能把 skip 算 PASS。
4. 同一 dev server 對**非 auth** 的 `POST /api/_dev/login` 送無 nuxt-csurf token 請求，斷言 HTTP 403 **且 body 為 CSRF token mismatch**，避免把該 API 自身拒絕誤認為 CSRF 生效；再驗另一條一般 POST API 或測試專用 route。對 `/api/auth/sign-in/email` 發來自非信任 origin 的有效形狀請求，確認由 Better Auth 的 origin/Fetch Metadata 層拒絕，而不是憑錯誤帳密判斷。
5. 以實際部署 host 核對 Better Auth base URL、`trustedOrigins`、`Set-Cookie` 的 `SameSite`/`HttpOnly`/`Secure` 與 OAuth state，並確認未開 `disableCSRFCheck` / `disableOriginCheck`。回顧 [PR #1](https://github.com/YuDefine/nuxt-supabase-starter/pull/1) 與目前 1.7.1 的關係，避免舊 PR 覆蓋較新版 lockfile。

本文件是方案依據，不是上述執行時測試已通過的證據。
