<!-- 改寫來源：Codex Security Bridge Kit Prompt 2（Production Blind-Spot Mapper）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/production-blind-spot-mapper.md`，對照上游新版時從那份 diff -->

# Rule 1 - 證據 MUST 分五層記，即使支撐同一條規則也不混

- Level: `MUST`
- 本 skill 在 map mode 的工作，是把「repo 證明了什麼」「staging 還得示範什麼」「production 設定還得確認什麼」「哪些落在第三方或營運、根本不在 code 掃描範圍內」分開。五層如下：
  - **Repository**：原始碼、測試、已 commit 的設定、掃描產物。重點看：Authentication、Authorization、資料擁有者檢查、webhook 簽章驗證、交易邊界、上傳檔驗證、rate limit、secret 處理、部署宣告、測試、logging。
  - **Staging**：在非 production 環境安全地實跑的測試。典型項目：用測試帳號跨帳號存取、同一個 webhook 重送、併發扣點、過期下載連結、超大檔案、授權失敗、rollback 與復原。
  - **Production**：目前實際生效的 IAM、資料庫（row policy）、storage 權限、secret、網路與部署設定。
  - **Third Party**：金流、AI、身分驗證、email、analytics、DNS 與其他供應商後台的設定。
  - **Operations**：log、告警、備份與還原演練、secret 汰換流程、事故應變聯絡人、網域保護，以及 agent 能做什麼的控制。
- 同一條安全規則（例如「使用者只能讀自己的訂單」）在 repo 有測試、在 production 有 RLS，要在兩層各記一筆，**NEVER** 用 repo 層的測試替 production 層打勾。
- staging 與 production 有實質差異（例如 staging 沒開 RLS、金流用不同帳號）時，要逐條寫出哪些結論**不能**從 staging 搬到 production。

## Good Example

- 這個例子是好的，因為同一條規則在兩層各自有狀態，staging 的落差也講清楚。

```md
- 規則：使用者只能讀自己的訂單
  - Repository：`test/orders-owner.test.ts` 覆蓋 GET／PATCH → Confirmed
  - Production：`orders_owner_select` policy 是否已啟用 → Needs Production Check
