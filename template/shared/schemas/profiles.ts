/**
 * Profile Zod 驗證 Schemas
 *
 * 定義 API request 的驗證規則，供 server endpoint 使用。
 *
 * @module shared/schemas/profiles
 */

import { z } from 'zod'

/** 列表查詢參數 schema */
export const profileListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})

/** 更新 Profile schema */
export const profileUpdateBodySchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().nullish(),
})

/** Profile ID 參數 schema */
export const profileIdParamSchema = z.object({
  id: z.string().uuid(),
})
