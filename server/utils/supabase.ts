/**
 * Supabase Server 工具函式
 *
 * 提供 Server-side Supabase 存取：
 * - getServerSupabaseClient(): Service Role Client（無 RLS 限制）
 * - getSupabaseWithContext(event): Context-aware Client（帶 RLS application context）
 *
 * @module server/utils/supabase
 */

import { createError } from 'h3'
import type { H3Event } from 'h3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~~/app/types/database.types'

export interface SupabaseContextResult {
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
 * ⚠️ 注意：此 Client 無 RLS 保護，請謹慎使用！
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
 * 取得帶 RLS Application Context 的 Supabase Client
 *
 * 從 session 取得 user 資訊，透過 RPC 設定 application context，
 * 讓 RLS policy 可以透過 current_setting() 存取使用者身份。
 *
 * @throws 401 - 未登入
 * @throws 500 - RPC 設定失敗
 */
export async function getSupabaseWithContext(event: H3Event): Promise<SupabaseContextResult> {
  const session = (event.context as any)?.session
  const user = session?.user

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      message: '未登入，請先登入',
    })
  }

  const client = getServerSupabaseClient()
  const role = user.role ?? 'user'

  const { error } = await client.rpc('set_app_context', {
    p_user_id: user.id as string,
    p_user_role: role as string,
  } as any)

  if (error) {
    throw createError({
      statusCode: 500,
      message: `無法設定 application context：${error.message}`,
    })
  }

  return { client, user }
}
