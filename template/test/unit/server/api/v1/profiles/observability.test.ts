import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createRequestLogger, initLogger } from 'evlog'
import { createError as createHttpError } from 'h3'

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  getQuery: () => ({}),
  getRouterParam: () => 'profile-1',
}))

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  // TD-026 D3：非本人存取的 admin 判定改走 getDbRole；測試預設 DB 角色為 user
  getDbRole: vi.fn(async () => 'user'),
  getAuthedSupabase: vi.fn(),
  validateQuery: vi.fn(),
  validateParam: vi.fn(),
}))

vi.mock('../../../../../../server/utils/api-response', () => ({
  requireAuth: mocks.requireAuth,
  requireRole: mocks.requireRole,
  getDbRole: mocks.getDbRole,
  createPaginatedResponse: (data: unknown, pagination: unknown) => ({ data, pagination }),
}))
vi.mock('../../../../../../server/utils/supabase', () => ({
  getAuthedSupabase: mocks.getAuthedSupabase,
}))
vi.mock('../../../../../../server/utils/validation', () => ({
  validateQuery: mocks.validateQuery,
  validateParam: mocks.validateParam,
}))
vi.mock('../../../../../../shared/schemas/profiles', () => ({
  profileIdParamSchema: {},
  profileListQuerySchema: {},
  profileResponseSchema: { parse: (value: unknown) => value },
  profileListResponseSchema: { parse: (value: unknown) => value },
}))

import listProfiles from '../../../../../../server/api/v1/profiles/index.get'
import getProfile from '../../../../../../server/api/v1/profiles/[id].get'
import getMyProfile from '../../../../../../server/api/v1/profiles/me.get'

describe('profile request observability', () => {
  const user = { id: 'profile-1', role: 'admin' }
  const event = { context: { session: { user } } } as any
  let log: ReturnType<typeof createRequestLogger>

  function givenProfileResult(data: unknown, error: Error | null = null) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data, error }),
    }
    mocks.getAuthedSupabase.mockReturnValue({ client: { from: () => query }, user })
  }

  function givenListResult(step: 'db-count' | 'db-select', error: Error | null = null) {
    const count = {
      count: 3,
      error: step === 'db-count' ? error : null,
      ilike: vi.fn().mockReturnThis(),
    }
    const rows = { data: [{ id: user.id }], error: step === 'db-select' ? error : null }
    const dataQuery = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue(rows),
    }
    mocks.getAuthedSupabase.mockReturnValue({
      client: {
        from: vi
          .fn()
          .mockReturnValueOnce({ select: () => count })
          .mockReturnValueOnce(dataQuery),
      },
      user,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    initLogger({ enabled: true, pretty: false, sampling: { rates: { info: 100, error: 100 } } })
    log = createRequestLogger({ method: 'GET', path: '/api/v1/profiles' })
    vi.stubGlobal('useLogger', () => log)
    mocks.requireAuth.mockReturnValue(user)
    mocks.validateParam.mockReturnValue({ id: user.id })
    mocks.validateQuery.mockReturnValue({ page: 2, perPage: 10, search: 'private search text' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('records pagination without copying the raw search term into the event', async () => {
    givenListResult('db-select')

    await listProfiles(event)

    expect(log.getContext()).toMatchObject({
      operation: 'profiles.list',
      pagination: { page: 2, perPage: 10 },
      filtered: true,
    })
    expect(JSON.stringify(log.getContext())).not.toContain('private search text')
  })

  it.each([
    { handler: getProfile, operation: 'profiles.get' },
    { handler: getMyProfile, operation: 'profiles.me' },
  ])('records the target for $operation', async ({ handler, operation }) => {
    givenProfileResult({ id: user.id })

    await handler(event)

    expect(log.getContext()).toMatchObject({ operation, profileId: user.id })
  })

  it.each(['db-count', 'db-select'] as const)(
    'preserves the %s failure in the HTTP error and NDJSON event',
    async (step) => {
      const cause = new Error('private database diagnostics')
      givenListResult(step, cause)
      const output = vi.spyOn(console, 'error').mockImplementation(() => {})

      const error = await listProfiles(event).catch((failure: unknown) => failure)
      const responseError = createHttpError(error as Error)
      log.emit()

      expect(responseError).toMatchObject({
        statusCode: 500,
        statusMessage: '查詢失敗，請稍後再試',
        data: { why: expect.any(String), fix: expect.any(String) },
        cause,
      })
      expect(JSON.stringify(responseError.toJSON())).not.toContain(cause.message)
      const emitted = JSON.parse(String(output.mock.calls.at(-1)?.[0]))
      expect(emitted).toMatchObject({
        operation: 'profiles.list',
        step,
        error: { why: responseError.data.why, fix: responseError.data.fix },
      })
      output.mockRestore()
    },
  )

  it.each([getProfile, getMyProfile])('preserves a profile database failure', async (handler) => {
    const cause = new Error('private database diagnostics')
    givenProfileResult(null, cause)

    const error = await handler(event).catch((failure: unknown) => failure)

    expect(createHttpError(error as Error)).toMatchObject({
      statusCode: 500,
      data: { why: expect.any(String), fix: expect.any(String) },
      cause,
    })
    expect(log.getContext()).toMatchObject({
      error: { why: expect.any(String), fix: expect.any(String) },
    })
  })

  it('uses the same public error for absent and inaccessible profiles', async () => {
    givenProfileResult(null, Object.assign(new Error('no rows'), { code: 'PGRST116' }))
    const absent = await getProfile(event).catch((failure: unknown) => failure)
    mocks.requireAuth.mockReturnValue({ id: 'another-user', role: 'member' })
    const inaccessible = await getProfile(event).catch((failure: unknown) => failure)

    expect(createHttpError(absent as Error).toJSON()).toEqual(
      createHttpError(inaccessible as Error).toJSON(),
    )
    expect(createHttpError(inaccessible as Error)).toMatchObject({
      statusCode: 404,
      data: { why: expect.any(String), fix: expect.any(String) },
    })
  })
})
