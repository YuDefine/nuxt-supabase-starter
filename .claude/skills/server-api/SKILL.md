---
name: server-api
description: >-
  Server API 設計規範。Use when creating server/api/**/*.ts files,
  building API endpoints, or working with defineEventHandler.
  Always use this skill for API route design, request validation,
  error handling, and response formatting.
---

# Server API 設計規範

## 目錄結構

```
server/api/
├── v1/                       # 版本化業務 API
│   └── resources/
│       ├── index.get.ts      # GET /api/v1/resources（列表）
│       ├── index.post.ts     # POST /api/v1/resources（新增）
│       └── [id]/
│           ├── index.get.ts     # GET /api/v1/resources/:id
│           ├── index.patch.ts   # PATCH /api/v1/resources/:id
│           └── index.delete.ts  # DELETE /api/v1/resources/:id
├── auth/                     # 認證 API
└── admin/                    # 管理員 API
```

### 命名規範

- **檔案名稱**：`index.<method>.ts` 格式
- **路徑參數**：有意義的名稱（`[resourceId]` 優於 `[id]`）
- **API 版本**：`/api/v1/` 前綴

## 權限檢查

```typescript
import { requireRole } from '~~/server/utils/supabase'

const user = await requireRole(event, ['admin', 'manager'])

// 角色階層：admin → manager → staff
```

## 回應格式

| 類型 | 格式                                                                 |
| ---- | -------------------------------------------------------------------- |
| 列表 | `{ data: items, pagination: { page, pageSize, total, totalPages } }` |
| 單筆 | `{ data: item }`                                                     |
| 新增 | status 201 + `{ data: newItem }`                                     |
| 刪除 | `{ data: { id, deleted_at, hard_deleted } }`                         |

## 錯誤類型

| 狀態碼 | 使用情境                    |
| ------ | --------------------------- |
| 400    | 請求格式錯誤、驗證失敗      |
| 401    | 未認證                      |
| 403    | 無權限                      |
| 404    | 資源不存在                  |
| 409    | 資源衝突（unique key 違反） |
| 500    | 伺服器內部錯誤              |

## 參考資料

| 檔案                                                     | 內容                       |
| -------------------------------------------------------- | -------------------------- |
| [references/api-template.md](references/api-template.md) | 完整 API 模板 + Zod Schema |
| [references/pagination.md](references/pagination.md)     | 分頁、搜尋、排序、操作日誌 |

## 檢查清單

- [ ] 使用 `index.<method>.ts` 命名
- [ ] 在 `shared/types/` 定義 Zod Schema
- [ ] 開頭進行權限檢查（requireRole）
- [ ] 使用 getValidatedQuery / readValidatedBody 驗證輸入
- [ ] 使用 getSupabaseWithContext 取得資料庫連線
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 新增操作設定 201 狀態碼
