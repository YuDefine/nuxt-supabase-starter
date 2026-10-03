@unverified
Feature: 依 id 取得單筆 Profile
  # 從程式碼逆向。x-source: server/api/v1/profiles/[id].get.ts:27-76（operationId getProfileById）
  # 整支 feature 標 @unverified：目前沒有 Gherkin runner（specs/truth/techstack.md § 測試）。
  # 既有 Vitest 對應：test/unit/server/api/v1/profiles/[id].get.test.ts、observability.test.ts（mock，非 wire）。

  Background:
    Given 資料庫中有以下 profiles
      | id                                   | display_name | role  |
      | <使用者甲> | 測試使用者一 | user  |
      | <管理員甲> | 管理員       | admin |

  Rule: 本人可以讀自己的 profile

    Example: 讀自己
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 200
      And 回應 data 的 "display_name" 為 "測試使用者一"

  Rule: admin 可以讀任意 profile

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: admin 讀別人
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 200
      And 回應 data 的 "display_name" 為 "測試使用者一"

  Rule: 非本人且非 admin 回 404 而不是 403，且不查資料庫

    Example: 一般使用者讀別人
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/<管理員甲>"
      Then 回應狀態碼為 404
      And 回應錯誤訊息為 "找不到指定的 Profile"
      And profiles 資料表沒有被查詢

  Rule: 不存在的 profile 與無權限的 profile 對外不可區分

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: admin 讀不存在的 id
      Given 資料庫中沒有 profile "<不存在者>"
      And 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles/<不存在者>"
      Then 回應狀態碼為 404
      And 回應錯誤訊息為 "找不到指定的 Profile"
      And 回應錯誤的 data 含 why 與 fix

  Rule: 未登入回 401

    Example: 沒有 session
      Given 呼叫者未登入
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 401
      And 回應錯誤訊息為 "未登入，請先登入"

  Rule: id 不是 UUID 回 400，且驗證先於授權檢查

    Example: 非 UUID 的 id
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/not-a-uuid"
      Then 回應狀態碼為 400
      And 回應錯誤訊息為 "路由參數驗證失敗"

  Rule: 出廠種子使用者的 id 無法通過 UUID 驗證（現況鎖定，非期望行為）
    # [need clarification] Q-profiles-1 supabase/seed.sql 的 a1111111-1111-1111-1111-111111111111
    #   不符合 zod 4 的 uuid（第三、四組的版本與變體位元不合 RFC 4122）；
    #   shared/schemas/profiles.ts:37 的 profileIdParamSchema 因此回 400。實測 zod 4.3.6 的 safeParse 回 false。
    # [need clarification] Q-profiles-8 字面 UUID 無法經 dev-login 取得 session（id 由 Better Auth 指派），此 Example 的 Given 在現有機制下無法實作。

    # [need clarification] Q-profiles-9 session 沒有角色機制，此 Example 的 admin Given 在現有程式碼下無法讓 session 取得 admin（requireRole／[id].get.ts 會判 403／404）。
    Example: 用種子 id 查詢
      Given 呼叫者是使用者 "a1111111-1111-1111-1111-111111111111"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles/a1111111-1111-1111-1111-111111111111"
      Then 回應狀態碼為 400
      And 回應錯誤訊息為 "路由參數驗證失敗"

  Rule: 資料庫讀取失敗回 500

    Example: 讀取 profiles 失敗
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      And profiles 資料表的讀取會失敗
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 500
      And 回應錯誤訊息為 "查詢失敗，請稍後再試"
      And 回應錯誤的 data 含 why 與 fix
