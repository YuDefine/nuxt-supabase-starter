/**
 * Supabase Server 工具函式
 *
 * 提供 Server-side Supabase 存取：
 * - getServerSupabaseClient(): service-role client singleton
 * - getAuthedSupabase(event): 驗過 session 的同一顆 client + user
 *
 * ## 授權模型：server-mediated（不是 RLS）
 *
 * 本專案的 auth 是 **Better Auth**，不是 Supabase Auth——Supabase 從未對本 app 的
 * 使用者簽發 JWT，因此 RLS policy 裡的 `auth.uid()` **恆為 null**。加上 server 端
 * 只有 service-role 連線（service_role 本身具 BYPASSRLS），RLS 在這個架構下無法
 * 承擔 row-level 授權。
 *
 * 所以：**授權一律在 handler 層完成**（requireAuth / requireRole / ownership 比對），
 * RLS 的角色降為「非 server 一律拒絕」的 deny-all 防線——即使 publishable key 外流，
 * 直接打 PostgREST 也讀不到任何 row。
 *
 * 歷史：先前有一支 `getSupabaseWithContext()` 會呼叫 `set_app_context` RPC，試圖用
 * `app.user_id` GUC 讓 RLS 認得目前使用者。那個機制在兩個層面同時失效——(1) 連線是
 * service_role，policy 整表放行；(2) RPC 內是 `set_config(..., true)`（transaction-local），
 * 而 PostgREST 每個 request 是獨立 transaction，GUC 在 RPC 結束時就沒了。已於本次移除。
 *
 * @module server/utils/supabase
 */

import { createError } from 'h3'
import type { H3Event } from 'h3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~~/app/types/database.types'

export interface AuthedSupabaseResult {
  client: SupabaseClient<Database>
  user: { id: string; role?: string; [key: string]: unknown }
}

// Module-level singleton
let serviceClient: SupabaseClient<Database> | null = null

/**
 * 取得 Supabase Service Role Client（Singleton）
 *
 * 使用 Service Role Key，繞過所有 RLS 限制。
 *
 * ⚠️ 此 Client 無 RLS 保護。system 任務（audit、backfill、修復腳本、背景工作）直接用它；
 * request handler 請用 getAuthedSupabase(event) 取得同一顆 client 並先驗過 session
 * ——但**兩者的權限完全相同**，授權仍必須由 handler 自己做（見 module JSDoc）。
 */
export function getServerSupabaseClient(): SupabaseClient<Database> {
  if (serviceClient) {
    return serviceClient
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !serviceKey) {
    throw createError({
      statusCode: 500,
      message: '伺服器設定錯誤：缺少 Supabase 環境變數',
    })
  }

  serviceClient = createClient<Database>(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return serviceClient
}

/**
 * 取得 Supabase Client 與已驗證的使用者
 *
 * 只做兩件事：驗 session、回傳 client + user。**不做任何授權**——回傳的 client 是
 * service-role，能讀寫整個資料庫。呼叫端 MUST 自行判定這個 user 可以動哪些 row
 * （ownership 比對、requireRole，或以 user.id 夾住查詢條件）。
 *
 * 名稱刻意不叫 `getSupabaseWithContext`：那個名字曾讓三支 handler 誤以為 client
 * 帶著使用者身分、資料範圍已被 RLS 限縮，實際上並沒有。
 *
 * @throws 401 - 未登入
 */
export function getAuthedSupabase(event: H3Event): AuthedSupabaseResult {
  const session = (event.context as { session?: { user?: AuthedSupabaseResult['user'] } })?.session
  const user = session?.user

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      message: '未登入，請先登入',
    })
  }

  return { client: getServerSupabaseClient(), user }
}
