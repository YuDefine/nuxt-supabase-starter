/**
 * API response utilities (Better Auth variant)
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

export function requireAuth(event: H3Event): { id: string; role?: string; email?: string } {
  const session = (event.context as any)?.session
  const user = session?.user

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  return user
}

export function requireRole(event: H3Event, roles: string[]): void {
  const user = requireAuth(event)

  if (!roles.includes(user.role ?? '')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }
}
