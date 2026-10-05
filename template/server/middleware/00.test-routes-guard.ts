// 測試控制面守衛（TD-026 D5 / SpecFormula 接線）
//
// 檔名的 00. 前綴讓它排在其他 middleware 之前——在任何 auth / logging
// middleware 之前把 /test/* 擋掉。
//
// 回 404 不回 403：403 洩漏「這個端點存在」。兩個條件是 AND，不是 OR ——
// 只看 NODE_ENV 會在 preview / staging build 漏；只看 flag 會在有人把
// flag 帶進 production env 時漏。
import { createError, defineEventHandler } from 'h3'

export default defineEventHandler((event) => {
  const path = event.path ?? ''
  if (!path.startsWith('/test/')) return

  const enabled = process.env.SPECFORMULA_TEST === '1'
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.NUXT_ENV === 'production'

  if (!enabled || isProduction) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
