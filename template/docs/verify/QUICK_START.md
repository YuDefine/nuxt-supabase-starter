---
audience: both
applies-to: post-scaffold
---

# 快速上手指南

## 前置條件

- Node.js >= 22
- pnpm >= 10
- Docker（Supabase 本地開發）
- Supabase CLI（`brew install supabase/tap/supabase`）

## 步驟

### 1. 安裝依賴

```bash
pnpm install
```

### 2. 環境設定

```bash
cp .env.example .env
# 編輯 .env 填入必要值
```

必要值：

- `NUXT_SESSION_PASSWORD` — 至少 32 字元（`openssl rand -base64 32`）
- `SUPABASE_URL` / `SUPABASE_KEY` — 本地預設 `http://127.0.0.1:54321`

### 3. 啟動 Supabase

```bash
supabase start
supabase db reset  # 套用 migrations + seed
```

### 4. 產生 Types

```bash
pnpm db:types
```

### 5. 啟動開發伺服器

```bash
pnpm dev
```

瀏覽器會自動開啟 `localhost:3000`

### 6. 驗證

- [ ] 首頁正常載入
- [ ] 可以登入（OAuth 或 dev-login）
- [ ] `pnpm check` 全部通過
- [ ] `pnpm typecheck` 無錯誤

## 常用指令

| 指令            | 用途                    |
| --------------- | ----------------------- |
| `pnpm dev`      | 開發伺服器              |
| `pnpm check`    | 完整品質檢查            |
| `pnpm test`     | 執行測試                |
| `pnpm db:reset` | 重置資料庫              |
| `pnpm db:types` | 產生 TypeScript 型別    |
| `/commit`       | 提交變更（Claude Code） |
| `/ship`         | 建立 PR（Claude Code）  |
