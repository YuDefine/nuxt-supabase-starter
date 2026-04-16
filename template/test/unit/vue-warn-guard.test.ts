import { describe, expect, it } from 'vitest'

// Vitest 4 provides a module-scoped `console` that differs from `globalThis.console`.
// Our setup-env guard patches `globalThis.console` (which Vue runtime uses).
// Tests must reference `globalThis.console` to verify the guard.

describe('Vue unresolved component warning guard', () => {
  it('should throw when Vue reports unresolved component warning', () => {
    expect(() => {
      globalThis.console.warn('[Vue warn]: Failed to resolve component: MissingComponent')
    }).toThrow(/Failed to resolve component/)
  })

  it('should not throw for unrelated warnings', () => {
    expect(() => {
      globalThis.console.warn('This is an unrelated warning')
    }).not.toThrow()
  })
})
