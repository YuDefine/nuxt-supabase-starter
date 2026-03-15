# 建立你的第一個功能：書籤管理

從資料庫到 UI 的完整開發流程，15 分鐘上手。

---

## 你將學到

- 建立 Supabase Migration
- 設定 RLS 政策
- 撰寫 Server API
- 使用 Pinia Colada 管理資料
- 建立 Vue 元件
- 撰寫單元測試

---

## Step 1：建立資料表（Migration）

```bash
supabase migration new create_bookmarks
```

打開 `supabase/migrations/` 中產生的 `.sql` 檔案，貼上以下內容：

```sql
-- 1. Bookmarks Table

CREATE TABLE public.bookmarks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  url         text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookmarks_user_id ON public.bookmarks (user_id);

-- updated_at trigger（複用已有的 handle_updated_at function）
CREATE TRIGGER set_bookmarks_updated_at
  BEFORE UPDATE ON public.bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. RLS Policies

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- service_role bypass：Server API 使用 service_role 執行所有操作
CREATE POLICY bookmarks_service_role_all
  ON public.bookmarks FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 使用者可讀取自己的書籤
CREATE POLICY bookmarks_select_own
  ON public.bookmarks FOR SELECT
  USING (user_id = auth.uid());

-- 使用者可新增自己的書籤
CREATE POLICY bookmarks_insert_own
  ON public.bookmarks FOR INSERT
  WITH CHECK (user_id = auth.uid());
```

建立完成後執行：`supabase db reset && pnpm db:types`

> **重要**：永遠使用 `supabase migration new` 建立 migration，不要手動建立 `.sql` 檔案。

**驗證**：`supabase db reset` 成功套用，`app/types/database.types.ts` 中出現 `bookmarks` 型別。

---

## Step 2：建立 Server API

### 2.1 定義 Zod Schema — `shared/schemas/bookmarks.ts`

```ts
import { z } from 'zod'

export const createBookmarkSchema = z.object({
  title: z.string().min(1, '標題不可為空').max(200),
  url: z.string().url('請輸入有效的網址'),
  description: z.string().max(500).optional(),
})
```

### 2.2 查詢書籤 — `server/api/v1/bookmarks/index.get.ts`

```ts
import { createError, defineEventHandler } from 'h3'
import { requireAuth } from '~~/server/utils/api-response'
import { getServerSupabaseClient } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const client = getServerSupabaseClient()

  const { data, error } = await client
    .from('bookmarks')
    .select('id, title, url, description, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({ statusCode: 500, message: `查詢失敗：${error.message}` })
  }

  return { data }
})
```

### 2.3 新增書籤 — `server/api/v1/bookmarks/index.post.ts`

```ts
import { createError, defineEventHandler, readBody } from 'h3'
import { createBookmarkSchema } from '~~/shared/schemas/bookmarks'
import { requireAuth } from '~~/server/utils/api-response'
import { validateBody } from '~~/server/utils/validation'
import { getServerSupabaseClient } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = validateBody(await readBody(event), createBookmarkSchema)
  const client = getServerSupabaseClient()

  const { data, error } = await client
    .from('bookmarks')
    .insert({
      user_id: user.id,
      title: body.title,
      url: body.url,
      description: body.description,
    })
    .select('id, title, url, description, created_at, updated_at')
    .single()

  if (error) {
    throw createError({ statusCode: 500, message: `建立失敗：${error.message}` })
  }

  return { data }
})
```

**驗證**：用 curl 測試：`curl http://localhost:3000/api/v1/bookmarks`

---

## Step 3：建立資料查詢（Pinia Colada）

建立 `app/queries/bookmarks.ts`：

```ts
export const bookmarkKeys = {
  all: ['bookmarks'] as const,
  list: () => [...bookmarkKeys.all, 'list'] as const,
}

/** 查詢當前使用者的書籤列表 */
export const useBookmarkListQuery = defineQuery(() => {
  const { data, status, error, refetch } = useQuery({
    key: bookmarkKeys.list,
    query: () =>
      $fetch<{
        data: Array<{
          id: string
          title: string
          url: string
          description: string | null
          created_at: string
          updated_at: string
        }>
      }>('/api/v1/bookmarks'),
    staleTime: 30_000,
  })

  const bookmarks = computed(() => data.value?.data ?? [])

  return { bookmarks, status, error, refetch }
})

/** 新增書籤 mutation */
export const useCreateBookmarkMutation = defineMutation(() => {
  const queryCache = useQueryCache()

  const { mutate, mutateAsync, status, error } = useMutation({
    mutation: (vars: { title: string; url: string; description?: string }) =>
      $fetch('/api/v1/bookmarks', { method: 'POST', body: vars }),
    onSettled: () => {
      queryCache.invalidateQueries({ key: bookmarkKeys.all })
    },
  })

  return { createBookmark: mutate, createBookmarkAsync: mutateAsync, status, error }
})
```

