Feature: 依 id 取得單筆 Profile
  # 從程式碼逆向。x-source: server/api/v1/profiles/[id].get.ts:27-76（operationId getProfileById）
  # 由 pnpm test:bdd（SpecFormula + Cucumber）執行；step 實作見 features/steps/profiles.steps.ts。
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

    # TD-026 D3：admin 判定讀 DB profiles.role（<管理員甲> 列的 role=admin），
    # session 不攜帶也不被信任。
    Example: admin 讀別人
      Given 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 200
      And 回應 data 的 "display_name" 為 "測試使用者一"

  Rule: 非本人且非 admin 回 404 而不是 403，且不查目標列

    # TD-026 D3：授權的角色查詢（select=role）是允許的；斷言的是「目標資料列
    # 沒有在授權失敗前被讀出」。
    Example: 一般使用者讀別人
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/<管理員甲>"
      Then 回應狀態碼為 404
      And 回應錯誤訊息為 "找不到指定的 Profile"
      And profiles 資料表的資料列沒有被讀取

  Rule: 不存在的 profile 與無權限的 profile 對外不可區分

    Example: admin 讀不存在的 id
      Given 資料庫中沒有 profile "<不存在者>"
      And 呼叫者是使用者 "<管理員甲>"，角色為 "admin"
      When 呼叫 GET "/api/v1/profiles/<不存在者>"
      Then 回應狀態碼為 404
      And 回應錯誤訊息為 "找不到指定的 Profile"
      And 回應不含 PostgREST 診斷欄位

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

  Rule: 資料庫讀取失敗回 500

    Example: 讀取 profiles 失敗
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      And profiles 資料表的讀取會失敗
      When 呼叫 GET "/api/v1/profiles/<使用者甲>"
      Then 回應狀態碼為 500
      And 回應錯誤訊息為 "查詢失敗，請稍後再試"
      And 回應不含 PostgREST 診斷欄位
