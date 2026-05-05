<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/development.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

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
- **ALWAYS** Nuxt UI 語意色彩（見下方 Nuxt UI Color Mode 約束）
- **ALWAYS** named functions and named exports
- **ALWAYS** Composition API + `<script setup>`, NEVER Options API
- **ALWAYS** `interface` over `type`
- **ALWAYS** `refetch` (not `refresh`) from Pinia Colada `useQuery` for manual refresh buttons — `refresh` skips when data is within `staleTime`
- **ALWAYS** `PAGE_SIZE_MAX` from `shared/schemas/pagination` for `pageSize` max validation — NEVER hardcode
- **ALWAYS** UTable cell slot 命名加 `-cell` 後綴：`#actions-cell="{ row }"`，**NEVER** `#actions="{ row }"`（不加 `-cell` slot 不會生效且無報錯）
- **ALWAYS** Nuxt UI 元件顯式寫出樣式 props（`color`, `variant`, `size`）— **NEVER** 依賴預設值。實作前先搜尋既有頁面中相同語義的用法，複製其 props 組合。詳見 `DESIGN.md` Component Convention Overview（若有）

<!-- SPECTRA-UX:START v1.0.0 -->

- **ALWAYS** `switch + assertNever` for enum / const-array / Zod-enum discrimination — **NEVER** `if/else if/else` chains on enum types。加新 enum 值時 compiler 會當場報錯，避免靜默漏 case。utility: `~/utils/assert-never`。離線稽核：`pnpm audit:ux-drift`。規則: [`docs/rules/ux-completeness.md`](docs/rules/ux-completeness.md) Exhaustiveness Rule
<!-- SPECTRA-UX:END -->

# Nuxt UI Color Mode 約束

Nuxt UI 內建 color mode 處理，**禁止**自行指定 Tailwind 硬編碼色彩，否則 light/dark 切換會失效。

## 必須使用語意類別

| 用途       | 語意類別           | 禁止                                       |
| ---------- | ------------------ | ------------------------------------------ |
| 主要文字   | `text-default`     | ❌ `text-black`, `text-neutral-900`        |
| 次要文字   | `text-muted`       | ❌ `text-gray-500`, `text-neutral-500`     |
| 第三層文字 | `text-toned`       | ❌ `text-gray-600`, `text-neutral-600`     |
| 淡化文字   | `text-dimmed`      | ❌ `text-gray-400`, `text-neutral-400`     |
| 強調文字   | `text-highlighted` | ❌ `text-black`, `text-neutral-900`        |
| 反轉文字   | `text-inverted`    | ❌ `text-white`                            |
| 預設背景   | `bg-default`       | ❌ `bg-white`, `bg-neutral-50`             |
| 淡化背景   | `bg-muted`         | ❌ `bg-gray-50`, `bg-neutral-100`          |
| 凸起背景   | `bg-elevated`      | ❌ `bg-white`                              |
| 強調背景   | `bg-accented`      | ❌ `bg-gray-100`                           |
| 反轉背景   | `bg-inverted`      | ❌ `bg-black`, `bg-neutral-900`            |
| 預設邊框   | `border-default`   | ❌ `border-gray-200`, `border-neutral-200` |
| 淡化邊框   | `border-muted`     | ❌ `border-gray-100`                       |

## 禁止事項

1. **禁止硬編碼色彩**：`text-gray-*`, `text-neutral-*`, `bg-gray-*`, `bg-neutral-*`
2. **禁止 `dark:` prefix**：Nuxt UI 會自動處理，自己寫 `dark:text-white` 會衝突
3. **禁止 CSS 變數以外的黑白**：`text-black`, `text-white`, `bg-black`, `bg-white`

## 允許例外

- `--ui-primary` 等 CSS 變數中可使用 `black` / `white`
- Nuxt UI 元件的 `color` prop：`color="neutral"`, `color="error"` 等
- 系統回饋元件（UAlert, toast）使用語意 color：`color="error"`, `color="success"`
