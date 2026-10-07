<!-- 改寫來源：Codex Security Bridge Kit Prompt 1（Finding Evidence Explainer）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/finding-evidence-explainer.md`，對照上游新版時從那份 diff -->

# Rule 1 - 判一則 finding MUST 逐一走完十個判讀維度

- Level: `MUST`
- 本 skill 的立場是「懷疑的審查者」：scanner 給的標籤只是待驗的主張，不是證據。判讀時依序回答下列十個維度，任何一個答不出來都要寫明「答不出來」與原因，不可略過：
  1. **白話後果**：如果這條路徑走得通，攻擊者實際拿到什麼、改了什麼（讀到別人的資料、免費扣款、提權…），用非資安背景的人看得懂的話寫。
  2. **前提條件**：攻擊者需要的身分、角色、網路位置、功能開關狀態、資料擁有關係、時間點或併發條件。
  3. **Source／Control／Sink 三段**：
     - Source：攻擊者能控制的輸入或動作（路由參數、header、上傳檔、webhook payload…）。
     - Control：照理該擋下這個輸入的最近一道安全檢查，以及它在這裡怎麼失效（沒掛、條件寫反、只檢查登入沒檢查擁有者…）。
     - Sink：最後碰到的受保護對象——私有資料、狀態變更、會花錢的動作或高權限操作。
  4. **可達路徑**：從入口到影響的每一個有意義的步驟都要寫出來。只找到一段 call chain、中間有步驟靠猜，不算路徑成立。
  5. **既有控制與最強反證**：找出會擋下、縮小或推翻這個主張的 code 或設定（RLS policy、middleware、route 沒對外暴露、feature flag 關閉…），挑最強的那一條正面回應。
  6. **Proof Gap**：這次沒能查證的事實，以及要什麼證據才能補上。
  7. **Severity**：假設主張成立時的影響有多大。
  8. **Confidence**：目前證據有多強，只用 `High`／`Medium`／`Low`，並寫出理由。
  9. **Coverage**：這次看過哪些路徑、排除了哪些、哪些控制只存在於 production 而沒驗到、哪些延後處理、哪些問題還開著。
  10. **Verdict**：見 Rule 3。
- target 有 `SECURITY.md` 時，每一條 `INV-n` 都是第 5 維度找反證的依據；沒有這份就在 Confidence 理由寫明「缺安全憲法，Confidence 上限壓低」。

## Good Example

- 這個例子是好的，因為三段各自有具體位置，可達路徑沒有跳步，反證也被正面處理。

```md
- Source：`GET /api/orders/:id` 的 `id` 路由參數，任何已登入使用者都能改
- Control：預期 handler 以 `order.user_id === session.user.id` 擋下；`src/server/api/orders/[id].get.ts:14` 只呼叫 `requireUserSession()`，沒有比對擁有者
- Sink：`orders` 表整列（含收件地址、電話）
- 可達路徑：登入 → 送 `GET /api/orders/<他人 id>` → handler 以 service role client 查詢（第 18 行）→ 回傳整列
- 最強反證：`orders` 有 RLS `orders_owner_select`，但 handler 用 service role 繞過 RLS，因此不成立為反證
```

## Bad Example

- 這個例子是壞的，因為它只重述 scanner 標題，Control 沒說怎麼失效，路徑也沒有寫完。

```md
- Source：使用者輸入
- Control：權限檢查有問題
- Sink：資料庫
- 結論：scanner 標 High，應該是真的
```

# Rule 2 - Severity 與 Confidence MUST 分開判，NEVER 互相拉動

- Level: `MUST`
- Severity 回答「如果是真的會多嚴重」，Confidence 回答「我們多確定它是真的」。兩者是兩個獨立的軸。
- 證據薄弱只能壓低 Confidence，**NEVER** 因為 Confidence 低就把 Severity 往下調——影響本身沒有因為我們不確定而變小。
- **NEVER** 把 scanner 標的 `High` 直接當成 Severity 與 Confidence 都是 High；scanner 的標籤是輸入，兩個軸都要自己重判並寫理由。

## Good Example

- 這個例子是好的，因為影響大但證據不足時，兩個軸各自誠實。

```md
- Severity：High——成立時任何登入者可讀全部訂單個資
- Confidence：Low——路由是否對外暴露只有報告說法，production 的 route 設定尚未取得
```

## Bad Example

- 這個例子是壞的，因為它用「不確定」去降低影響評級。

```md
- Severity：Medium（因為還不確定是不是真的，先降一級）
- Confidence：Medium
```

# Rule 3 - Verdict 只准三選一，各有成立條件

- Level: `MUST`
- `accept`：可達路徑與影響都有證據支撐，剩下的 Proof Gap 不足以推翻核心主張。
- `needs more validation`：主張說得通，但有一個點名的 Proof Gap 可能實質確認、縮小或推翻它。必須寫出是哪一個 Gap。
- `unsupported`：主張找不到可達路徑、與更強的證據衝突，或依賴實際不存在的前提。
- 證據互相衝突時，把衝突兩邊都攤開；除非其中一邊明確推翻主張，否則一律判 `needs more validation`。
- 每個 verdict 都要另寫「這個 verdict 不能證明什麼」，避免 `accept` 被讀成「整個系統只有這個洞」、`unsupported` 被讀成「這一塊沒問題」。

## Good Example

- 這個例子是好的，因為衝突證據被攤開，verdict 指名了決定性的 Gap。

```md
- Verdict：needs more validation
- 理由：code 路徑成立（Independently Verified），但使用者說該路由在 production 只開給內網（User-Confirmed，未附設定證據），兩者衝突
- 決定性 Proof Gap：production gateway 的 route 暴露設定
- 不能證明：即使最後判 unsupported，也不代表其他 `/api/*` 路由都有擁有者檢查
```

## Bad Example

- 這個例子是壞的，因為它發明了第四種 verdict，也沒說依據哪個 Gap。

```md
- Verdict：probably fine
```

# Rule 4 - 每一條證據 MUST 標四種來源之一，NEVER 自己補事實

- Level: `MUST`
- 證據帳的每一筆都標出來源狀態，四選一：
  - `Independently Verified`：本次自己唯讀查到（附檔案與行號或指令輸出）。
  - `Report-Supplied`：只有 scanner 報告這樣說。沒有 repo 存取權時，所有 code 主張一律標這個，並在 Coverage 寫明限制。
  - `User-Confirmed`：使用者口頭或貼片段確認。
  - `Unknown`：目前沒有人能證明。
- **NEVER** 自行補上可達性、部署設定、使用者角色、production 控制或 code 內容；不知道就是 `Unknown`，並寫進 Proof Gap。
- 有檔案與行號時一定附上；沒有時寫證據出處（哪份報告、誰說的、哪個 dashboard 畫面）。

## Good Example

- 這個例子是好的，因為每筆證據都可追，沒有任何一筆是推測。

```md
| 證據 | 狀態 | 位置或出處 | 證明了什麼 |
| --- | --- | --- | --- |
| handler 只呼叫 requireUserSession | Independently Verified | src/server/api/orders/[id].get.ts:14 | 沒有擁有者比對 |
| production 使用 service role 查詢 | Report-Supplied | findings.json F-3 validation notes | 若屬實則 RLS 被繞過 |
| 路由只開內網 | User-Confirmed | 使用者 2026-10-05 口述 | 若屬實則攻擊者需內網位置 |
```

## Bad Example

- 這個例子是壞的，因為它替使用者假設了 production 設定，也沒有標狀態。

```md
- production 應該有開 RLS，所以影響有限
```

# Rule 5 - 唯讀、不碰秘密、不打 production

- Level: `MUST`
- 本 skill 只產出判讀與驗證計畫：**NEVER** 修改 code 或設定，**NEVER** 對 production 發測試或攻擊流量，**NEVER** 在沒有明確授權時對外部服務送測試請求。
- **NEVER** 要 secret 值或真實客戶資料；要的是 key 名稱、遮蔽過的設定片段與非敏感的證明（例如 policy 名稱與條件式，而不是連線字串）。
- 讀 code 只讀被點名的檔與它的直接 caller／callee；**NEVER** 無方向地爬整個 codebase。
- 驗證計畫預設排除 production 測試、實際利用與資料存取；使用者沒有明確授權時改設計成 staging 或檢視型（看設定、看 policy、看 log）的計畫，並先確認允許的環境與禁止的動作。
- verdict 是 `needs more validation` 時，驗證計畫先處理影響最大的那個 Gap，給出最小、最安全的一步。

## Good Example

- 這個例子是好的，因為它把驗證限制在 staging 與檢視，並只要非敏感證據。

```md
下一步（使用者已同意：staging 可用兩個測試帳號；production 只看不動）：
1. 在 staging 用測試帳號 A 建單、以帳號 B 請求該單 id，記錄 HTTP 狀態碼
2. 請 owner 截圖 production gateway 的 `/api/orders/*` route 暴露設定（遮掉 token）
```

## Bad Example

- 這個例子是壞的，因為它要求秘密值，並打算直接打 production。

```md
請貼 SUPABASE_SERVICE_ROLE_KEY，我用它對 production 跑一次越權請求確認。
```

# Rule 6 - No findings 只對它的 Coverage 有效

- Level: `MUST`
- 掃描回報 No findings，只代表「在這次掃描涵蓋的範圍內沒找到」。**NEVER** 把它說成整個產品安全，也 **NEVER** 因此給出 READY 或「安全」的結論。
- 引用 No findings 時一定同時寫出它的 Coverage（掃了哪些路徑、排除了什麼、哪些控制只在 production）。

## Good Example

- 這個例子是好的，因為它把 No findings 綁回掃描範圍。

```md
本次 scan（commit a1b2c3d，範圍 `src/server/**`）對 webhook 路徑回報 No findings；`src/workers/**` 不在範圍內，production 的 Stripe endpoint secret 設定也未驗。
```

## Bad Example

- 這個例子是壞的，因為它把掃描沒找到當成安全保證。

```md
掃描 No findings，webhook 這塊是安全的。
```
