// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { setup, url } from '@nuxt/test-utils/e2e'

describe('Nuxt CSRF boundary', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    dev: true,
    setupTimeout: 120_000,
  })

  it('passes email sign-in to Better Auth without a nuxt-csurf token', async () => {
    const response = await fetch(url('/api/auth/sign-in/email'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: url('/').replace(/\/$/, ''),
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ email: 'missing@example.test', password: 'invalid-password' }),
    })

    expect(response.status).not.toBe(403)
    expect(await response.text()).not.toContain('CSRF Token Mismatch')
  })

  it('still rejects an unprotected POST outside Better Auth', async () => {
    const pageResponse = await fetch(url('/auth/login'))
    const csrfCookie = pageResponse.headers.get('set-cookie')?.split(';', 1)[0]
    expect(csrfCookie).toBeDefined()

    const response = await fetch(url('/api/_dev/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: csrfCookie! },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('CSRF Token not found')

    const invalidTokenResponse = await fetch(url('/api/_dev/login'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie!,
        'csrf-token': 'invalid-token',
      },
      body: JSON.stringify({}),
    })
    expect(invalidTokenResponse.status).toBe(403)
    expect(await invalidTokenResponse.text()).toContain('CSRF Token invalid')
  })
})
