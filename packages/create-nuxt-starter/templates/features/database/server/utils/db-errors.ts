export function mapDbError(error: { code?: string; message?: string }): {
  statusCode: number
  message: string
} {
  switch (error.code) {
    case '23505':
      return { statusCode: 409, message: 'Record already exists' }
    case '23503':
      return { statusCode: 400, message: 'Referenced record not found' }
    case '42501':
      return { statusCode: 403, message: 'Insufficient permissions' }
    default:
      return { statusCode: 500, message: error.message || 'Database error' }
  }
}
