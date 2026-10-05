/**
 * /test/db-log 的共享狀態：記錄 app server 對 PostgREST `profiles` 表的所有請求。
 *
 * 只應在 SPECFORMULA_TEST=1 時被寫入（plugin 端守衛）；route 端永遠回讀，
 * 實際可見性由 server/middleware/00.test-routes-guard.ts 控制。
 */

export interface ProfileDbLogEntry {
  ts: number
  method: string
  url: string
  /** PostgREST select 參數（已解碼）；非 select 請求為 null */
  select: string | null
}

export const profileDbLog: ProfileDbLogEntry[] = []

export function recordProfileDbRequest(url: string, method: string): void {
  let select: string | null = null
  try {
    select = new URL(url).searchParams.get('select')
  } catch {
    // 非 URL 就記 null —— 斷言端會把 select null 的列視為一般查詢
  }
  profileDbLog.push({ ts: Date.now(), method, url, select })
  // 上限防止長時間 dev server 膨脹
  if (profileDbLog.length > 10_000) profileDbLog.splice(0, profileDbLog.length - 10_000)
}
