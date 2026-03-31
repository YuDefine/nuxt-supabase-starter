/**
 * PostgREST 查詢安全工具
 *
 * 清除使用者輸入中可能干擾 PostgREST filter 語法的特殊字元。
 */

/** 移除 PostgREST filter 語法字元（,.(）) 和 ILIKE 萬用字元（%_） */
const POSTGREST_SPECIAL_CHARS = /[,.()%_]/g

export function sanitizePostgrestSearch(input: string): string {
  return input.replace(POSTGREST_SPECIAL_CHARS, '')
}
