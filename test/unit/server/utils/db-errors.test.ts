import { describe, it, expect } from 'vite-plus/test'
import { handleDbError, mapConstraintMessage } from '../../../../server/utils/db-errors'

describe('db-errors', () => {
  describe('handleDbError', () => {
    it('should map 23505 (unique_violation) to 409', () => {
      const error = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "users_email_key"',
      }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(409)
      expect(result.why).toBe('unique_violation')
    })

    it('should map 23503 (foreign_key_violation) to 400', () => {
      const error = {
        code: '23503',
        message: 'insert or update on table "orders" violates foreign key constraint',
      }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(400)
      expect(result.why).toBe('foreign_key_violation')
    })

    it('should map 23502 (not_null_violation) to 400', () => {
      const error = { code: '23502', message: 'null value in column "name"' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(400)
      expect(result.why).toBe('not_null_violation')
    })

    it('should map 23514 (check_violation) to 400', () => {
      const error = { code: '23514', message: 'check constraint violated' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(400)
      expect(result.why).toBe('check_violation')
    })

    it('should map 42501 (insufficient_privilege) to 403', () => {
      const error = { code: '42501', message: 'permission denied' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(403)
      expect(result.why).toBe('insufficient_privilege')
    })

    it('should map 42P01 (undefined_table) to 500', () => {
      const error = { code: '42P01', message: 'relation does not exist' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(500)
      expect(result.why).toBe('undefined_table')
    })

    it('should map PGRST (PostgREST) errors to 400', () => {
      const error = { code: 'PGRST116', message: 'no rows returned' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(400)
      expect(result.why).toBe('postgrest_error')
    })

    it('should return 500 for unknown error codes', () => {
      const error = { code: '99999', message: 'something unknown happened' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(500)
      expect(result.why).toBe('unknown_db_error')
    })

    it('should return 500 for errors without a code', () => {
      const error = { message: 'generic error' }
      const result = handleDbError(error)

      expect(result.statusCode).toBe(500)
      expect(result.why).toBe('unknown_db_error')
    })

    it('should include fix suggestion in the result', () => {
      const error = { code: '23505', message: 'duplicate key' }
      const result = handleDbError(error)

      expect(result.fix).toBeDefined()
      expect(typeof result.fix).toBe('string')
    })

    it('should include the original message', () => {
      const error = { code: '23505', message: 'duplicate key value' }
      const result = handleDbError(error)

      expect(result.message).toBe('duplicate key value')
    })
  })

  describe('mapConstraintMessage', () => {
    it('should return custom message for known constraint', () => {
      const customMap = {
        users_email_key: '此 Email 已被使用',
      }
      const result = mapConstraintMessage('users_email_key', customMap)

      expect(result).toBe('此 Email 已被使用')
    })

    it('should return undefined for unknown constraint', () => {
      const customMap = {
        users_email_key: '此 Email 已被使用',
      }
      const result = mapConstraintMessage('unknown_constraint', customMap)

      expect(result).toBeUndefined()
    })

    it('should return undefined when no map is provided', () => {
      const result = mapConstraintMessage('users_email_key')

      expect(result).toBeUndefined()
    })
  })
})
