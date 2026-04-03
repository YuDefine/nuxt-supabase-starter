/**
 * Zod 驗證 wrapper
 *
 * 提供 request body 與 query 參數的驗證 helper，
 * 驗證失敗時拋出結構化的 400 錯誤。
 *
 * @module server/utils/validation
 */

import { createError } from 'h3'
import type { ZodType, ZodIssue } from 'zod'

interface ValidationError {
  statusCode: number
  message: string
  data: {
    issues: ZodIssue[]
  }
}

/**
 * 驗證 request body
 *
 * @throws 400 - 驗證失敗（含 issues 詳情）
 */
export function validateBody<T>(body: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(body)

  if (!result.success) {
    const error: ValidationError = {
      statusCode: 400,
      message: '請求資料驗證失敗',
      data: {
        issues: result.error.issues,
      },
    }
    throw createError(error)
  }

  return result.data
}

/**
 * 驗證 query 參數
 *
 * @throws 400 - 驗證失敗（含 issues 詳情）
 */
export function validateQuery<T>(query: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(query)

  if (!result.success) {
    const error: ValidationError = {
      statusCode: 400,
      message: '查詢參數驗證失敗',
      data: {
        issues: result.error.issues,
      },
    }
    throw createError(error)
  }

  return result.data
}

/**
 * 驗證路由參數
 *
 * @throws 400 - 驗證失敗（含 issues 詳情）
 */
export function validateParam<T>(param: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(param)

  if (!result.success) {
    const error: ValidationError = {
      statusCode: 400,
      message: '路由參數驗證失敗',
      data: {
        issues: result.error.issues,
      },
    }
    throw createError(error)
  }

  return result.data
}
