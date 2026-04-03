export function useModalForm<T extends Record<string, unknown>>(defaults: T) {
  const open = ref(false)
  const editing = ref<T | null>(null)
  const form = reactive<T>({ ...defaults })

  function openCreate() {
    editing.value = null
    Object.assign(form, defaults)
    open.value = true
  }

  function openEdit(item: T) {
    editing.value = item
    Object.assign(form, item)
    open.value = true
  }

  function close() {
    open.value = false
  }

  const isEditing = computed(() => editing.value !== null)

  return { open, editing, form, isEditing, openCreate, openEdit, close }
}
