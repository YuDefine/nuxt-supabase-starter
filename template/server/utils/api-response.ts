/**
 * 統一 API 回應格式
 *
 * 提供分頁回應結構與權限檢查 helper。
 *
 * @module server/utils/api-response
 */

import { createError } from 'h3'
import type { H3Event } from 'h3'

import type { PaginationInput, PaginatedResponse } from '../../shared/types/pagination'

/**
 * 建立標準分頁回應
 */
export function createPaginatedResponse<T>(
  data: T[],
  pagination: PaginationInput
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
 * 檢查使用者是否具有指定角色
 *
 * @throws 401 - 未登入
 * @throws 403 - 權限不足
 */
export function requireRole(event: H3Event, roles: string[]): void {
  const user = requireAuth(event)

  if (!roles.includes(user.role ?? '')) {
    throw createError({
      statusCode: 403,
      statusMessage: '權限不足',
    })
  }
}
