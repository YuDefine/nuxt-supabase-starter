Feature: 取得自己的 Profile
  # 從程式碼逆向。x-source: server/api/v1/profiles/me.get.ts:17-52（operationId getMyProfile）
  # 由 pnpm test:bdd（SpecFormula + Cucumber）執行；step 實作見 features/steps/profiles.steps.ts。
  # 既有 Vitest 對應：test/unit/server/api/v1/profiles/me.get.test.ts（mock，非 wire）。

  Rule: 已登入者取得自己的 profile，回應只含固定的六個欄位

    Example: 回傳自己的 profile
      Given 資料庫中有以下 profiles
        | id                                   | display_name | role |
        | <使用者甲> | 測試使用者一 | user |
      And 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/me"
      Then 回應狀態碼為 200
      And 回應 data 的 "id" 為 "<使用者甲>"
      And 回應 data 的 "display_name" 為 "測試使用者一"
      And 回應 data 的 "avatar_url" 為 "null"
      And 回應 data 的欄位恰為 "id,display_name,avatar_url,role,created_at,updated_at"

  Rule: 未登入不能取得 profile

    Example: 沒有 session 回 401
      Given 呼叫者未登入
      When 呼叫 GET "/api/v1/profiles/me"
      Then 回應狀態碼為 401
      And 回應錯誤訊息為 "未登入，請先登入"

  Rule: 登入者在 profiles 沒有對應列時回 404

    Example: profile 尚未建立
      Given 資料庫中沒有 profile "<無檔案使用者>"
      And 呼叫者是使用者 "<無檔案使用者>"，角色為 "member"
      When 呼叫 GET "/api/v1/profiles/me"
      Then 回應狀態碼為 404
      And 回應錯誤訊息為 "找不到您的 Profile"
      And 回應不含 PostgREST 診斷欄位

  Rule: 資料庫讀取失敗回 500，且不洩漏資料庫診斷文字

    Example: 讀取 profiles 失敗
      Given 呼叫者是使用者 "<使用者甲>"，角色為 "member"
      And profiles 資料表的讀取會失敗
      When 呼叫 GET "/api/v1/profiles/me"
      Then 回應狀態碼為 500
      And 回應錯誤訊息為 "查詢失敗，請稍後再試"
      And 回應不含 PostgREST 診斷欄位
