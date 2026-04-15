import { describe, expect, it } from 'vitest'

describe('Vue unresolved component warning guard', () => {
  it('should throw when Vue reports unresolved component warning', () => {
    expect(() => {
      console.warn('[Vue warn]: Failed to resolve component: MissingComponent')
    }).toThrow(/Failed to resolve component/)
  })

  it('should not throw for unrelated warnings', () => {
    expect(() => {
      console.warn('This is an unrelated warning')
    }).not.toThrow()
  })
})
