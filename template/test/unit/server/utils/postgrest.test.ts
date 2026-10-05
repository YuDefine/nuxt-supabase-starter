import { describe, expect, it } from 'vite-plus/test'

import { sanitizePostgrestSearch } from '../../../../server/utils/postgrest'

// TD-026 D2：search 直接插進 PostgREST ilike pattern，`%`、`_` 會變萬用字元，
// `,.()` 是 PostgREST filter 語法字元。sanitize 後這些字元必須被移除，
// 使 search 永遠當純文字比對。
describe('sanitizePostgrestSearch', () => {
  it('removes ILIKE wildcard characters % and _', () => {
    expect(sanitizePostgrestSearch('100%')).toBe('100')
    expect(sanitizePostgrestSearch('a_b')).toBe('ab')
    expect(sanitizePostgrestSearch('%_%')).toBe('')
  })

  it('removes PostgREST filter syntax characters', () => {
    expect(sanitizePostgrestSearch('a,b.c(d)e)f')).toBe('abcdef')
  })

  it('keeps ordinary text intact', () => {
    expect(sanitizePostgrestSearch('測試 使用者-A1')).toBe('測試 使用者-A1')
  })

  it('returns empty string for input that is only special characters', () => {
    expect(sanitizePostgrestSearch('%,._()')).toBe('')
  })
})
