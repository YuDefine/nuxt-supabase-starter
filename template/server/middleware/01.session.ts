// 把 Better Auth session 灌進 event.context.session —— api-response.ts 的
// requireAuth()/getAuthedSupabase() 讀的就是這個屬性（沿襲 nuxt-auth-utils 時代的
// 契約）。@nuxtjs/better-auth 只提供 getUserSession()/requireUserSession()，本身
// 從不寫 context.session；少了這層，所有 authed endpoint 在 wire 上恆 401
// （單元測試直接 mock context.session，所以缺陷從未暴露——TD-026 D5 wire BDD
// 第一次把它跑出來）。
//
// 開銷說明：getUserSession 對每個請求查一次 session storage。模組內部有
// context.requestSession 快取，同一請求的重複呼叫（route-access middleware、
// handler）共用同一次解析，不在這裡加第二層快取。
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (session) {
    ;(event.context as { session?: unknown }).session = session
  }
})
