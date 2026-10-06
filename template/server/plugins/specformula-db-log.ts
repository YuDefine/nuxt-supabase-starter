// SPECFORMULA_TEST=1 時攔截 app server 的 outbound fetch，記錄對
// `/rest/v1/profiles` 的 PostgREST 請求 —— BDD step「profiles 資料表的資料列
// 沒有被讀取」需要確定性地斷言「這次 HTTP 請求期間 app 對 profiles 發了哪些
// 查詢」。service-role client 走 HTTP 到 PostgREST，fetch 攔截是唯一的
// per-request 可觀測點（pg_stat_statements 無法按 HTTP 請求切割）。
//
// production / 一般 dev 不啟用：flag 沒設就直接 return，globalThis.fetch 維持原樣。
import { defineNitroPlugin } from 'nitropack/runtime'

import { recordProfileDbRequest } from '../utils/specformula-db-log'

export default defineNitroPlugin(() => {
  if (process.env.SPECFORMULA_TEST !== '1') return

  const original = globalThis.fetch
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/rest/v1/profiles')) {
        recordProfileDbRequest(url, init?.method ?? 'GET')
      }
    } catch {
      // 觀測失敗絕對不能影響被觀測的請求
    }
    return original.call(globalThis, input as never, init)
  }
})
