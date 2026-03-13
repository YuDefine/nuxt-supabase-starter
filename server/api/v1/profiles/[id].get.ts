/**
 * GET /api/v1/profiles/:id — 取得單筆 Profile
 *
 * 需要登入。
 *
 * @module server/api/v1/profiles/[id].get
 */

import { createError, defineEventHandler, getRouterParam } from 'h3'
import { profileIdParamSchema } from '../../../../shared/schemas/profiles'
import type { ProfileResponse } from '../../../../shared/types/profiles'
import { requireAuth } from '../../../utils/api-response'
import { validateParam } from '../../../utils/validation'
import { getServerSupabaseClient } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  requireAuth(event)

  // 驗證 ID 參數
  const rawId = getRouterParam(event, 'id')
  const { id } = validateParam({ id: rawId }, profileIdParamSchema)

  const client = getServerSupabaseClient()

  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, avatar_url, role, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === 'PGRST116' ? 404 : 500,
      message: error.code === 'PGRST116' ? '找不到指定的 Profile' : `查詢失敗：${error.message}`,
    })
  }

  return { data }
})
