// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

import LoginPage from '../../app/pages/auth/login.vue'

// 錯誤狀態的 UAlert 關閉鈕：Nuxt UI v4 用 `close` prop（Object 會 bind 到關閉按鈕），
// v2 的 `close-button` 不會渲染關閉鈕，所以這個測試在修正前會失敗。
// 注意：UButton 會把 `data-slot` 覆寫成 `base`，DOM 上找不到 `data-slot="close"`，
// 因此關閉鈕以 UAlert 預設的 aria-label（locale alert.close，英文為 "Close"）定位。
const CLOSE_BUTTON = 'button[aria-label="Close"]'
const { emailHandle, socialHandle } = vi.hoisted(() => {
  const makeHandle = () => ({
    status: { value: 'idle' as 'idle' | 'pending' | 'success' | 'error' },
    error: { value: null as unknown },
    execute: vi.fn(),
  })
  return { emailHandle: makeHandle(), socialHandle: makeHandle() }
})

mockNuxtImport('useSignIn', () => {
  return (kind: 'email' | 'social') => {
    const handle = kind === 'email' ? emailHandle : socialHandle
    return {
      status: ref(handle.status.value),
      error: ref(handle.error.value),
      execute: handle.execute,
    }
  }
})

describe('登入頁錯誤提示的關閉鈕', () => {
  it('錯誤狀態下 UAlert 顯示關閉鈕，點擊後錯誤提示消失', async () => {
    emailHandle.error.value = { message: 'Invalid email or password' }
    emailHandle.execute.mockImplementation(async () => {})

    const wrapper = await mountSuspended(LoginPage, { route: '/auth/login' })

    // 尚未送出表單前不應有錯誤提示
    expect(wrapper.find(CLOSE_BUTTON).exists()).toBe(false)

    await wrapper.find('input[type="email"]').setValue('user@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong-password')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Invalid email or password. Please try again.')
    })

    const closeButton = wrapper.find(CLOSE_BUTTON)
    expect(closeButton.exists()).toBe(true)

    await closeButton.trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find(CLOSE_BUTTON).exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Invalid email or password. Please try again.')
    })

    emailHandle.error.value = null
  })
})
