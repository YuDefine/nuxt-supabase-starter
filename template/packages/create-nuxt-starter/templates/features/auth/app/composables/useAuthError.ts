function parseAuthError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('invalid credentials') || msg.includes('invalid password')) {
      return '帳號或密碼錯誤'
    }
    if (msg.includes('user not found')) {
      return '找不到此帳號'
    }
    if (msg.includes('email already')) {
      return '此 Email 已被註冊'
    }
    return error.message
  }
  return '發生未知錯誤'
}

export function useAuthError() {
  return { parseAuthError }
}
