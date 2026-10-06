import { describe, expect, it } from 'vite-plus/test'

import { sanitizePostgrestSearch } from '../../../../server/utils/postgrest'

// TD-026 D2：search 直接插進 PostgREST ilike pattern，`%`、`_`、`*` 會變
// 萬用字元，`\` 是跳脫字元，`,.()` 是 PostgREST filter 語法字元。
// sanitize 後這些字元必須被移除，使 search 永遠當純文字比對。
describe('sanitizePostgrestSearch', () => {
  it('removes ILIKE wildcard characters % and _', () => {
    expect(sanitizePostgrestSearch('100%')).toBe('100')
    expect(sanitizePostgrestSearch('a_b')).toBe('ab')
    expect(sanitizePostgrestSearch('%_%')).toBe('')
  })

  it('removes PostgREST wildcard * and LIKE escape backslash', () => {
    // `*` 在 PostgREST like/ilike 等價 %；`\` 是 LIKE 的 escape 字元，
    // 留在 pattern 裡會吃掉後方的 % 或 _。
    expect(sanitizePostgrestSearch('使*者')).toBe('使者')
    expect(sanitizePostgrestSearch('a\\b')).toBe('ab')
    expect(sanitizePostgrestSearch('*\\')).toBe('')
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
