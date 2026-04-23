/**
 * Pagination schemas
 *
 * Shared pagination limits and response schemas.
 *
 * @module shared/schemas/pagination
 */

import { z } from 'zod'

export const PAGE_SIZE_MAX = 100

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  perPage: z.number().int().positive().max(PAGE_SIZE_MAX),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

export function createPaginatedResponseSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationMetaSchema,
  })
}
