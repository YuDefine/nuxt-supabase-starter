@unverified
Feature: Profile 列表（分頁與搜尋）
  # 從程式碼逆向。x-source: server/api/v1/profiles/index.get.ts:21-85（operationId listProfiles）
  # 整支 feature 標 @unverified：目前沒有 Gherkin runner（specs/truth/techstack.md § 測試）。
  # 既有 Vitest 對應：test/unit/server/api/v1/profiles/index.get.test.ts、observability.test.ts、
  # test/unit/shared/schemas/profiles.test.ts、test/unit/server/utils/api-response.test.ts（mock，非 wire）。

  Background:
    Given 資料庫中有以下 profiles
      | id                                   | display_name | role  | created_at           |
      | <管理員甲> | 管理員       | admin | 2026-01-03T00:00:00Z |
      | <使用者乙> | 測試使用者二 | user  | 2026-01-02T00:00:00Z |
      | <使用者甲> | 測試使用者一 | user  | 2026-01-01T00:00:00Z |

  Rule: admin 取得依 created_at 由新到舊排序的列表，預設第 1 頁、每頁 20 筆

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 預設分頁
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles"
      Then 回應狀態碼為 200
      And 回應 data 的 id 依序為 "<管理員甲>,<使用者乙>,<使用者甲>"
      And 回應 pagination 為 page 1、perPage 20、total 3、totalPages 1

  Rule: page 與 perPage 切出對應的一頁，total 與 totalPages 反映符合條件的全部筆數

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 第 2 頁、每頁 2 筆
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?page=2&perPage=2"
      Then 回應狀態碼為 200
      And 回應 data 的 id 依序為 "<使用者甲>"
      And 回應 pagination 為 page 2、perPage 2、total 3、totalPages 2

    # [need clarification] Q-profiles-7 超出頁數回空陣列是依 postgrest-js 的 offset／limit 行為推導，尚未對真資料庫實跑。
    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 超出最後一頁得到空陣列
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?page=5&perPage=2"
      Then 回應狀態碼為 200
      And 回應 data 的 id 依序為 ""
      And 回應 pagination 為 page 5、perPage 2、total 3、totalPages 2

  Rule: search 對 display_name 做不分大小寫的包含比對，total 只算符合者

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 以「使用者」搜尋
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?search=使用者"
      Then 回應狀態碼為 200
      And 回應 data 的 id 依序為 "<使用者乙>,<使用者甲>"
      And 回應 pagination 為 page 1、perPage 20、total 2、totalPages 1

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 空字串視為沒有搜尋條件
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?search="
      Then 回應狀態碼為 200
      And 回應 pagination 為 page 1、perPage 20、total 3、totalPages 1

  Rule: search 內的萬用字元不被跳脫（現況鎖定，非期望行為）
    # [need clarification] Q-profiles-3 index.get.ts:40-43 直接把 search 放進 ILIKE；server/utils/postgrest.ts
    #   的 sanitizePostgrestSearch 存在但沒有任何 handler 使用。search 為 "%" 時會比對到全部列。

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: search 為百分號
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?search=%25"
      Then 回應狀態碼為 200
      And 回應 pagination 為 page 1、perPage 20、total 3、totalPages 1

  Rule: 查詢參數不合法回 400

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: perPage 超過 100
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?perPage=101"
      Then 回應狀態碼為 400
      And 回應錯誤訊息為 "查詢參數驗證失敗"

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: page 為 0
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles?page=0"
      Then 回應狀態碼為 400
      And 回應錯誤訊息為 "查詢參數驗證失敗"

  Rule: 只有 admin 能取得列表

    Example: 一般使用者回 403
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles"
      Then 回應狀態碼為 403
      And 回應錯誤訊息為 "權限不足"

    Example: 未登入回 401
      Given 呼叫者未登入
      When 呼叫 GET "/api/v1/profiles"
      Then 回應狀態碼為 401
      And 回應錯誤訊息為 "未登入，請先登入"

  Rule: 資料庫讀取失敗回 500

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 讀取 profiles 失敗
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      And profiles 資料表的讀取會失敗
      When 呼叫 GET "/api/v1/profiles"
      Then 回應狀態碼為 500
      And 回應錯誤訊息為 "查詢失敗，請稍後再試"
      And 回應錯誤的 data 含 why 與 fix
