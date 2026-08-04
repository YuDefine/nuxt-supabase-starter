/**
 * GET /api/v1/profiles/:id — 取得單筆 Profile
 *
 * 需要登入，且只能讀自己的 profile（admin 例外）。
 *
 * 授權在 handler 層完成，不依賴 RLS：本專案的 auth 是 Better Auth，Supabase 從未
 * 對使用者簽發 JWT，`auth.uid()` 恆為 null，server 端的 client 也是 service-role
 * 連線 — RLS 在這個架構下只是「非 server 一律拒絕」的 deny-all 防線，無法承擔
 * row-level 授權。詳見 server/utils/supabase.ts 的 module JSDoc。
 *
 * @module server/api/v1/profiles/[id].get
 */

import { createError, defineEventHandler, getRouterParam } from 'h3'
import {
  profileIdParamSchema,
  profileResponseSchema,
  type ProfileResponse,
} from '#shared/schemas/profiles'
import { requireAuth } from '../../../utils/api-response'
import { PGRST_NOT_FOUND } from '../../../utils/db-errors'
import { PROFILE_SELECT_FIELDS } from '../../../utils/profile-fields'
import { validateParam } from '../../../utils/validation'
import { getSupabaseWithContext } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  const log = useLogger(event)
  const user = requireAuth(event)

  // 驗證 ID 參數
  const rawId = getRouterParam(event, 'id')
  const { id } = validateParam({ id: rawId }, profileIdParamSchema)

  // 只能讀自己的 profile；admin 可讀任意。
  // 回 404 而非 403 — 403 會告訴呼叫端「這個 id 存在」，讓任何登入者能枚舉
  // profile 是否存在。404 與「查無此人」對外不可區分。
  if (user.id !== id && user.role !== 'admin') {
    throw createError({
      statusCode: 404,
      statusMessage: '找不到指定的 Profile',
    })
  }

  const { client } = await getSupabaseWithContext(event)

  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .eq('id', id)
    .single()

  if (error) {
    // PGRST116 (404) 是預期錯誤，不需要 log.error
    if (error.code !== PGRST_NOT_FOUND) {
      log.error(error as Error, { step: 'db-select' })
    }
    throw createError({
      statusCode: error.code === PGRST_NOT_FOUND ? 404 : 500,
      statusMessage:
        error.code === PGRST_NOT_FOUND ? '找不到指定的 Profile' : '查詢失敗，請稍後再試',
    })
  }

  return profileResponseSchema.parse({ data })
})
