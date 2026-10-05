// 測試控制面：GET /test/db-log?since=<epochMs>（TD-026 D5）
// 回傳 app server 對 PostgREST profiles 表的請求紀錄，供 BDD step 斷言
// 「這次請求期間資料列沒有被讀」。可見性由 test-routes-guard 控制。
import { defineEventHandler, getQuery } from 'h3'

import { profileDbLog } from '../../utils/specformula-db-log'

export default defineEventHandler((event) => {
  const since = Number(getQuery(event).since ?? 0)
  return { entries: profileDbLog.filter((entry) => entry.ts >= since) }
})
