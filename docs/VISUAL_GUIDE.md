# 視覺導覽

透過應用程式內建的導覽頁面，快速了解 Starter 的完整功能。

---

## 線上體驗

啟動開發伺服器後，前往 `/walkthrough` 查看完整的應用程式導覽：

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

## 架構流程

```
使用者 → Nuxt UI 頁面 → Pinia Store → Server API → Supabase (PostgreSQL)
                                        ↑
                                   RLS 政策保護
```

## 接下來

- 📖 [FIRST_CRUD.md](FIRST_CRUD.md) — 動手建立你的第一個功能
- 📖 [QUICK_START.md](QUICK_START.md) — 完整環境設定
- 📖 [READING_GUIDE.md](READING_GUIDE.md) — 文件導覽地圖
