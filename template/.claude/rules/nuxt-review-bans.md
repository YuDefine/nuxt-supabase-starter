---
description: patterns.json 機械 ban 清單的實作階段投影 — 寫 .vue / app.config.ts 前必讀；不等 /commit review 才抓
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'template/app/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'template/pages/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'template/components/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'template/layouts/**/*.vue', 'app.config.ts', 'packages/*/app.config.ts', 'template/app.config.ts', 'app/app.config.ts', 'packages/*/app/app.config.ts', 'template/app/app.config.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-review-bans.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Nuxt Review Bans（實作階段強制）

**核心命題**：`vendor/review-rules/patterns.json` 定義了跨 consumer 統一的機械可檢 ban 規則，由 pre-commit hook + code-review agent 消費。但這些規則過去**只在 review 階段可見**（`plugins/hub-core/agents/references/clade-review-rules.md`），實作階段的 Claude 完全看不到 → 反覆寫出違規 → 事後才被抓。

本 rule 把 `patterns.json` 的 ban 清單提升到 **path-scoped implementation rule**，讓 Claude 在動 `.vue` / `app.config.ts` 的**當下**就讀到。

> SoT 是 `vendor/review-rules/patterns.json`；本檔是它的實作階段投影。patterns.json 新增 / 修改 entry 時，本檔 **MUST** 同步更新。

## Ban 清單

寫任何 `.vue` 或 `app.config.ts` 之前，**MUST** 逐條自查以下 ban：

### 1. UBadge size ban（`ubadge-size-ban`，severity: error）

**禁止**：`<UBadge size="xs">` / `<UBadge size="sm">`

**也禁止**：在 `app.config.ts` 的 `badge.defaultVariants` 設 `size: 'xs'` 或 `size: 'sm'` — 效果等同 inline prop 但繞過 `.vue` 掃描。

**理由**：xs / sm 在密集表格字級過小、可讀性不足。

**正解**：移除 `size` prop（吃預設 `md`），或顯式寫 `size="md"` / `"lg"` / `"xl"`。

### 2. Client-side mutation ban（`client-side-mutation`，severity: error）

**禁止**：在 `app/` 或 `packages/*/app/` 下的 `.vue` 檔使用 `.insert()` / `.update()` / `.delete()` / `.upsert()`

**理由**：Client 端禁止直接寫入 DB。所有 mutation 必須透過 `server/api/v1/*` 的 Server API。

**正解**：把 mutation 移到 server API endpoint。

### 3. Dark mode hardcoded color（`dark-mode-hardcoded-color`，severity: warning）

**禁止**：`bg-white` / `text-black` / `bg-gray-*` / `text-neutral-*` / `border-slate-*` 等 hardcoded 灰階色 class

**理由**：hardcoded 灰階色在 dark mode 不會自動反轉。

**正解**：改用 Nuxt UI semantic color class（`bg-default`、`text-default`、`text-muted`、`bg-elevated` 等）。完整對照見 `development.md` § Nuxt UI Color Mode 約束。

### 4. Raw img tag（`raw-img-tag`，severity: warning）

**禁止**：`<img ...>` 原生 HTML tag

**理由**：應改用 `<NuxtImg>`（自動優化 + responsive）。

**正解**：改用 `<NuxtImg src="..." />`。真需原生 `<img>` 在同行加 `<!-- raw-img -->` exemption marker。

### 5. Overlay width on class（`overlay-width-class`，severity: error）

**禁止**：`<UModal class="max-w-*">` / `<USlideover class="max-w-*">` / `<UDrawer class="max-w-*">`

**理由**：`class="max-w-*"` 寫在 overlay root **不會**覆蓋 content slot 的寬度約束。

**正解**：改用 `:ui="{ content: 'sm:max-w-2xl' }"` 覆寫 content slot。

### 6. Dark mode dark: prefix（`dark-mode-dark-prefix`，severity: warning）

**禁止**：`dark:text-*` / `dark:bg-*` / `dark:border-*`（`--ui-` CSS 變數內除外）

**理由**：Nuxt UI color mode 會根據 semantic token 自動切色，手寫 `dark:` variant 會與系統衝突。

**正解**：改用 Nuxt UI semantic token，由 color mode 自動處理。

### 7. Calendar popover min-width（`calendar-popover-min-width`，severity: warning）

**禁止**：`<UCalendar>` 在 `<UPopover>` 內使用但沒設 `min-w-[280px]`

**理由**：CJK locale 的年份標籤（如「2020年」）在預設寬度下會擠成一塊。

**正解**：在 `<UCalendar>` 加 `class="min-w-[280px]"`，或在 `app.config.ts` 加 `ui.calendar.slots.root: 'min-w-[280px]'`。

### 8. Semantic color hardcode（`dark-mode-semantic-color`，severity: warning）

**禁止**：`bg-blue-500` / `text-green-600` / `bg-red-50` 等 hardcoded Tailwind 色彩值

**理由**：語意色應用 Nuxt UI color token + opacity。

**正解**：改用 `bg-info/10` / `text-error` / `text-success` / `text-warning` 等 Nuxt UI semantic token。

## app.config.ts 特別注意

`app.config.ts` 的 theme override（`defaultVariants` / `compoundVariants` / `slots`）**等同** inline prop — 效果一樣但繞過只掃 `.vue` 的機械層。

**MUST** 在修改 `app.config.ts` 的 `ui.*` 區塊時，逐條比對上方 ban 清單：

- `defaultVariants.size: 'xs'` 或 `'sm'` → 違反 #1
- `slots` 內含 hardcoded 灰階色 → 違反 #3
- `slots` 內含 `dark:` prefix → 違反 #6

## 為什麼這條 rule 存在

2026-06-28 實證：`patterns.json` 的 `ubadge-size-ban` 存在且 pre-commit hook 生效，但實作階段 Claude 完全不知道此 ban → 在 `app.config.ts` 設 `badge.defaultVariants.size: 'sm'` 繞過機械層。使用者反映已 10+ 次遇到 review rules 不被遵守的情況。

根因：review rules 放在 `plugins/hub-core/agents/references/clade-review-rules.md`（只有 code-review agent 讀），不在 `.claude/rules/` path-scoped 層（實作 Claude 讀）。本 rule 補上這個可見性斷層。

## 與其他 rule 的關係

- **`nuxt-ui-mcp.md`**：管 API 正確性（prop / slot 存在）；本 rule 管 ban 清單（prop 存在但禁用）
- **`nuxt-ui-conventions.md`**：管慣例一致性（同語義角色用同 props）；本 rule 管跨 consumer 統一禁令
- **`nuxt-ui-native-picker-ban.md`**：管 date/time picker 禁令；本 rule 涵蓋所有 `patterns.json` ban
- **`development.md` § Nuxt UI Color Mode**：管 semantic color 完整對照表；本 rule #3/#6/#8 是該表的 enforcement 層
- **`nuxt-overlay-slot.md`**：管 overlay `#body` slot 語意；本 rule #5 是 overlay 寬度 class ban
- **`vendor/review-rules/patterns.json`**：本 rule 的 SoT；patterns.json 變動時本檔 MUST 同步
