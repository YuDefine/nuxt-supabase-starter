# 視覺導覽

透過架構圖和應用程式導覽，快速了解 Starter 的完整功能。

---

## 系統架構總覽

```
┌─────────────────────────────────────────────────┐
│                   Client (SPA)                  │
│                                                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Vue Pages │──│ Pinia    │  │ Pinia Colada │ │
│  │ + Nuxt UI │  │ Stores   │  │ Queries      │ │
│  └─────┬─────┘  └────┬─────┘  └──────┬───────┘ │
│        │             │               │          │
│        │  useSupabaseClient()   $fetch('/api/') │
│        │  (SELECT only)         (mutations)     │
└────────┼─────────────┼───────────────┼──────────┘
         │             │               │
    ┌────┴─────────────┴───┐   ┌──────┴──────────┐
    │   Supabase Client    │   │  Nuxt Server    │
    │   (anon key + RLS)   │   │  /api/v1/*      │
    │                      │   │  (service_role)  │
    └──────────┬───────────┘   └──────┬──────────┘
               │                      │
         ┌─────┴──────────────────────┴─────┐
         │        Supabase (PostgreSQL)      │
         │                                   │
         │  ┌───────────┐  ┌──────────────┐ │
         │  │   Tables  │  │ RLS Policies │ │
         │  │   + Index │  │ (Row Level   │ │
         │  │           │  │  Security)   │ │
         │  └───────────┘  └──────────────┘ │
         └───────────────────────────────────┘
```

**核心原則**：Client 讀、Server 寫

- **讀取**：Client 透過 `useSupabaseClient()` 直接查詢，RLS 自動保護
- **寫入**：Client → Server API (`/api/v1/*`) → Supabase（`service_role` 繞過 RLS）

---

## 資料流程圖

### 讀取流程（Client 直連）

```
使用者操作
    │
    ▼
┌──────────────┐    useSupabaseClient()
│  Vue 頁面    │ ──────────────────────┐
│  or Query    │                       │
└──────────────┘                       ▼
                              ┌────────────────┐
                              │   Supabase     │
                              │   (anon key)   │
                              │                │
                              │  RLS 自動過濾  │
                              │  WHERE user_id │
                              │  = auth.uid()  │
                              └───────┬────────┘
                                      │
                                      ▼
                              只回傳該使用者的資料
```

### 寫入流程（經過 Server）

```
使用者操作（新增/編輯/刪除）
    │
    ▼
┌──────────────┐   $fetch('/api/v1/...')
│  Vue 頁面    │ ─────────────────────────┐
└──────────────┘                          │
                                          ▼
                              ┌───────────────────┐
                              │  Server API       │
                              │  1. requireAuth() │
                              │  2. validateBody() │
                              │  3. 業務邏輯      │
                              └─────────┬─────────┘
                                        │
                                        ▼ service_role
                              ┌────────────────┐
                              │   Supabase     │
                              │   (繞過 RLS)   │
                              │   INSERT/      │
                              │   UPDATE/      │
                              │   DELETE       │
                              └────────────────┘
```

---

## 認證流程

```
┌──────────┐    signIn('google')    ┌──────────────┐
│  使用者  │ ──────────────────────▶│ Better Auth  │
└──────────┘                        │ OAuth Flow   │
                                    └──────┬───────┘
      ┌────────────────────────────────────┘
      ▼
┌──────────────┐   session cookie   ┌──────────────┐
│ OAuth        │ ──────────────────▶│ Nuxt Server  │
│ Provider     │                    │ Session 儲存 │
│ (Google etc) │                    └──────┬───────┘
└──────────────┘                           │
                                           ▼
                                  useUserSession()
                                  { user, loggedIn }
```

---

## 部署架構

```
┌─────────────────────────────────────────────┐
│              GitHub Repository              │
│                                             │
│  push to main                               │
│      │                                      │
│      ▼                                      │
│  ┌──────────────────────────────────────┐   │
│  │         GitHub Actions               │   │
│  │                                      │   │
│  │  CI: lint → typecheck → test → e2e  │   │
│  │  DB: supabase db push (migration)   │   │
│  │  Deploy: wrangler deploy            │   │
│  └────────┬─────────────────┬──────────┘   │
└───────────┼─────────────────┼──────────────┘
            │                 │
            ▼                 ▼
┌───────────────────┐  ┌──────────────────┐
│ Cloudflare Workers│  │ Supabase Cloud   │
│                   │  │ (或 Self-hosted) │
│ ┌───────────────┐ │  │                  │
│ │ Nuxt SPA      │ │  │ PostgreSQL       │
│ │ + Server API  │ │  │ + RLS            │
│ └───────────────┘ │  │ + Realtime       │
│                   │  │                  │
│ 全球 300+ 節點    │  │                  │
└───────────────────┘  └──────────────────┘
```

---

## 開發環境

```
┌─────────────────────────────────────────┐
│            本地開發環境                  │
│                                         │
│  Terminal 1          Terminal 2          │
│  ┌──────────┐       ┌──────────────┐   │
│  │ pnpm dev │       │ claude       │   │
│  │ :3000    │       │ (Claude Code)│   │
│  └──────────┘       └──────────────┘   │
│                                         │
│  Docker (supabase start)                │
│  ┌─────────────────────────────────┐   │
│  │ PostgreSQL          :54322      │   │
│  │ Supabase API        :54321      │   │
│  │ Supabase Studio     :54323      │   │
│  │ Mailpit (Email)     :54324      │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 線上體驗

啟動開發伺服器後，前往 `/walkthrough` 查看應用程式導覽：

```bash
pnpm dev
# 開啟 http://localhost:3000/walkthrough
```

## 應用程式旅程

| 步驟 | 頁面           | 你會看到                                   |
| ---- | -------------- | ------------------------------------------ |
| 1    | `/`            | 歡迎頁面 — 功能概覽與快速開始指引          |
| 2    | `/demo`        | 元件展示 — Nuxt UI 按鈕、表單、圖表、Modal |
| 3    | `/auth/login`  | 登入頁面 — Email + OAuth 登入              |
| 4    | `/profile`     | 個人檔案 — 編輯資料（需登入）              |
| 5    | `/admin/users` | 管理後台 — 使用者列表（需 Admin 角色）     |

---

## 接下來

- [FIRST_CRUD.md](FIRST_CRUD.md) — 動手建立你的第一個功能
- [QUICK_START.md](QUICK_START.md) — 完整環境設定
- [READING_GUIDE.md](READING_GUIDE.md) — 文件導覽地圖
