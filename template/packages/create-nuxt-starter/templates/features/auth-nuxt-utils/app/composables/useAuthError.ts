export function useAuthError() {
  function parseError(error: unknown): string {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    return '發生未知錯誤'
  }
  return { parseError }
}
