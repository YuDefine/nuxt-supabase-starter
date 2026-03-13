import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateBody, validateParam, validateQuery } from '../../../../server/utils/validation'

describe('validation', () => {
  describe('validateBody', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
    })

    it('should return parsed data for valid input', () => {
      const body = { name: 'Alice', age: 30 }
      const result = validateBody(body, schema)

      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('should throw 400 for invalid input', () => {
      const body = { name: '', age: -1 }

      expect(() => validateBody(body, schema)).toThrow()
    })

    it('should throw with validation error details', () => {
      const body = { name: 123, age: 'not a number' }

      try {
        validateBody(body, schema)
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.statusCode).toBe(400)
        expect(error.data?.issues).toBeDefined()
      }
    })

    it('should strip unknown properties', () => {
      const body = { name: 'Alice', age: 30, extra: 'field' }
      const result = validateBody(body, schema)

      expect(result).toEqual({ name: 'Alice', age: 30 })
      expect((result as any).extra).toBeUndefined()
    })
  })

  describe('validateQuery', () => {
    const schema = z.object({
      page: z.coerce.number().int().positive().default(1),
      perPage: z.coerce.number().int().positive().max(100).default(20),
    })

    it('should return parsed data for valid query', () => {
      const query = { page: '2', perPage: '50' }
      const result = validateQuery(query, schema)

      expect(result).toEqual({ page: 2, perPage: 50 })
    })

    it('should apply default values', () => {
      const query = {}
      const result = validateQuery(query, schema)

      expect(result).toEqual({ page: 1, perPage: 20 })
    })

    it('should throw 400 for invalid query', () => {
      const query = { page: 'abc', perPage: '200' }

      expect(() => validateQuery(query, schema)).toThrow()
    })

    it('should throw with validation error details', () => {
      const query = { page: '-1' }

      try {
        validateQuery(query, schema)
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.statusCode).toBe(400)
        expect(error.data?.issues).toBeDefined()
      }
    })
  })

  describe('validateParam', () => {
    const schema = z.object({
      id: z.string().uuid(),
    })

    it('should return parsed data for valid param', () => {
      const param = { id: '550e8400-e29b-41d4-a716-446655440000' }
      const result = validateParam(param, schema)

      expect(result).toEqual({ id: '550e8400-e29b-41d4-a716-446655440000' })
    })

    it('should throw 400 for invalid param', () => {
      const param = { id: 'not-a-uuid' }
      expect(() => validateParam(param, schema)).toThrow()
    })
  })
})
