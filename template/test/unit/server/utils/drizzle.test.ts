import { describe, it, expect, vi, afterEach, beforeEach } from 'vite-plus/test'

const { mockEnd, mockPostgres, mockDrizzle } = vi.hoisted(() => {
  const hoistedMockEnd = vi.fn(async () => {})

  return {
    mockEnd: hoistedMockEnd,
    mockPostgres: vi.fn(() => ({ end: hoistedMockEnd })),
    mockDrizzle: vi.fn((client: unknown) => ({ client })),
  }
})

vi.mock('postgres', () => ({
  default: mockPostgres,
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: mockDrizzle,
}))

import { closeAdminDrizzle, useAdminDrizzle } from '../../../../server/utils/drizzle'

const VALID_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'

function poolOptions(callIndex = 0) {
  return mockPostgres.mock.calls[callIndex]?.[1] as
    | { max: number; idle_timeout: number; connect_timeout: number; prepare: boolean }
    | undefined
}

describe('drizzle utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ADMIN_DATABASE_URL
    delete process.env.DATABASE_URL
    delete process.env.DATABASE_POOL_MAX
  })

  afterEach(async () => {
    await closeAdminDrizzle()
  })

  it('should reuse one connection pool across calls', () => {
    process.env.DATABASE_URL = VALID_URL

    const first = useAdminDrizzle()
    const second = useAdminDrizzle()

    expect(first).toBe(second)
    expect(mockPostgres).toHaveBeenCalledTimes(1)
  })

  it('should prefer ADMIN_DATABASE_URL when available', () => {
    process.env.ADMIN_DATABASE_URL = 'postgres://admin:secret@127.0.0.1:6543/postgres'
    process.env.DATABASE_URL = VALID_URL

    useAdminDrizzle()

    expect(mockPostgres).toHaveBeenCalledWith(
      process.env.ADMIN_DATABASE_URL,
      expect.objectContaining({ prepare: false }),
    )
  })

  it('should fallback to DATABASE_URL', () => {
    process.env.DATABASE_URL = VALID_URL

    useAdminDrizzle()

    expect(mockPostgres).toHaveBeenCalledWith(
      VALID_URL,
      expect.objectContaining({ prepare: false }),
    )
  })

  it('should default the pool to more than one connection', () => {
    process.env.DATABASE_URL = VALID_URL

    useAdminDrizzle()

    expect(poolOptions()?.max).toBe(10)
    expect(poolOptions()?.idle_timeout).toBe(30)
    expect(poolOptions()?.connect_timeout).toBe(10)
  })

  it('should honour DATABASE_POOL_MAX', () => {
    process.env.DATABASE_URL = VALID_URL
    process.env.DATABASE_POOL_MAX = '4'

    useAdminDrizzle()

    expect(poolOptions()?.max).toBe(4)
  })

  it('should reject an invalid DATABASE_POOL_MAX instead of silently falling back', () => {
    process.env.DATABASE_URL = VALID_URL
    process.env.DATABASE_POOL_MAX = 'nope'

    expect(() => useAdminDrizzle()).toThrow(/DATABASE_POOL_MAX/)
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it('should throw when no direct database url is configured', () => {
    expect(() => useAdminDrizzle()).toThrow(
      'Missing ADMIN_DATABASE_URL or DATABASE_URL for Drizzle',
    )
  })

  it('should close the pool and rebuild it on the next call', async () => {
    process.env.DATABASE_URL = VALID_URL

    const first = useAdminDrizzle()

    await closeAdminDrizzle()

    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 })

    const second = useAdminDrizzle()

    expect(second).not.toBe(first)
    expect(mockPostgres).toHaveBeenCalledTimes(2)
  })
})
