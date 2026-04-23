/**
 * Profile Zod 驗證 Schemas
 *
 * 定義 API request 的驗證規則，供 server endpoint 使用。
 *
 * @module shared/schemas/profiles
 */

import { z, type infer as Infer } from 'zod'
import { createPaginatedResponseSchema, PAGE_SIZE_MAX } from './pagination'

/** Profile 回應資料 schema */
export const profileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  role: z.string(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
})

/** 列表查詢參數 schema */
export const profileListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(20),
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

/** 單筆 Profile 回應 schema */
export const profileResponseSchema = z.object({
  data: profileSchema,
})

/** Profile 列表回應 schema */
export const profileListResponseSchema = createPaginatedResponseSchema(profileSchema)

export interface Profile extends Infer<typeof profileSchema> {}

export interface ProfileListQuery extends Infer<typeof profileListQuerySchema> {}

export interface ProfileUpdateBody extends Infer<typeof profileUpdateBodySchema> {}

export interface ProfileResponse extends Infer<typeof profileResponseSchema> {}

export interface ProfileListResponse extends Infer<typeof profileListResponseSchema> {}