**驗證**：Vue Devtools 的 Pinia Colada 面板中可以看到 `bookmarks` query。

---

## Step 4：建立 Vue 元件 — `app/pages/bookmarks.vue`

```vue
<script setup lang="ts">
  const { bookmarks, status } = useBookmarkListQuery()
  const { createBookmark, status: createStatus } = useCreateBookmarkMutation()

  const form = reactive({ title: '', url: '', description: '' })

  function handleSubmit() {
    if (!form.title || !form.url) return
    createBookmark(
      { title: form.title, url: form.url, description: form.description || undefined },
      { onSuccess: () => Object.assign(form, { title: '', url: '', description: '' }) }
    )
  }
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">書籤管理</h1>
      <p class="mt-1 text-(--ui-text-muted)">收藏你喜歡的網站</p>
    </header>

    <!-- 新增表單 -->
    <UCard>
      <template #header>
        <h2 class="font-semibold">新增書籤</h2>
      </template>
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <UFormField label="標題" required>
          <UInput v-model="form.title" placeholder="例如：Nuxt 官方文件" />
        </UFormField>
        <UFormField label="網址" required>
          <UInput v-model="form.url" type="url" placeholder="https://nuxt.com" />
        </UFormField>
        <UFormField label="描述">
          <UInput v-model="form.description" placeholder="選填：簡短描述這個網站" />
        </UFormField>
        <UButton
          type="submit"
          :loading="createStatus === 'pending'"
          :disabled="!form.title || !form.url"
        >
          新增
        </UButton>
      </form>
    </UCard>

    <!-- 書籤列表 -->
    <UCard>
      <template #header>
        <h2 class="font-semibold">我的書籤</h2>
      </template>
      <div v-if="status === 'pending'" class="py-8 text-center text-(--ui-text-muted)">
        載入中...
      </div>
      <div v-else-if="bookmarks.length === 0" class="py-8 text-center text-(--ui-text-muted)">
        還沒有書籤，新增一個吧！
      </div>
      <ul v-else class="divide-y divide-(--ui-border)">
        <li v-for="bookmark in bookmarks" :key="bookmark.id" class="py-3">
          <a
            :href="bookmark.url"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-(--ui-text-highlighted) hover:underline"
          >
            {{ bookmark.title }}
          </a>
          <p v-if="bookmark.description" class="mt-1 text-sm text-(--ui-text-muted)">
            {{ bookmark.description }}
          </p>
          <p class="mt-1 text-xs text-(--ui-text-dimmed)">{{ bookmark.url }}</p>
        </li>
      </ul>
    </UCard>
  </div>
</template>
```

**驗證**：開啟 `/bookmarks`，你會看到書籤列表和新增表單。

---

## Step 5：撰寫單元測試 — `test/unit/server/api/v1/bookmarks/index.post.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (handler: any) => handler,
  createError: (opts: any) => {
    const error = new Error(opts.message) as any
    error.statusCode = opts.statusCode
    return error
  },
  readBody: vi.fn(),
}))

vi.mock('../../../../../../server/utils/api-response', () => ({
  requireAuth: vi.fn(() => ({ id: 'user-1', role: 'user' })),
}))

