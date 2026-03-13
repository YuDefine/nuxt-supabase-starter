import { describe, it, expect } from 'vitest'
import {
  profileListQuerySchema,
  profileUpdateBodySchema,
  profileIdParamSchema,
} from '../../../../shared/schemas/profiles'

describe('profiles schemas', () => {
  describe('profileListQuerySchema', () => {
    it('should apply defaults when no params provided', () => {
      const result = profileListQuerySchema.parse({})

      expect(result).toEqual({ page: 1, perPage: 20 })
    })

    it('should coerce string values to numbers', () => {
      const result = profileListQuerySchema.parse({ page: '3', perPage: '50' })

      expect(result).toEqual({ page: 3, perPage: 50 })
    })

    it('should accept optional search param', () => {
      const result = profileListQuerySchema.parse({ search: 'alice' })

      expect(result).toEqual({ page: 1, perPage: 20, search: 'alice' })
    })

    it('should reject perPage greater than 100', () => {
      const result = profileListQuerySchema.safeParse({ perPage: '200' })

      expect(result.success).toBe(false)
    })

    it('should reject non-positive page', () => {
      const result = profileListQuerySchema.safeParse({ page: '0' })

      expect(result.success).toBe(false)
    })

    it('should reject non-integer page', () => {
      const result = profileListQuerySchema.safeParse({ page: '1.5' })

      expect(result.success).toBe(false)
    })
  })

  describe('profileUpdateBodySchema', () => {
    it('should accept valid display_name', () => {
      const result = profileUpdateBodySchema.parse({ display_name: 'Alice' })

      expect(result).toEqual({ display_name: 'Alice' })
    })

    it('should accept valid avatar_url', () => {
      const result = profileUpdateBodySchema.parse({
        avatar_url: 'https://example.com/avatar.png',
      })

      expect(result).toEqual({ avatar_url: 'https://example.com/avatar.png' })
    })

    it('should accept null avatar_url', () => {
      const result = profileUpdateBodySchema.parse({ avatar_url: null })

      expect(result).toEqual({ avatar_url: null })
    })

    it('should accept both fields', () => {
      const result = profileUpdateBodySchema.parse({
        display_name: 'Bob',
        avatar_url: 'https://example.com/bob.png',
      })

      expect(result).toEqual({
        display_name: 'Bob',
        avatar_url: 'https://example.com/bob.png',
      })
    })

    it('should accept empty object', () => {
      const result = profileUpdateBodySchema.parse({})

      expect(result).toEqual({})
    })

    it('should reject empty display_name', () => {
      const result = profileUpdateBodySchema.safeParse({ display_name: '' })

      expect(result.success).toBe(false)
    })

    it('should reject display_name exceeding 100 chars', () => {
      const result = profileUpdateBodySchema.safeParse({
        display_name: 'a'.repeat(101),
      })

      expect(result.success).toBe(false)
    })

    it('should reject invalid avatar_url', () => {
      const result = profileUpdateBodySchema.safeParse({
        avatar_url: 'not-a-url',
      })

      expect(result.success).toBe(false)
    })

    it('should strip unknown properties', () => {
      const result = profileUpdateBodySchema.parse({
        display_name: 'Alice',
        role: 'admin',
      })

      expect(result).toEqual({ display_name: 'Alice' })
      expect((result as any).role).toBeUndefined()
    })
  })

  describe('profileIdParamSchema', () => {
    it('should accept valid UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const result = profileIdParamSchema.parse({ id: uuid })

      expect(result).toEqual({ id: uuid })
    })

    it('should reject non-UUID string', () => {
      const result = profileIdParamSchema.safeParse({ id: 'not-a-uuid' })

      expect(result.success).toBe(false)
    })

    it('should reject missing id', () => {
      const result = profileIdParamSchema.safeParse({})

      expect(result.success).toBe(false)
    })
  })
})
