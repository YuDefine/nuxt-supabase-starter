// clade-legacy-test: frozen=2026-09-28 — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（clade-spec-workflow/rules/legacy-tests.md）
import { describe, it, expect } from 'vite-plus/test'

describe('Example', () => {
  it('should pass', () => {
    expect(true).toBe(true)
  })
})
