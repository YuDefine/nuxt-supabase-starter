/**
 * 統一 API 回應格式
 *
 * 提供分頁回應結構與權限檢查 helper。
 *
 * @module server/utils/api-response
 */

import { createError } from 'h3'
import { createError as createServiceError } from 'evlog'
import type { H3Event } from 'h3'

import type { PaginationInput, PaginatedResponse } from '../../shared/types/pagination'
import { getServerSupabaseClient } from './supabase'

/**
 * 建立標準分頁回應
 */
export function createPaginatedResponse<T>(
  data: T[],
  pagination: PaginationInput,
): PaginatedResponse<T> {
  const { page, perPage, total } = pagination
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage)

  return {
    data,
    pagination: {
      page,
      perPage,
      total,
      totalPages,
    },
  }
}

/**
 * 驗證使用者已登入，回傳 session user
 *
 * @throws 401 - 未登入
 */
export function requireAuth(event: H3Event): { id: string; role?: string; email?: string } {
  const session = (
    event.context as { session?: { user?: { id: string; role?: string; email?: string } } }
  )?.session
  const user = session?.user

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: '未登入，請先登入',
    })
  }

  return user
}

/**
 * 從 DB 查詢指定使用者的角色
 *
 * TD-026 D3：授權以 `profiles.role` 為唯一來源，不信任 session.user.role ——
 * Better Auth 沒有 role plugin，session 上的 role 欄位既無持久化機制、值域也與
 * DB 不同步，信任它等於讓呼叫端自我宣稱權限。
 *
 * @returns 角色字串；查無 profile 列時回 null
 * @throws 500 - 角色查詢失敗
 */
export async function getDbRole(event: H3Event, userId: string): Promise<string | null> {
  const client = getServerSupabaseClient()
  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw createServiceError({
      status: 500,
      message: '角色查詢失敗',
      why: '資料服務回傳讀取錯誤，無法取得使用者角色。',
      fix: '請聯絡系統管理員並提供這次請求的時間。',
      cause: error as unknown as Error,
    })
  }

  // database.types.ts 是 stub（Tables: Record<string, never>），select 出來的
  // data 被推成 never——型別層面無法表達，此處以窄化 cast 對齊 migration 的
  // profiles.role text 欄位。
  return (data as { role: string } | null)?.role ?? null
}

/**
 * 檢查使用者是否具有指定角色（角色以 DB `profiles.role` 為準）
 *
 * @throws 401 - 未登入
 * @throws 403 - 權限不足（含查無 profile）
 * @throws 500 - 角色查詢失敗
 */
export async function requireRole(event: H3Event, roles: string[]): Promise<void> {
  const user = requireAuth(event)
  const role = await getDbRole(event, user.id)

  if (!role || !roles.includes(role)) {
    throw createError({
      statusCode: 403,
      statusMessage: '權限不足',
    })
  }
}
