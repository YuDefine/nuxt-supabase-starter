import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

const { mockEnd, mockClient, mockPostgres, mockDrizzleDb, mockDrizzle } = vi.hoisted(() => {
  const hoistedMockEnd = vi.fn()
  const hoistedMockClient = {
    end: hoistedMockEnd,
  }

  return {
    mockEnd: hoistedMockEnd,
    mockClient: hoistedMockClient,
    mockPostgres: vi.fn(() => hoistedMockClient),
    mockDrizzleDb: { query: vi.fn() },
    mockDrizzle: vi.fn(() => ({ query: vi.fn() })),
  }
})

mockDrizzle.mockImplementation(() => mockDrizzleDb)

vi.mock('postgres', () => ({
  default: mockPostgres,
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: mockDrizzle,
}))

import { createAdminDrizzle, withAdminDrizzle } from '../../../../server/utils/drizzle'

describe('drizzle utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ADMIN_DATABASE_URL
    delete process.env.DATABASE_URL
  })

  it('should prefer ADMIN_DATABASE_URL when available', () => {
    process.env.ADMIN_DATABASE_URL = 'postgres://admin:secret@127.0.0.1:6543/postgres'
    process.env.DATABASE_URL = 'postgres://fallback@127.0.0.1:54322/postgres'

    const result = createAdminDrizzle()

    expect(mockPostgres).toHaveBeenCalledWith(process.env.ADMIN_DATABASE_URL, {
      prepare: false,
      max: 1,
    })
    expect(mockDrizzle).toHaveBeenCalledWith(mockClient)
    expect(result.db).toBe(mockDrizzleDb)
  })

  it('should fallback to DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'

    createAdminDrizzle()

    expect(mockPostgres).toHaveBeenCalledWith(process.env.DATABASE_URL, {
      prepare: false,
      max: 1,
    })
  })

  it('should throw when no direct database url is configured', () => {
    expect(() => createAdminDrizzle()).toThrow(
      'Missing ADMIN_DATABASE_URL or DATABASE_URL for Drizzle'
    )
  })

  it('should close the client after withAdminDrizzle completes', async () => {
    process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'
    const run = vi.fn(async () => 'ok')

    const result = await withAdminDrizzle(run)

    expect(run).toHaveBeenCalledWith({
      client: mockClient,
      db: mockDrizzleDb,
    })
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 })
    expect(result).toBe('ok')
  })
})
