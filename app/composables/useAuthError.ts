/**
 * Auth error handling composable
 *
 * Provides unified error parsing and user-friendly messages
 * for authentication-related errors.
 */

interface AuthErrorState {
  message: Ref<string>
  hasError: ComputedRef<boolean>
  setError: (err: unknown) => void
  clearError: () => void
}

export function useAuthError(): AuthErrorState {
  const message = ref('')
  const hasError = computed(() => message.value !== '')

  function setError(err: unknown) {
    if (err instanceof Error) {
      message.value = parseAuthError(err.message)
    } else if (typeof err === 'string') {
      message.value = parseAuthError(err)
    } else if (err && typeof err === 'object' && 'message' in err) {
      message.value = parseAuthError(String((err as { message: unknown }).message))
    } else {
      message.value = 'An unexpected error occurred. Please try again.'
    }
  }

  function clearError() {
    message.value = ''
  }

  return {
    message,
    hasError,
    setError,
    clearError,
  }
}

/**
 * Map raw error strings to user-friendly messages
 */
function parseAuthError(raw: string): string {
  const lower = raw.toLowerCase()

  if (lower.includes('invalid email or password') || lower.includes('invalid credentials')) {
    return 'Invalid email or password. Please try again.'
  }
  if (lower.includes('user already exists') || lower.includes('email already')) {
    return 'This email is already registered. Please sign in instead.'
  }
  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error. Please check your connection and try again.'
  }
  if (lower.includes('session expired') || lower.includes('unauthorized')) {
    return 'Your session has expired. Please sign in again.'
  }
  if (lower.includes('password') && lower.includes('weak')) {
    return 'Password is too weak. Please use at least 8 characters with a mix of letters and numbers.'
  }
  if (lower.includes('cancelled') || lower.includes('canceled')) {
    return 'Sign in was cancelled.'
  }

  return raw || 'An unexpected error occurred. Please try again.'
}
