/**
 * GET /api/v1/profiles/me — 取得當前登入使用者的 Profile
 *
 * 需要登入。
 *
 * @module server/api/v1/profiles/me.get
 */

import { defineEventHandler } from 'h3'
import { createError } from 'evlog'
import { profileResponseSchema, type ProfileResponse } from '#shared/schemas/profiles'
import { requireAuth } from '../../../utils/api-response'
import { PGRST_NOT_FOUND } from '../../../utils/db-errors'
import { PROFILE_SELECT_FIELDS } from '../../../utils/profile-fields'
import { getAuthedSupabase } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileResponse> => {
  const log = useLogger(event)
  log.set({ operation: 'profiles.me' })
  const user = requireAuth(event)
  log.set({ profileId: user.id })

  const { client } = getAuthedSupabase(event)

  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .eq('id', user.id)
    .single()

  if (error) {
    const notFound = error.code === PGRST_NOT_FOUND
    const failure = createError({
      status: notFound ? 404 : 500,
      message: notFound ? '找不到您的 Profile' : '查詢失敗，請稍後再試',
      why: notFound
        ? '目前帳號尚未有可讀取的個人資料。'
        : '資料服務回傳讀取錯誤，無法取得查詢結果。',
      fix: notFound
        ? '請聯絡系統管理員確認帳號的個人資料已建立。'
        : '請聯絡系統管理員並提供這次請求的時間。',
      cause: error as Error,
    })
    // PGRST116 (404) 是預期錯誤，不需要 log.error
    if (!notFound) {
      log.error(failure, { step: 'db-select' })
    }
    throw failure
  }

  return profileResponseSchema.parse({ data })
})
