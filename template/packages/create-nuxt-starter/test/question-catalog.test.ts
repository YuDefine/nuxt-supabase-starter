import { describe, expect, it } from 'vitest'
import {
  applicableQuestions,
  flagsPresent,
  missingYesFlags,
  usesSupabaseDatabase,
} from '../src/question-catalog'

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

describe('missingYesFlags', () => {
  it('要登記時 --yes 不能略過 repo / 流程 / port / 上線', () => {
    const missing = missingYesFlags({
      hasSupabase: true,
      register: true,
      present: new Set(['--db-host']),
    }).map((q) => q.id)
    expect(missing).toEqual([
      'repo-id',
      'workflow-model',
      'business-activity',
      'dev-port',
      'deploy-track',
    ])
  })

  it('--no-register-consumer 時只要求 db-host', () => {
    const missing = missingYesFlags({
      hasSupabase: true,
      register: false,
      present: new Set(['--db-host', '--no-register-consumer']),
    }).map((q) => q.id)
    expect(missing).toEqual([])
  })

  it('flagsPresent 吃 --flag=value', () => {
    expect([...flagsPresent(['node', 'cli.js', '--dev-port=3090', '--repo-id', 'a/b'])]).toEqual([
      '--dev-port',
      '--repo-id',
    ])
  })
})

describe('usesSupabaseDatabase', () => {
  it('要 stack 是 supabase 且有 database feature', () => {
    expect(usesSupabaseDatabase('supabase', ['database'])).toBe(true)
    expect(usesSupabaseDatabase('supabase', ['ui'])).toBe(false)
    expect(usesSupabaseDatabase('nuxthub-d1', ['database'])).toBe(false)
  })
})
