import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

// 這支 handler 用 Nuxt auto-import（defineEventHandler / createError / serverAuth
// 都沒有 import 語句），所以它們是 global 而非模組 — vi.mock 幫不上忙。
// 而 ESM 的 import 會被 hoist 到檔案最上方，普通的 vi.stubGlobal 會比 handler
// 的 module evaluation 晚執行，於是 module 載入當場 ReferenceError。
// vi.hoisted 是唯一能在 import 之前跑到的地方。
const mocks = vi.hoisted(() => {
  const signInEmail = vi.fn()
  const signUpEmail = vi.fn()

  const g = globalThis as any
  g.defineEventHandler = (handler: any) => handler
  g.createError = (opts: any) => {
    const error = new Error(opts.message ?? opts.statusMessage) as any
    error.statusCode = opts.statusCode
    return error
  }
  g.readValidatedBody = vi.fn()
  g.appendResponseHeader = vi.fn()
  g.serverAuth = () => ({ api: { signInEmail, signUpEmail } })

  return { signInEmail, signUpEmail }
})

import handler, {
  DEFAULT_DEV_LOGIN_DOMAINS,
  assertSignUpAllowed,
  parseCsv,
  resolveDevLoginRole,
} from '../../../../../server/api/_dev/login.post'

describe('dev-login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // handler 本體只能測到 production guard：`import.meta.dev` 被 vite 在 transform
  // 階段替換成 literal false，test 內無法改寫它，所以 dev 分支進不去。
  // 授權判定因此獨立成 exported 純函式，在下面直接測 —— 那也是它們該被測的層級。
  describe('production guard', () => {
    it('should throw 404 outside dev, before touching auth', async () => {
      await expect(handler({ context: {} } as any)).rejects.toMatchObject({ statusCode: 404 })

      // 404 而非 403：403 等於承認這條路由存在。
      expect(mocks.signInEmail).not.toHaveBeenCalled()
      expect(mocks.signUpEmail).not.toHaveBeenCalled()
    })
  })

  describe('parseCsv', () => {
    it('should trim, lowercase, and drop empties', () => {
      expect(parseCsv(' A@test.local , b@test.local ,, ')).toEqual(['a@test.local', 'b@test.local'])
    })

    it('should return an empty list for undefined', () => {
      expect(parseCsv(undefined)).toEqual([])
    })
  })

  describe('resolveDevLoginRole', () => {
    const allowlist = ['e2e-admin@test.local']

    it('should reject as=admin when the email is not allowlisted', () => {
      expect(() =>
        resolveDevLoginRole({
          as: 'admin',
          email: 'nobody@test.local',
          adminEmailAllowlist: allowlist,
        }),
      ).toThrow(/ADMIN_EMAIL_ALLOWLIST/)
    })

    it('should allow as=admin for an allowlisted email', () => {
      expect(
        resolveDevLoginRole({
          as: 'admin',
          email: 'e2e-admin@test.local',
          adminEmailAllowlist: allowlist,
        }),
      ).toBe('admin')
    })

    it('should match the allowlist case-insensitively', () => {
      expect(
        resolveDevLoginRole({
          as: 'admin',
          email: 'E2E-Admin@Test.Local',
          adminEmailAllowlist: allowlist,
        }),
      ).toBe('admin')
    })

    it('should default a non-allowlisted email to member', () => {
      expect(
        resolveDevLoginRole({ email: 'someone@test.local', adminEmailAllowlist: allowlist }),
      ).toBe('member')
    })

    it('should promote an allowlisted email to admin without as', () => {
      expect(
        resolveDevLoginRole({ email: 'e2e-admin@test.local', adminEmailAllowlist: allowlist }),
      ).toBe('admin')
    })

    it('should honour an explicit non-admin as', () => {
      expect(
        resolveDevLoginRole({
          as: 'guest',
          email: 'someone@test.local',
          adminEmailAllowlist: allowlist,
        }),
      ).toBe('guest')
    })
  })

  describe('assertSignUpAllowed', () => {
    it('should allow an allowlisted domain', () => {
      expect(() => assertSignUpAllowed('brand-new@test.local', ['test.local'])).not.toThrow()
    })

    it('should refuse a domain outside the allowlist', () => {
      // 這是本次修復關掉的洞：signIn 失敗即無條件 signUp，等於任何能連到 dev
      // server 的人都能用自選密碼替任意 email 開帳號並拿到 session cookie。
      expect(() => assertSignUpAllowed('outsider@example.com', ['test.local'])).toThrow(
        /domain not in DEV_LOGIN_EMAIL_DOMAINS/,
      )
    })

    it('should throw 401', () => {
      let caught: any
      try {
        assertSignUpAllowed('outsider@example.com', ['test.local'])
      } catch (error) {
        caught = error
      }
      expect(caught?.statusCode).toBe(401)
    })

    it('should compare the domain case-insensitively', () => {
      expect(() => assertSignUpAllowed('New@TEST.LOCAL', ['test.local'])).not.toThrow()
    })

    it('should refuse an email with no domain part', () => {
      expect(() => assertSignUpAllowed('not-an-email', ['test.local'])).toThrow()
    })

    it('should refuse everything when the allowlist is empty', () => {
      expect(() => assertSignUpAllowed('anyone@test.local', [])).toThrow()
    })

    it('should cover the e2e fixture domain by default', () => {
      // e2e/fixtures 用 e2e-{admin,member,guest}@test.local — 預設值必須涵蓋它們，
      // 否則這道 gate 會在 Playwright setup 就把整套 e2e 打斷。
      expect(() =>
        assertSignUpAllowed('e2e-member@test.local', DEFAULT_DEV_LOGIN_DOMAINS),
      ).not.toThrow()
    })
  })
})
