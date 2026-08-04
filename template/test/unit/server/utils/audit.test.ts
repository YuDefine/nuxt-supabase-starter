import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

// Mock @supabase/supabase-js — same approach as supabase.test.ts
const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({ insert: mockInsert }))
const mockClient = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}))

// Must import after mock
import { createAuditLog } from '../../../../server/utils/audit'

describe('createAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set required env vars so getServerSupabaseClient doesn't throw
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'test-service-key'
    // Reset mock return values
    mockFrom.mockReturnValue({ insert: mockInsert })
    mockInsert.mockResolvedValue({ error: null })
  })

  it('should insert an audit log with correct arguments', async () => {
    await createAuditLog({
      userId: 'user-123',
      action: 'create',
      entityType: 'post',
      entityId: 'post-456',
    })

    expect(mockFrom).toHaveBeenCalledWith('audit_logs')
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-123',
      action: 'create',
      entity_type: 'post',
      entity_id: 'post-456',
      changes: null,
      metadata: null,
    })
  })

  it('should pass changes and metadata when provided', async () => {
    const changes = { title: { old: 'Draft', new: 'Published' } }
    const metadata = { ip: '127.0.0.1', userAgent: 'test-agent' }

    await createAuditLog({
      userId: 'user-789',
      action: 'update',
      entityType: 'article',
      entityId: 'article-100',
      changes,
      metadata,
    })

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-789',
      action: 'update',
      entity_type: 'article',
      entity_id: 'article-100',
      changes,
      metadata,
    })
  })

  it('should not throw when insert rejects (fire-and-forget)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInsert.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(
      createAuditLog({
        action: 'delete',
        entityType: 'comment',
        entityId: 'comment-999',
      }),
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[audit] Failed to create audit log:',
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('should report a resolved { error } instead of silently succeeding', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // PostgREST 的 DB 層錯誤（RLS 拒絕、table 不存在、欄位不符、constraint 違反）
    // 走的是 resolve 而非 reject — 上面那條 rejects 測試完全覆蓋不到這條路徑，
    // 而這才是實務上最常發生的失敗形態。稽核記錄無聲丟失正是從這裡開始。
    mockInsert.mockResolvedValueOnce({
      error: { code: '42P01', message: 'relation "audit_logs" does not exist' },
    })

    await expect(
      createAuditLog({
        action: 'delete',
        entityType: 'comment',
        entityId: 'comment-999',
      }),
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[audit] Failed to create audit log:',
      expect.objectContaining({ code: '42P01' }),
    )

    consoleErrorSpy.mockRestore()
  })

  it('should allow userId to be undefined', async () => {
    await createAuditLog({
      action: 'system_cleanup',
      entityType: 'session',
      entityId: 'session-expired',
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: undefined,
        action: 'system_cleanup',
      }),
    )
  })
})
