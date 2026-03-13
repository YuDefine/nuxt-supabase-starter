/**
 * PostgreSQL 錯誤碼對應與結構化錯誤處理
 *
 * 將 PostgreSQL 錯誤碼映射至 HTTP 狀態碼與使用者友善訊息。
 *
 * @module server/utils/db-errors
 */

export interface DbErrorResult {
  statusCode: number
  message: string
  why: string
  fix: string
}

interface PgErrorMapping {
  statusCode: number
  why: string
  fix: string
}

const PG_ERROR_MAP: Record<string, PgErrorMapping> = {
  '23505': {
    statusCode: 409,
    why: 'unique_violation',
    fix: '請確認資料沒有重複，或使用不同的值',
  },
  '23503': {
    statusCode: 400,
    why: 'foreign_key_violation',
    fix: '參照的資料不存在，請確認關聯資料是否正確',
  },
  '23502': {
    statusCode: 400,
    why: 'not_null_violation',
    fix: '必填欄位不可為空，請提供所有必要資料',
  },
  '23514': {
    statusCode: 400,
    why: 'check_violation',
    fix: '資料不符合驗證規則，請檢查輸入值',
  },
  '42501': {
    statusCode: 403,
    why: 'insufficient_privilege',
    fix: '權限不足，請確認使用者具有正確的存取權限',
  },
  '42P01': {
    statusCode: 500,
    why: 'undefined_table',
    fix: '資料表不存在，請聯絡系統管理員',
  },
}

/**
 * 將 PostgreSQL / PostgREST 錯誤轉為結構化的錯誤回應
 */
export function handleDbError(error: { code?: string; message?: string }): DbErrorResult {
  const code = error.code ?? ''
  const message = error.message ?? '未知的資料庫錯誤'

  // Check PostgREST errors (PGRST prefix)
  if (code.startsWith('PGRST')) {
    return {
      statusCode: 400,
      message,
      why: 'postgrest_error',
      fix: '請檢查 API 請求參數是否正確',
    }
  }

  // Check known PG error codes
  const mapping = PG_ERROR_MAP[code]
  if (mapping) {
    return {
      statusCode: mapping.statusCode,
      message,
      why: mapping.why,
      fix: mapping.fix,
    }
  }

  // Unknown error
  return {
    statusCode: 500,
    message,
    why: 'unknown_db_error',
    fix: '發生未預期的資料庫錯誤，請稍後再試或聯絡系統管理員',
  }
}

/**
 * 根據 constraint name 取得自訂的領域語言訊息
 *
 * @param constraintName - PostgreSQL constraint name (e.g. "users_email_key")
 * @param customMap - constraint name 到自訂訊息的映射表
 * @returns 自訂訊息，若 constraint 未在映射表中則回傳 undefined
 */
export function mapConstraintMessage(
  constraintName: string,
  customMap?: Record<string, string>
): string | undefined {
  if (!customMap) {
    return undefined
  }
  return customMap[constraintName]
}
