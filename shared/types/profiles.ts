/**
 * Profile 型別定義
 *
 * Client/Server 共用的 request/response 型別。
 *
 * @module shared/types/profiles
 */

import type { PaginatedResponse } from '../../server/utils/api-response'

/** Profile 完整資料（對應 profiles table Row） */
export interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  role: string
  created_at: string
  updated_at: string | null
}

/** 列表查詢參數 */
export interface ProfileListQuery {
  page: number
  perPage: number
  search?: string
}

/** 更新 Profile 的 request body */
export interface ProfileUpdateBody {
  display_name?: string
  avatar_url?: string | null
}

/** Profile 列表回應 */
export type ProfileListResponse = PaginatedResponse<Profile>

/** 單筆 Profile 回應 */
export interface ProfileResponse {
  data: Profile
}
