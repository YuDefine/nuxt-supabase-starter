/**
 * GET /api/v1/profiles — Profile 列表 + 分頁 + 搜尋
 *
 * 需要 admin 角色。支援 search query 對 display_name 進行模糊搜尋。
 *
 * @module server/api/v1/profiles/index.get
 */

import { createError, defineEventHandler, getQuery } from 'h3'
import { profileListQuerySchema } from '#shared/schemas/profiles'
import type { ProfileListResponse } from '#shared/types/profiles'
import { requireRole, createPaginatedResponse } from '../../../utils/api-response'
import { PROFILE_SELECT_FIELDS } from '../../../utils/profile-fields'
import { validateQuery } from '../../../utils/validation'
import { getServerSupabaseClient } from '../../../utils/supabase'

export default defineEventHandler(async (event): Promise<ProfileListResponse> => {
  // 權限檢查：僅 admin 可查看列表
  requireRole(event, ['admin'])

  // 驗證查詢參數
  const query = validateQuery(getQuery(event), profileListQuerySchema)
  const { page, perPage, search } = query

  const client = getServerSupabaseClient()

  // 建立查詢
  let countQuery = client.from('profiles').select('id', { count: 'exact', head: true })

  let dataQuery = client.from('profiles').select(PROFILE_SELECT_FIELDS)

  // 搜尋條件
  if (search) {
    countQuery = countQuery.ilike('display_name', `%${search}%`)
    dataQuery = dataQuery.ilike('display_name', `%${search}%`)
  }

  // 分頁
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  dataQuery = dataQuery.order('created_at', { ascending: false }).range(from, to)

  // 並行執行 count 和 data 查詢
  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery])

  if (countResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: '查詢失敗，請稍後再試',
    })
  }

  if (dataResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: '查詢失敗，請稍後再試',
    })
  }

  return createPaginatedResponse(dataResult.data, {
    page,
    perPage,
    total: countResult.count ?? 0,
  })
})
