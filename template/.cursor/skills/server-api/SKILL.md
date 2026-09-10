---
name: server-api
description: >-
  Server API 設計規範。觸發：server/api/**/*.ts、defineEventHandler、API route 與 request 驗證。
  NOT for client 端讀取查詢——僅 `modules.auth` 為 Supabase Auth 時；其餘 auth stack 讀取也走本
  skill。NOT for 前端全域狀態（走 pinia-store）。
---


# Server API 設計規範

本文件與範本是共用技術指引，依實際安裝的 Nuxt／DB／auth 模組選用。Supabase helper 是 consumer 已實作的專案函式，使用前查其來源與授權行為；不是 Nuxt 內建 API。產品的 skill discovery 與本文件可讀性分開驗證。

## Client 端寫入預設走 Server API

Client 端（`app/` 目錄）的**讀取**路徑依 consumer `.claude/hub.json` 的 `modules.auth` 而定：

- `modules.auth` 是 **Supabase Auth**（`supabase-self-hosted`）→ 預設只透過 `useSupabaseClient<Database>()` 執行 `.select()` 查詢。
- `modules.auth` 是 **`nuxt-auth-utils` / `better-auth`** → Supabase 不簽 JWT，瀏覽器的 `useSupabaseClient()` **恆以 `anon` role 存取**，登入與否都一樣 —— 要讓 client 讀得到就得把表開成 `TO public`，等於對任何持有 publishable key 的人公開。那些 auth stack 下 client 直讀**不是**預設：**讀寫都走 `/api/v1/*`**，client 端 Supabase 只留 Storage（bucket policy 獨立）。見 [[auth-data-path-consistency]] § Auth 策略與資料路徑的合法組合。

所有寫入操作預設必須透過 Server API（`/api/v1/*`）：

```typescript
// ❌ 預設不允許 — client 端直接寫入
const client = useSupabaseClient<Database>();
await client.from("posts").insert({ title: "Hello" });

// ✅ 正確 — 透過 Server API
await $fetch("/api/v1/posts", {
  method: "POST",
  body: { title: "Hello" },
});
```

Client-side Supabase writes are architecture exceptions. 只有在 proposal / ADR 明確記錄並同時滿足下列條件時，才可在 client 使用 `.insert()` / `.update()` / `.delete()` / `.upsert()`：

- RLS policy 能完整表達 tenant / user scope 與所有授權規則
- GRANT 只開必要 schema / table / operation，不給寬權限
- 不需要 `service_role`、server-only secret、跨表 transaction、workflow transition、audit-chain、storage upload 或外部 API
- 不涉及角色 / 權限、薪資、簽核、出勤、稽核、批次修復等敏感流程
- 有 focused tests 驗證 allow path、deny path、tenant isolation 與 RLS 失敗時的 UI/錯誤處理

**原因：**

- Server API 統一承接驗證、權限、商業邏輯與 request-scoped DB access
- Client 端 direct write 只適合 RLS 能完整表達授權、且沒有跨表副作用的窄場景
- 對企業管理 / 稽核 / 權限流程，server-owned writes 比只靠 client + RLS 更容易審計與測試

## 契約來源

新增 API 時，request/response schema 請定義在 `shared/schemas/`，並由同一個模組導出衍生型別。

- `shared/schemas/*.ts`：Zod schema + 衍生型別
- `shared/types/*.ts`：相容轉發或 UI/view-model 型別，**不是**新的 request/response 真相來源

## 選填欄位的 Null 慣例（Hard Rule）

**接收 user input 的選填欄位 MUST 用 `.nullish()`，NEVER 只用 `.optional()`。**

```typescript
// ❌ 錯誤 — 只接受 string | undefined
const schema = z.object({
  return_notes: z.string().trim().max(500).optional(),
})
// Client 送 { return_notes: null } → 400 ZodError
```

```typescript
// ✅ 正確 — 接受 string | null | undefined（同時涵蓋 .nullable() + .optional()）
const schema = z.object({
  return_notes: z.string().trim().max(500).nullish(),
})
```

**為什麼**：

- **`.optional()` 接受 `undefined`**，不接受 `null`。Zod 對 `null` payload 會回 ZodError。
- **JSON 序列化保留 null**：HTTP body / form payload 表達「沒填」最常用 `null`，不是 omitting key。Form binding 也常做 `value.trim() || null`。
- **DB 欄位 nullable text 存 null 是合法值**：schema 拒絕 null = 拒絕表達 DB 真實值。

**判斷準則**：

| 欄位來源                                       | 慣例           |
| ---------------------------------------------- | -------------- |
| 選填的 user input（form / textarea / select）  | `.nullish()`   |
| Server 內部 default 帶入（不從 client 收）     | `.optional()`  |
| 必填欄位（required = true）                    | 不加任何修飾   |
| Discriminator union 內部欄位                   | 看 union shape |

**契約對齊驗證**：

新增任何接 user input 的 schema 後，**MUST** 寫 boundary test 涵蓋 `null` / `undefined` / `''` / 字串值（見 `testing-anti-patterns.md` Anti-Pattern 6）。Schema 跟 client dialog payload 必須 round-trip 對齊：trace 真實 client code 看送什麼，不要靠想像。

**Review 抓 bug 的 grep**：

```bash
# 找出可能踩 null 邊界的 schema
rg -n "z\.string\(\).*\.optional\(\)" shared/schemas/ server/api/
```

每筆比對對應的 client dialog / form：若 client 會送 null（`value || null` / `value ?? null` / `value.trim() || null` 等 pattern），schema 要改 `.nullish()`。

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
import { requireRole } from "~~/server/utils/supabase";

const user = await requireRole(event, ["admin", "manager"]);

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
- [ ] 在 `shared/schemas/` 定義 request/response schema 與衍生型別
- [ ] 開頭進行權限檢查（requireRole）
- [ ] 使用 getValidatedQuery / readValidatedBody 驗證輸入
- [ ] 使用 getSupabaseWithContext 取得資料庫連線（`modules.auth` 為 better-auth / nuxt-auth-utils 時等價名為 `getAuthedSupabase`）
- [ ] **授權寫在 handler，不假設 RLS 會過濾**——上述 helper 回的都是 service-role client。先驗角色／操作權限；資料屬於個別使用者或 tenant 時，再以 ownership 或查詢條件限制資料範圍。判準見 [[auth-data-path-consistency]] § Server 側
- [ ] 回傳前使用 response schema `parse()`
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 新增操作設定 201 狀態碼
