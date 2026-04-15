/**
 * GET /api/v1/profiles/me — 取得當前登入使用者的 Profile
 *
 * 需要登入。
 *
 * @module server/api/v1/profiles/me.get
 */

import { createError, defineEventHandler } from 'h3'
import type { ProfileResponse } from '#shared/types/profiles'
import { requireAuth } from '../../../utils/api-response'
import { PGRST_NOT_FOUND } from '../../../utils/db-errors'
import { PROFILE_SELECT_FIELDS } from '../../../utils/profile-fields'
import { getServerSupabaseClient } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  const log = useLogger(event)
  const user = requireAuth(event)

  const client = getServerSupabaseClient()

  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .eq('id', user.id)
    .single()

  if (error) {
    // PGRST116 (404) 是預期錯誤，不需要 log.error
    if (error.code !== PGRST_NOT_FOUND) {
      log.error(error as Error, { step: 'db-select' })
    }
    throw createError({
      statusCode: error.code === PGRST_NOT_FOUND ? 404 : 500,
      statusMessage: error.code === PGRST_NOT_FOUND ? '找不到您的 Profile' : '查詢失敗，請稍後再試',
    })
  }

  return { data }
})
