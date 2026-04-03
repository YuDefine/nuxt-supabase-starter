/**
 * API response utilities (nuxt-auth-utils variant)
 */

import { createError } from 'h3'
import type { H3Event } from 'h3'

export interface PaginationInput {
  page: number
  perPage: number
  total: number
}

export interface PaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
}

export function createPaginatedResponse<T>(
  data: T[],
  pagination: PaginationInput
): PaginatedResponse<T> {
  const { page, perPage, total } = pagination
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage)

  return {
    data,
    pagination: { page, perPage, total, totalPages },
  }
}

export async function requireAuth(
  event: H3Event
): Promise<{ id: string; role?: string; email?: string }> {
  const session = await getUserSession(event)

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  return session.user as { id: string; role?: string; email?: string }
}

export async function requireRole(event: H3Event, roles: string[]): Promise<void> {
  const user = await requireAuth(event)

  if (!roles.includes(user.role ?? '')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }
}
