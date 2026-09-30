import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createRequestLogger, initLogger } from 'evlog'
import { createError as createHttpError } from 'h3'

const mocks = vi.hoisted(() => ({
  readValidatedBody: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  appendResponseHeader: vi.fn(),
}))

vi.hoisted(() => {
  Object.assign(globalThis, {
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: Parameters<typeof createHttpError>[0]) => createHttpError(options),
    readValidatedBody: mocks.readValidatedBody,
    appendResponseHeader: mocks.appendResponseHeader,
    serverAuth: () => ({ api: mocks }),
  })
})

import handler from '../../../../../server/api/_dev/login.post'

describe('dev-login observability', () => {
  const email = 'fixture@test.local'
  const password = 'never-log-this-password'
  const event = { context: {} } as any
  let log: ReturnType<typeof createRequestLogger>

  function givenAuthResponse(status = 200) {
    return new Response(JSON.stringify({ user: { id: 'fixture-user', email } }), {
      status,
      headers: { 'set-cookie': 'session=secret-cookie; HttpOnly' },
    })
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('ADMIN_EMAIL_ALLOWLIST', '')
    vi.stubEnv('DEV_LOGIN_EMAIL_DOMAINS', '')
    vi.stubEnv('NUXT_DEV_LOGIN_PASSWORD', '')
    initLogger({ enabled: true, pretty: false, sampling: { rates: { info: 0, error: 100 } } })
    log = createRequestLogger({ method: 'POST', path: '/api/_dev/login' })
    vi.stubGlobal('useLogger', () => log)
    mocks.readValidatedBody.mockResolvedValue({ email, password })
    mocks.signInEmail.mockResolvedValue(givenAuthResponse())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['signed_in', 'created_and_signed_in'] as const)(
    'emits an unsampled audit for %s without credentials',
    async (action) => {
      if (action === 'created_and_signed_in') {
        mocks.signInEmail.mockResolvedValue(givenAuthResponse(401))
        mocks.signUpEmail.mockResolvedValue(givenAuthResponse())
      }
      const output = vi.spyOn(console, 'info').mockImplementation(() => {})

      const response = await handler(event)
      log.emit()

      expect(response).toMatchObject({ success: true, action, user: { id: 'fixture-user' } })
      expect(mocks.appendResponseHeader).toHaveBeenCalledWith(
        event,
        'set-cookie',
        'session=secret-cookie; HttpOnly',
      )
      const ndjson = String(output.mock.calls.at(-1)?.[0])
      expect(JSON.parse(ndjson)).toMatchObject({
        operation: 'auth.dev_login',
        auth: { action, role: 'member', userId: 'fixture-user' },
        audit: {
          action: 'auth.dev_login',
          actor: { type: 'user', id: 'fixture-user' },
          target: { type: 'user', id: 'fixture-user' },
          outcome: 'success',
        },
      })
      expect(ndjson).not.toContain(password)
      expect(ndjson).not.toContain('secret-cookie')
      expect(ndjson).not.toContain(email)
    },
  )

  it.each([
    { body: { email, password, as: 'admin' }, statusCode: 400 },
    { body: { email: 'outsider@example.com', password }, statusCode: 401 },
  ])('audits an authorization denial ($statusCode)', async ({ body, statusCode }) => {
    mocks.readValidatedBody.mockResolvedValue(body)
    mocks.signInEmail.mockResolvedValue(givenAuthResponse(401))

    const error = await handler(event).catch((failure: unknown) => failure)

    expect(createHttpError(error as Error)).toMatchObject({
      statusCode,
      data: { why: expect.any(String), fix: expect.any(String) },
    })
    expect(log.getContext()).toMatchObject({
      audit: { action: 'auth.dev_login', outcome: 'denied' },
    })
    expect(mocks.signUpEmail).not.toHaveBeenCalled()
  })

  it('audits an upstream failure and preserves its cause', async () => {
    const cause = new Error('upstream unavailable')
    mocks.signInEmail.mockRejectedValue(cause)
    mocks.signUpEmail.mockRejectedValue(cause)

    await expect(handler(event)).rejects.toBe(cause)

    expect(log.getContext()).toMatchObject({
      audit: { action: 'auth.dev_login', outcome: 'failure' },
      error: { message: cause.message },
    })
  })

  it('returns actionable details for a missing development password', async () => {
    mocks.readValidatedBody.mockResolvedValue({ email })

    const error = await handler(event).catch((failure: unknown) => failure)

    expect(createHttpError(error as Error)).toMatchObject({
      statusCode: 500,
      data: { why: expect.any(String), fix: expect.any(String) },
    })
    expect(mocks.signInEmail).not.toHaveBeenCalled()
    expect(log.getContext()).toMatchObject({ audit: { outcome: 'failure' } })
  })
})
