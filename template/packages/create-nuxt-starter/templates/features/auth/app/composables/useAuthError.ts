// `@nuxtjs/better-auth` 的 action handle 把錯誤正規化成 `AuthActionError`
// （`{ message, code?, status?, raw }` 的**純物件**，不是 Error 實例），所以這裡
// NEVER 只判 `error instanceof Error` —— 那樣所有登入失敗都會變成「發生未知錯誤」。
function extractMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') return message
  }
  return null
}

function parseAuthError(error: unknown): string {
  const raw = extractMessage(error)
  if (raw === null) return '發生未知錯誤'

  const msg = raw.toLowerCase()
  if (msg.includes('invalid credentials') || msg.includes('invalid password')) {
    return '帳號或密碼錯誤'
  }
  if (msg.includes('user not found')) {
    return '找不到此帳號'
  }
  if (msg.includes('email already')) {
    return '此 Email 已被註冊'
  }
  return raw
}

export function useAuthError() {
  return { parseAuthError }
}
