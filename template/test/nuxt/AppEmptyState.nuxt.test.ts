/**
 * Component test example — `@nuxt/test-utils` + Vitest.
 *
 * Runs in a real Nuxt environment (`environment: 'nuxt'` is enabled per-file
 * via the `// @vitest-environment nuxt` pragma below). The `setup({ server:
 * true })` call boots a Nitro server so server-side composables, runtime
 * config, and auto-imports behave like production.
 *
 * Use this pattern when a component:
 *   - reads from Nuxt auto-imports (`useRuntimeConfig`, `useNuxtApp`, etc.)
 *   - renders Nuxt UI primitives (`UButton`, `UIcon`, `UAlert`)
 *   - emits events your callers must observe
 *
 * For plain logic (utility functions, pure composables that only use Vue
 * primitives) prefer `test/unit/*.test.ts` — it runs ~10x faster because it
 * does not boot Nuxt.
 *
 * Reference:
 *   - https://nuxt.com/docs/getting-started/testing
 *   - https://test-utils.vuejs.org/
 */

// @vitest-environment nuxt
import { describe, expect, it } from 'vite-plus/test'
import { mountSuspended } from '@nuxt/test-utils/runtime'

import AppEmptyState from '../../app/components/AppEmptyState.vue'

describe('AppEmptyState', () => {
  it('renders the message prop', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      props: { message: 'No tasks yet' },
    })

    expect(wrapper.text()).toContain('No tasks yet')
  })

  it('renders the optional description when provided', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      props: {
        message: 'No tasks yet',
        description: 'Create your first task to get started.',
      },
    })

    expect(wrapper.text()).toContain('Create your first task to get started.')
  })

  it('hides the description when not provided', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      props: { message: 'No tasks yet' },
    })

    // The description paragraph has the `max-w-sm` class; ensure it is absent.
    expect(wrapper.html()).not.toContain('max-w-sm')
  })

  it('emits "action" when the action button is clicked', async () => {
    const wrapper = await mountSuspended(AppEmptyState, {
      props: {
        message: 'No tasks yet',
        actionLabel: 'Create task',
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('action')).toHaveLength(1)
  })
})
