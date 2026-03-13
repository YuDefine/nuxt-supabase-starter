/**
 * GET /api/v1/profiles/me — 取得當前登入使用者的 Profile
 *
 * 需要登入。
 *
 * @module server/api/v1/profiles/me.get
 */

import { createError, defineEventHandler } from 'h3'
import type { ProfileResponse } from '../../../../shared/types/profiles'
import { requireAuth } from '../../../utils/api-response'
import { getServerSupabaseClient } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  const user = requireAuth(event)

  const client = getServerSupabaseClient()

  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, avatar_url, role, created_at, updated_at')
    .eq('id', user.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw createError({
        statusCode: 404,
        message: '找不到您的 Profile',
      })
    }

    throw createError({
      statusCode: 500,
      message: `查詢失敗：${error.message}`,
    })
  }

  return { data }
})
