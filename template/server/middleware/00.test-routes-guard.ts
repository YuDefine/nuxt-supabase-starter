// 測試控制面守衛（TD-026 D5 / SpecFormula 接線）
//
// 檔名的 00. 前綴讓它排在其他 middleware 之前——在任何 auth / logging
// middleware 之前把已登記的 /test/* 控制面路徑擋掉。
//
// 只攔 TEST_CONTROL_PATHS 列出的路徑（對應 server/routes/test/ 下的檔案；
// 新增控制面路由時同步登記）。不整個前綴都擋——template 會 scaffold 進
// consumer，consumer 自己的 /test/* 頁面或 API 不該被誤成 404。
//
// 回 404 不回 403：403 洩漏「這個端點存在」。兩個條件是 AND，不是 OR ——
// 只看 NODE_ENV 會在 preview / staging build 漏；只看 flag 會在有人把
// flag 帶進 production env 時漏。
import { defineEventHandler } from 'h3'
import { createError } from 'evlog'

const TEST_CONTROL_PATHS = new Set(['/test/health', '/test/db-log'])

export default defineEventHandler((event) => {
  const path = (event.path ?? '').split('?')[0]
  if (!TEST_CONTROL_PATHS.has(path)) return

  const enabled = process.env.SPECFORMULA_TEST === '1'
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.NUXT_ENV === 'production'

  if (!enabled || isProduction) {
    const log = useLogger(event)
    log.set({ testControl: { denied: true, enabled, isProduction } })
    throw createError({
      status: 404,
      message: 'Not Found',
      why: 'The /test/* control plane only exists when SPECFORMULA_TEST=1 outside production.',
      fix: 'Restart the dev server with SPECFORMULA_TEST=1, or remove the request.',
    })
  }
})
