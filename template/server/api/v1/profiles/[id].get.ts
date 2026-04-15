/**
 * GET /api/v1/profiles/:id — 取得單筆 Profile
 *
 * 需要登入。
 *
 * @module server/api/v1/profiles/[id].get
 */

import { createError, defineEventHandler, getRouterParam } from 'h3'
import { profileIdParamSchema } from '#shared/schemas/profiles'
import type { ProfileResponse } from '#shared/types/profiles'
import { requireAuth } from '../../../utils/api-response'
import { PGRST_NOT_FOUND } from '../../../utils/db-errors'
import { PROFILE_SELECT_FIELDS } from '../../../utils/profile-fields'
import { validateParam } from '../../../utils/validation'
import { getServerSupabaseClient } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  const log = useLogger(event)
  requireAuth(event)

  // 驗證 ID 參數
  const rawId = getRouterParam(event, 'id')
  const { id } = validateParam({ id: rawId }, profileIdParamSchema)

  const client = getServerSupabaseClient()

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

  return { data }
})
