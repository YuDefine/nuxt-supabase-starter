---
description: Overlay 元件（USlideover/UModal/UDrawer）body 必用 #body slot、寬度必用 :ui prop 覆寫
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'layouts/**/*.vue', 'pages/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-overlay-slot.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Overlay 元件 slot 與寬度規約

## #body slot（MUST）

Nuxt UI v3 的 `USlideover` / `UModal` / `UDrawer` default slot 語意是 **trigger**（開啟 overlay 的按鈕），`#body` slot 才有內建 `overflow-y-auto`。

body 內容放 default slot → 超出 viewport 高度時**無法捲動**。

```vue
<!-- ✅ 正確：controlled mode，body 在 #body slot -->
<USlideover :open="open" title="校正資料" @update:open="emit('update:open', $event)">
  <template #body>
    <div class="space-y-4">...</div>
  </template>
  <template #footer>
    <div class="flex justify-end gap-3">...</div>
  </template>
</USlideover>
```

**NEVER** 把 body 內容放 default slot（即非 `<template #body>` / `<template #content>` 包裹的直接子元素）。

**同時檢查**：`#header` 內手寫 close button → 優先改用 `title` prop + 內建 close。

## 寬度覆寫（MUST 用 `:ui` prop）

`class="max-w-*"` 寫在 overlay root **不會**覆蓋 content slot 的寬度約束。

```vue
<!-- ❌ 無效 -->
<UModal class="max-w-2xl">

<!-- ✅ 正確 -->
<UModal :ui="{ content: 'sm:max-w-2xl' }">
```

管理系統全域 `app.config.ts` 建議把 modal 預設從 `max-w-lg`（512px）提升到 `max-w-2xl`+。