vi.mock('../../../../../../server/utils/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}))

vi.mock('../../../../../../server/utils/validation', () => ({
  validateBody: vi.fn((body: any) => body),
}))

import { readBody } from 'h3'
import { requireAuth } from '../../../../../../server/utils/api-response'
import { getServerSupabaseClient } from '../../../../../../server/utils/supabase'
import { validateBody } from '../../../../../../server/utils/validation'
import handler from '../../../../../../server/api/v1/bookmarks/index.post'

describe('POST /api/v1/bookmarks', () => {
  const mockBookmark = {
    id: 'bm-1',
    title: 'Nuxt',
    url: 'https://nuxt.com',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a bookmark and return it', async () => {
    const body = { title: 'Nuxt', url: 'https://nuxt.com' }
    vi.mocked(readBody).mockResolvedValue(body)
    vi.mocked(validateBody).mockReturnValue(body)

    const mockClient = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockBookmark, error: null }),
          }),
        }),
      }),
    }
    vi.mocked(getServerSupabaseClient).mockReturnValue(mockClient as any)

    const event = { context: { session: { user: { id: 'user-1' } } } } as any
    const result = await handler(event)

    expect(result).toEqual({ data: mockBookmark })
    expect(mockClient.from).toHaveBeenCalledWith('bookmarks')
  })

  it('should throw 401 when not logged in', async () => {
    const authError = new Error('未登入，請先登入') as any
    authError.statusCode = 401
    vi.mocked(requireAuth).mockImplementationOnce(() => {
      throw authError
    })

    await expect(handler({ context: {} } as any)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('should throw 500 when database insert fails', async () => {
    const body = { title: 'Nuxt', url: 'https://nuxt.com' }
    vi.mocked(readBody).mockResolvedValue(body)
    vi.mocked(validateBody).mockReturnValue(body)
    const mockClient = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
          }),
        }),
      }),
    }
    vi.mocked(getServerSupabaseClient).mockReturnValue(mockClient as any)
    const event = { context: { session: { user: { id: 'user-1' } } } } as any
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 500 })
  })
})
```

**驗證**：`pnpm test -- test/unit/server/api/v1/bookmarks/index.post.test.ts` 三個案例都通過。

---

## 完成！

你已經完成了一個完整的功能，涵蓋了專案的核心開發流程：

| 層級       | 檔案                                           |
| ---------- | ---------------------------------------------- |
| Database   | `supabase/migrations/..._create_bookmarks.sql` |
| Validation | `shared/schemas/bookmarks.ts`                  |
| Server API | `server/api/v1/bookmarks/index.get.ts`         |
| Server API | `server/api/v1/bookmarks/index.post.ts`        |
| Data Layer | `app/queries/bookmarks.ts`                     |
| UI         | `app/pages/bookmarks.vue`                      |
| Test       | `test/unit/.../index.post.test.ts`             |

### 延伸學習

- **Migration 規範** — `docs/verify/SUPABASE_MIGRATION_GUIDE.md`
- **RLS 最佳實踐** — `docs/verify/RLS_BEST_PRACTICES.md`
- **API 設計指南** — `docs/verify/API_DESIGN_GUIDE.md`
- **Pinia 架構** — `docs/verify/PINIA_ARCHITECTURE.md`
- **Auth 整合** — `docs/verify/AUTH_INTEGRATION.md`

---

## 接下來學什麼？

恭喜完成第一個功能！以下是建議的學習路徑：

### 🟢 入門（鞏固基礎）

| 順序 | 文件                                   | 你將學到                                       |
| ---- | -------------------------------------- | ---------------------------------------------- |
| 1    | [SUPABASE_GUIDE.md](SUPABASE_GUIDE.md) | Migration 進階、RLS 深入、Local-first 開發流程 |
| 2    | [API_PATTERNS.md](API_PATTERNS.md)     | RESTful 設計模式、分頁、搜尋、錯誤處理         |
| 3    | [WORKFLOW.md](WORKFLOW.md)             | TDD 紅綠重構循環、自動化檢查流程               |
| 4    | [FAQ.md](FAQ.md)                       | 常見問題速查、技術決策指南                     |

### 🟡 進階（深入掌握）

| 順序 | 文件                                                         | 你將學到                              |
| ---- | ------------------------------------------------------------ | ------------------------------------- |
| 1    | [verify/AUTH_INTEGRATION.md](verify/AUTH_INTEGRATION.md)     | OAuth 整合、Session 管理、角色權限    |
| 2    | [verify/RLS_BEST_PRACTICES.md](verify/RLS_BEST_PRACTICES.md) | RLS 政策模板、效能最佳化、除錯技巧    |
| 3    | [verify/PINIA_ARCHITECTURE.md](verify/PINIA_ARCHITECTURE.md) | Store 設計模式、Pinia Colada 查詢快取 |
| 4    | [verify/API_DESIGN_GUIDE.md](verify/API_DESIGN_GUIDE.md)     | 完整 API 設計規範、驗證、權限控制     |

### 🔴 生產就緒（部署上線）

| 順序 | 文件                                                               | 你將學到                                 |
| ---- | ------------------------------------------------------------------ | ---------------------------------------- |
| 1    | [DEPLOYMENT.md](DEPLOYMENT.md)                                     | Cloudflare Workers 部署、CI/CD、回滾策略 |
| 2    | [verify/DATABASE_OPTIMIZATION.md](verify/DATABASE_OPTIMIZATION.md) | 索引策略、查詢最佳化、效能監控           |
| 3    | [verify/ENVIRONMENT_VARIABLES.md](verify/ENVIRONMENT_VARIABLES.md) | 環境變數管理、GitHub Secrets             |
| 4    | [TROUBLESHOOTING.md](TROUBLESHOOTING.md)                           | 25 個常見問題的系統化診斷                |

> 💡 **提示**：使用 `/spectra:propose` 來規劃你的下一個功能，體驗 Spec-Driven Development 工作流程。
