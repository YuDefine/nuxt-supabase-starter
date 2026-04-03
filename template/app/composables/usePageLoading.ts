/**
 * 頁面 loading 狀態管理 composable
 *
 * 提供 loading 狀態、timeout presets、以及 withLoading() wrapper。
 *
 * @module app/composables/usePageLoading
 */

/** Timeout 預設值（毫秒） */
export const LOADING_TIMEOUTS = {
  quick: 3_000,
  normal: 10_000,
  long: 30_000,
} as const

export type LoadingPreset = keyof typeof LOADING_TIMEOUTS

export interface UsePageLoadingReturn {
  isLoading: Ref<boolean>
  error: Ref<string | null>
  withLoading: <T>(
    fn: () => Promise<T>,
    options?: { timeout?: LoadingPreset | number }
  ) => Promise<T>
}

export function usePageLoading(): UsePageLoadingReturn {
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 包裝非同步函式，自動管理 loading / error 狀態
   *
   * @param fn - 要執行的非同步函式
   * @param options.timeout - 超時設定，可使用 preset 名稱或毫秒數
   */
  async function withLoading<T>(
    fn: () => Promise<T>,
    options?: { timeout?: LoadingPreset | number }
  ): Promise<T> {
    const timeoutMs = resolveTimeout(options?.timeout)

    isLoading.value = true
    error.value = null

    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`操作逾時（${timeoutMs}ms）`)), timeoutMs)
        }),
      ])
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : '發生未預期的錯誤'
      error.value = message
      throw err
    } finally {
      if (timer) clearTimeout(timer)
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    withLoading,
  }
}

function resolveTimeout(value?: LoadingPreset | number): number {
  if (value === undefined) return LOADING_TIMEOUTS.normal
  if (typeof value === 'number') return value
  return LOADING_TIMEOUTS[value]
}
