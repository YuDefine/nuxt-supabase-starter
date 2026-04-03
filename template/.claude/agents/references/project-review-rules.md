# 專案風格審查規則

Code review 時，除了標準檢查項目外，**MUST** 額外檢查以下專案特定規則。
違反項目歸類為 🟠 Major。

## 元件替代規則

| 禁止使用 | 應替換為    | 說明                                                                                                               |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `<img>`  | `<NuxtImg>` | 使用 Nuxt Image 模組，支援自動最佳化、lazy loading、responsive sizes。除非有 `<!-- raw-img -->` 註解明確標記例外。 |

## 資料庫存取模式

| 禁止使用                                              | 位置                     | 說明                                                                                                                                    |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.insert()` / `.update()` / `.delete()` / `.upsert()` | `app/` 目錄（client 端） | Client 端只能用 `.select()` 讀取。所有寫入必須透過 `server/api/v1/*` 的 Server API。                                                    |
| `mcp__remote-supabase__apply_migration` 執行 DDL      | 任何位置                 | MCP 使用 `supabase_admin` role，建立的物件 owner 錯誤會導致 CI/CD 部署失敗。DDL 必須透過 `supabase migration new` 建立 migration 檔案。 |
| `mcp__remote-supabase__execute_sql` 執行 DDL          | 任何位置                 | 同上。Remote MCP 只能用於 SELECT 查詢、除錯、檢查 table owner。                                                                         |

## Bug 修正文件同步

若本次變更包含 `🐛 fix` 類型的 commit，檢查是否已更新 `docs/verify/PRODUCTION_BUG_PATTERNS.md`。該文件記錄已發生過的錯誤模式與防範措施，修正 bug 時應同步補充對應的 Pattern 紀錄。
