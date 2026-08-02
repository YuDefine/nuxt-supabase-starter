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

## 標題走 props，不進 body（MUST）

**每一個**用 `#body` 的 `UModal` / `USlideover` / `UDrawer`，標題與副標 **MUST** 由 `title` / `description` prop（或 `#title` / `#description` slot）承載——不是只有新寫的那個，既有檔案改到時一併補。

`close` prop **預設 `true`**，header 的 `v-if` 條件含 `props.close`，所以 **header 一定會渲染**；而 title/description 的 wrapper 只認 `props.title` / `props.description`。兩者皆缺時的實際結果：

- header 塌成一條只有 X 的空白帶，且 theme `header` 帶 `min-h-(--ui-header-height)`，**空的也佔固定高度**
- theme `content` 帶 `divide-y`，那條空白帶下方還會畫出分隔線 → 看起來像巢狀 card
- `<DialogTitle />` 渲染為空 → dialog **沒有 accessible name**

```vue
<!-- ✅ 正確 -->
<UModal :title="editing ? '編輯假別' : '新增假別'" :description="editing ? '修改假別設定' : '建立新的請假類型'">
  <template #body>
    <UForm class="flex flex-col gap-4" :schema="schema" :state="state">…</UForm>
  </template>
</UModal>

<!-- ❌ 空 header + 標題錯位 + 無 accessible name -->
<UModal>
  <template #body>
    <UForm class="flex flex-col gap-4 p-6" :schema="schema" :state="state">
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold">新增假別</h3>
        <p class="text-sm text-muted">建立新的請假類型</p>
      </div>
      …
```

body wrapper 元件（`AppFormLayout` 這類自帶 `title` prop 的）同受此約束：title 給外層 overlay，**不給** body 內的 wrapper，否則同樣是空 header + 標題掉進 body。

**Padding**：theme `body` 已是 `p-4 sm:p-6`。`#body` 內的最外層再寫 `p-6` = 雙重內距，移除。

**自檢（可機械執行）**：`<UModal`…`>` 開標籤內沒有 `title=` / `:title=`，而其 `#body` 內出現 `<h1>`–`<h4>` 或帶 `title` prop 的 wrapper 元件 → 命中本節，要改。

> 由 `#content` 遷 `#body` 時最常漏這步：`#content` 會整個取代 content，UModal 不渲染預設 header，手刻標題在當時是對的；換成 `#body` 後預設 header 就回來了。**遷 slot 名的同一次改動裡把 title 一起提上去**，不要分兩批。

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
