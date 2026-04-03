---
description: 開發規範（TDD, coding style, UI reuse）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts', 'test/**/*.ts', 'shared/**/*.ts']
---

# UI Reuse

新增 UI 元件前，**MUST** 先搜尋 `app/components/` 和 `app/pages/` 檢查：

1. 是否已有可直接複用的元件
2. 是否有相似 UI 模式值得抽取為共用元件

找到可複用元件 → 直接使用或擴展；發現相似模式 → 提議抽取共用元件後再實作。

# Development

- **ALWAYS** TDD: follow the `test-driven-development` skill (Red → Green → Refactor)
- **NEVER** `.skip` or comment out tests
- **ALWAYS** Tailwind classes, NEVER manual CSS or hardcoded colors
- **ALWAYS** named functions and named exports
- **ALWAYS** Composition API + `<script setup>`, NEVER Options API
- **ALWAYS** `interface` over `type`
- **ALWAYS** `refetch` (not `refresh`) from Pinia Colada `useQuery` for manual refresh buttons — `refresh` skips when data is within `staleTime`
- **ALWAYS** `PAGE_SIZE_MAX` from `shared/schemas/pagination` for `pageSize` max validation — NEVER hardcode
- **ALWAYS** UTable cell slot 命名加 `-cell` 後綴：`#actions-cell="{ row }"`，**NEVER** `#actions="{ row }"`（不加 `-cell` slot 不會生效且無報錯）
