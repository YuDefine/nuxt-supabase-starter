import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'
import { ref, reactive, computed } from 'vue'

// Stub Nuxt auto-imports so the composable can resolve ref/reactive/computed
vi.stubGlobal('ref', ref)
vi.stubGlobal('reactive', reactive)
vi.stubGlobal('computed', computed)

import { useModalForm } from '../../../app/composables/useModalForm'

interface TestItem {
  name: string
  age: number
}

const defaults: TestItem = { name: '', age: 0 }

describe('useModalForm', () => {
  let modal: ReturnType<typeof useModalForm<TestItem>>

  beforeEach(() => {
    modal = useModalForm<TestItem>({ ...defaults })
  })

  describe('initial state', () => {
    it('should start with open=false', () => {
      expect(modal.open.value).toBe(false)
    })

    it('should start with editing=null', () => {
      expect(modal.editing.value).toBeNull()
    })

    it('should start with isEditing=false', () => {
      expect(modal.isEditing.value).toBe(false)
    })

    it('should start with form matching defaults', () => {
      expect(modal.form.name).toBe('')
      expect(modal.form.age).toBe(0)
    })
  })

  describe('openCreate', () => {
    it('should set open to true', () => {
      modal.openCreate()
      expect(modal.open.value).toBe(true)
    })

    it('should set editing to null', () => {
      modal.openCreate()
      expect(modal.editing.value).toBeNull()
    })

    it('should set isEditing to false', () => {
      modal.openCreate()
      expect(modal.isEditing.value).toBe(false)
    })

    it('should reset form to defaults', () => {
      modal.form.name = 'dirty'
      modal.form.age = 99

      modal.openCreate()

      expect(modal.form.name).toBe('')
      expect(modal.form.age).toBe(0)
    })

    it('should reset form to defaults after openEdit was called', () => {
      modal.openEdit({ name: 'Alice', age: 30 })
      modal.openCreate()

      expect(modal.form.name).toBe('')
      expect(modal.form.age).toBe(0)
      expect(modal.editing.value).toBeNull()
      expect(modal.isEditing.value).toBe(false)
    })
  })

  describe('openEdit', () => {
    const item: TestItem = { name: 'Alice', age: 30 }

    it('should set open to true', () => {
      modal.openEdit(item)
      expect(modal.open.value).toBe(true)
    })

    it('should set editing to the provided item', () => {
      modal.openEdit(item)
      expect(modal.editing.value).toEqual(item)
    })

    it('should set isEditing to true', () => {
      modal.openEdit(item)
      expect(modal.isEditing.value).toBe(true)
    })

    it('should populate form with item values', () => {
      modal.openEdit(item)
      expect(modal.form.name).toBe('Alice')
      expect(modal.form.age).toBe(30)
    })

    it('should overwrite previous form values', () => {
      modal.form.name = 'dirty'
      modal.form.age = 99

      modal.openEdit(item)

      expect(modal.form.name).toBe('Alice')
      expect(modal.form.age).toBe(30)
    })
  })

  describe('close', () => {
    it('should set open to false', () => {
      modal.openCreate()
      expect(modal.open.value).toBe(true)

      modal.close()
      expect(modal.open.value).toBe(false)
    })

    it('should set open to false after openEdit', () => {
      modal.openEdit({ name: 'Alice', age: 30 })
      expect(modal.open.value).toBe(true)

      modal.close()
      expect(modal.open.value).toBe(false)
    })
  })

  describe('form reactivity', () => {
    it('should not affect editing when form changes after openCreate', () => {
      modal.openCreate()

      modal.form.name = 'modified'
      modal.form.age = 42

      expect(modal.editing.value).toBeNull()
      expect(modal.isEditing.value).toBe(false)
    })

    it('should not mutate original item when form changes after openEdit', () => {
      const item: TestItem = { name: 'Alice', age: 30 }
      modal.openEdit(item)

      modal.form.name = 'modified'
      modal.form.age = 99

      expect(item.name).toBe('Alice')
      expect(item.age).toBe(30)
    })

    it('should keep editing reference unchanged when form is mutated', () => {
      const item: TestItem = { name: 'Alice', age: 30 }
      modal.openEdit(item)

      modal.form.name = 'modified'

      expect(modal.editing.value).toStrictEqual(item)
      expect(modal.isEditing.value).toBe(true)
    })
  })
})
