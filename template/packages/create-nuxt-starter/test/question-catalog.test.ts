import { describe, expect, it } from 'vitest'
import { applicableQuestions, usesSupabaseDatabase } from '../src/question-catalog'

describe('applicableQuestions', () => {
  it('Supabase 軌一定問資料庫跑在哪與要不要登記', () => {
    const ids = applicableQuestions({ hasSupabase: true, register: false }).map((q) => q.id)
    expect(ids).toEqual(['db-host', 'register-fleet'])
  })

  it('選了登記才問 GitHub / 流程 / 階段 / port / 上線', () => {
    const ids = applicableQuestions({ hasSupabase: true, register: true }).map((q) => q.id)
    expect(ids).toEqual([
      'db-host',
      'register-fleet',
      'repo-id',
      'workflow-model',
      'business-activity',
      'dev-port',
      'deploy-track',
    ])
  })

  it('沒有 Supabase 時不問 db-host', () => {
    const ids = applicableQuestions({ hasSupabase: false, register: false }).map((q) => q.id)
    expect(ids).toEqual(['register-fleet'])
  })
})

describe('usesSupabaseDatabase', () => {
  it('要 stack 是 supabase 且有 database feature', () => {
    expect(usesSupabaseDatabase('supabase', ['database'])).toBe(true)
    expect(usesSupabaseDatabase('supabase', ['ui'])).toBe(false)
    expect(usesSupabaseDatabase('nuxthub-d1', ['database'])).toBe(false)
  })
})