- staging 落差：staging 的 Supabase 專案沒有啟用 RLS，跨帳號測試結果不能代表 production
```

## Bad Example

- 這個例子是壞的，因為它用 repo 的測試替 production 背書。

```md
- 訂單擁有者檢查：有測試 → 全部 Confirmed
```

# Rule 2 - 每條規則記七個欄位，狀態只准四值

- Level: `MUST`
- 每一條安全規則或風險都記：預期控制、通過條件、目前證據、狀態、Proof Gap、owner、期限。
- 狀態只准四個值：`Confirmed`、`Needs Test`、`Needs Production Check`、`Unknown`。
- **NEVER** 把缺證據當成通過：沒證據就是 `Unknown` 或 `Needs Production Check`。
- **NEVER** 自己編 owner、期限、供應商設定、已完成的測試或已通過的控制。問不到 owner 就寫 `Owner Missing`，**NEVER** 自行指派。
- 每一個未結項目都要有具體的通過條件，以及蒐集非敏感證據最安全的方式。

## Good Example

- 這個例子是好的，因為通過條件可觀察，蒐證方式不碰秘密，owner 缺就照實寫。

```md
- 規則：Stripe webhook 只接受簽章正確的請求
- 預期控制：handler 以 endpoint secret 驗 `stripe-signature`
- 通過條件：staging 送一筆簽章錯誤的事件，回 400 且不寫入 `payments`
- 目前證據：`src/server/api/stripe/webhook.post.ts:8` 有呼叫 `constructEvent`（Repository）
- 狀態：Needs Test
- Proof Gap：production 的 endpoint secret 是否為正式環境那一把
- 安全蒐證：請 owner 在 Stripe 後台截 endpoint 清單（遮掉 secret），比對 URL 與建立日期
- Owner：Owner Missing
- 期限：上線前
```

## Bad Example

- 這個例子是壞的，因為它發明了狀態值，也替使用者指派了 owner。

```md
- 狀態：Probably OK
- Owner：後端工程師（我先指定）
```

# Rule 3 - 優先序依「缺了會發生什麼」分 P0／P1／P2

- Level: `MUST`
- **P0 Blocker**：缺證據或控制失效時，可能造成私有資料外洩、未授權的金錢或狀態變更、secret 外洩、管理者帳號被拿下、不受控的外部副作用，或無上限的付費工作。
- **P1 Before Launch**：有意義的防護或偵測還沒完成，但有更強的前提或補償控制限制了立即影響。
- **P2 Hardening**：縱深防禦、復原能力或營運成熟度的改善，目前沒有已示範的高影響路徑。
- 未結項目依 P0 → P1 → P2 排；同一優先級內，把「最便宜就能下定論」的證據排前面。
- 任何會寫外部系統或花錢的 agent，都要記它的權限邊界、核准條件、花費或速率上限、停止機制；這一塊沒有證據時至少是 P1，能無上限花錢或對外發送時是 P0。

## Good Example

- 這個例子是好的，因為 AI 呼叫沒有上限被正確歸為 P0，並排在最便宜的蒐證之後。

```md
#### P0 Blockers
1. production 訂單 RLS 是否啟用（看 policy 清單即可，5 分鐘）
2. 背景 worker 呼叫 AI provider 沒有花費上限（需改設定，半天）
```

## Bad Example

- 這個例子是壞的，因為會無上限花錢的項目被放到 P2，而且順序依提出先後而不是成本。

```md
#### P2 Hardening
- AI provider 沒設花費上限，之後再看
```

# Rule 4 - verdict 只准三值，而且一定有範圍

- Level: `MUST`
- `BLOCKED`：至少一個 P0 Blocker 尚未解決。
- `CONDITIONAL`：沒有已知失效的 P0 控制，但還有實質的 P1 檢查或 Proof Gap。
- `READY FOR REVIEWED SCOPE`：所述範圍內每一個 P0 與 P1 項目都有通過的證據。這個 verdict **MUST** 列出審查範圍與日期（含 repo 狀態，例如 commit），且 **NEVER** 暗示整個產品安全。
- **NEVER** 因為掃描回 No findings 就給出通過的上線 verdict——No findings 只是 Repository 層、該次 Coverage 範圍內的一筆證據。
- 每個 verdict 都要另寫「這個 verdict 不能證明什麼」。

## Good Example

- 這個例子是好的，因為 No findings 只被當成 repo 層證據，verdict 沒有超出範圍。

```md
- Verdict：CONDITIONAL
- 範圍：web app 與 API（commit a1b2c3d，2026-10-05）；不含行銷站與內部後台
- 理由：無已知失效的 P0；production RLS 與 Stripe endpoint secret 兩項 P1 尚待確認
- 不能證明：scan 回 No findings 只涵蓋 `src/server/**`，worker 與第三方設定不在其內
```

## Bad Example

- 這個例子是壞的，因為它把掃描結果翻成全域安全宣稱，也沒有範圍與日期。

```md
- Verdict：READY（掃描 No findings，系統安全）
```

# Rule 5 - map 只是驗證計畫，NEVER 動 production

- Level: `MUST`
- 產出的地圖在使用者另外授權具體動作之前，只是一份驗證計畫。
- **NEVER** 修改 production、送實際攻擊流量、改 IAM、輪換 key 或改第三方設定。
- **NEVER** 要求、顯示或保存 secret 值或真實客戶資料；問 production 控制時問「誰能看、怎麼在不露出憑證的前提下證明」。
- 沒有 repo 存取權時，請使用者貼相關片段，證據標成使用者提供，並在 Repository 層 Coverage 寫明限制；完全沒有既有安全脈絡時照樣往下，但 Repository 層 Coverage 記為 `Unknown`。

## Good Example

- 這個例子是好的，因為它只要求可驗證、非敏感的證據。

```md
production RLS 確認方式：請有 DB dashboard 權限的人截 `orders` 的 policy 清單（名稱與 USING 條件），不需要連線字串或 service role key。
```

## Bad Example

- 這個例子是壞的，因為它要求 secret，並準備自己動 production。

```md
請給我 production 的 DB 密碼，我直接上去把 RLS 打開再驗。
```
