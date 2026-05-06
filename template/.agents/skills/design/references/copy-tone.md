# UI Copy Tone Rules

> **Purpose**: design orchestrator 在 propose / Exit Criteria 階段套用的 UI 文案語氣硬性規則。所有 user-facing string（labels / buttons / errors / empty states / help text / placeholder / toast / modal / confirm dialog 等）**MUST** 通過此檔規則才能 ship。

---

## Golden Rule

> **若一個英文詞屬於「軟體開發範疇」(HTTP / auth / DB / system internals / dev concepts) → 一律避免顯露**
>
> **若屬於「該產品行業的專業英文關鍵字」且目標使用者群熟悉 → 可保留原文**

「目標使用者群熟悉」的判定依據是 **PRODUCT.md 的 Users 欄位**，而不是「開發者覺得使用者應該知道」。

---

## 判定流程

對每一個 user-facing 英文詞 / 技術詞：

```
這個詞屬於哪一類？
│
├── (A) 軟體開發範疇 ───────────────────→ ❌ 必改
│      HTTP / auth / DB / system / dev concepts
│      （見「黑名單」section）
│
├── (B) 該產品行業專業詞 ──→ PRODUCT.md Users 欄位寫的
│                            目標使用者群熟悉嗎？
│                            ├─ 熟悉 ─→ ✅ 可保留
│                            └─ 不熟 ─→ ❌ 改說人話
│
└── (C) 通用詞（已被一般使用者吸收）─→ ✅ 可保留
       例：下載、上傳、同步、複製、貼上
```

不確定時保守：**改人話永遠不會錯**。

---

## 黑名單：軟體開發範疇英文（一律避免顯露）

### HTTP / Network

| ❌ 不可顯露 | ✅ 替換方向 |
| --- | --- |
| `400 Bad Request` / `Bad Request` | 「資料格式有誤，請檢查欄位」 |
| `401 Unauthorized` | 「請重新登入」 |
| `403 Forbidden` | 「沒有權限執行此操作」 |
| `404 Not Found` | 「找不到這筆資料」 |
| `500 Internal Server Error` | 「系統發生錯誤，請稍後再試」 |
| `503 Service Unavailable` | 「服務暫時無法使用」 |
| `Timeout` / `Request timeout` | 「連線逾時，請稍後再試」 |
| `Network error` / `Connection refused` | 「網路連線異常」 |

### Auth / Session

| ❌ 不可顯露 | ✅ 替換方向 |
| --- | --- |
| `Token expired` / `JWT expired` | 「登入逾時，請重新登入」 |
| `Invalid token` / `Invalid credentials` | 「帳號或密碼錯誤」 |
| `Session expired` | 「您已登出，請重新登入」 |
| `OAuth callback error` | 「第三方登入失敗，請重試」 |
| `CSRF token mismatch` | 「安全驗證失敗，請重新整理頁面」 |
| `MFA required` (給非技術終端使用者) | 「請完成兩步驟驗證」 |

### Database / Backend

| ❌ 不可顯露 | ✅ 替換方向 |
| --- | --- |
| `UNIQUE constraint failed` / `Constraint violation` | 「這筆資料已存在」 |
| `Foreign key constraint` | 「無法刪除：這筆資料正被其他項目使用」 |
| `Null pointer` / `null reference` | 「找不到對應的資料」 |
| `Deadlock` / `Lock timeout` | 「資料正在處理中，請稍後再試」 |
| `Migration failed` | 「系統升級失敗，請聯絡管理員」 |
| `Sync conflict` | 「資料有衝突，請選擇要保留的版本」 |

### Dev Concepts（API / 資料結構）

| ❌ 不可顯露 | ✅ 替換方向 |
| --- | --- |
| `Payload` | 「資料」「內容」 |
| `Endpoint` | 多數情況直接拿掉，使用者不需知道 |
| `Webhook` | 「自動通知」「事件回呼」（看場景） |
| `Hash` / `Hash mismatch` | 「驗證失敗」 |
| `UUID` / `GUID` | 「識別碼」「ID」 |
| `Schema` | 「結構」「格式」 |
| `Cache` | 「暫存」（多數情況可省略） |
| `Queue` / `Pending in queue` | 「排隊處理中」 |
| `Workflow` / `Pipeline` | 「流程」 |
| `Parse` / `Parsing` | 「解析」「讀取」 |

### System Internals

| ❌ 不可顯露 | ✅ 替換方向 |
| --- | --- |
| `Memory leak` / `Out of memory` | 「系統資源不足」 |
| `Stack overflow` / `Stack trace` | 「處理失敗」 |
| `Permission denied` (filesystem) | 「沒有存取權限」 |
| `File descriptor` / `fd` | 直接拿掉 |
| `Process killed` / `SIGTERM` | 「處理被中斷」 |
| `Segmentation fault` | 「程式異常終止」 |

---

## 縮寫展開

縮寫對技術使用者是常識，對非技術使用者是雜訊。**根據 PRODUCT.md Users 欄位判定**：

| 縮寫 | 給技術使用者 | 給非技術使用者 |
| --- | --- | --- |
| `RBAC` | 可保留 | 「角色權限」 |
| `SSO` | 可保留 | 「單一登入」 |
| `CRUD` | 可保留 | 「新增 / 修改 / 刪除」 |
| `MFA` / `2FA` | 可保留 | 「兩步驟驗證」 |
| `API` | 可保留 | 「介接」「對接」 |
| `OAuth` | 可保留 | 「第三方登入」 |
| `SLA` | 商務場景可保留 | 「服務承諾」 |
| `IAM` | 雲端 / DevOps 可保留 | 「身份與權限管理」 |

---

## 中英混用反例（一律 Block）

中英混用且英文是工程詞 → **必改**：

| ❌ 反例 | ✅ 修正 |
| --- | --- |
| 「驗證 token 失敗」 | 「登入逾時，請重新登入」 |
| 「呼叫 API 中」 | 「處理中」 |
| 「正在 fetch 資料」 | 「載入中」 |
| 「commit 變更」 | 「儲存變更」 |
| 「sync 失敗」 | 「同步失敗」 |
| 「parse 錯誤」 | 「資料格式錯誤」 |
| 「server 回應慢」 | 「伺服器回應緩慢」 |
| 「請等待 backend 處理」 | 「請等待系統處理」 |

---

## 白名單：行業共識專業英文（可保留）

下列僅為**範例**。實際是否保留 **MUST** 根據 PRODUCT.md Users 欄位判斷：該詞對該行業的目標使用者是否屬於日常用語。

| 行業 | 可保留範例 | 判斷依據 |
| --- | --- | --- |
| **金融** | APR、APY、KYC、AML、ETF、IPO、ROE、P/E | 對個人金融 / 投資使用者是常識 |
| **醫療** | BMI、ICU、CT、MRI、ECG / EKG、HbA1c | 對病患與家屬是常識 |
| **電商** | SKU（賣家後台）、COD、CVS、Shopee/PCH 等平台名 | 對賣家 / 買家是常識 |
| **行銷 / SEO** | SEO、SEM、CTR、CPC、ROAS、UGC | 給行銷專業使用者 |
| **設計** | RGB、CMYK、PSD、SVG、DPI、PPI | 給設計師 |
| **物流** | LCL、FCL、ETA、ETD、HAWB、MAWB | 給貨代 / 物流人員 |
| **DX product**（目標使用者就是工程師） | API、SDK、CLI、PR、CI/CD、Repo、Branch | 工程師用語就是行業語言 |

**判定原則**：
1. 詞屬於「使用者本來就在用」的行業語言 → 可保留
2. 詞屬於「我們開發者覺得很常見」 → **不算理由**，必修
3. 不確定就保守 — 改人話一定不會錯

---

## Register × Tone 嚴格度

| Register | 嚴格度 | 說明 |
| --- | --- | --- |
| **product** | ★★★ 嚴格 | 任務 UI 必須最低認知負擔，所有開發範疇詞一律改 |
| **brand** | ★★ 中等 | 部分產業術語可作為 hero 文案張力來源；但 system error 仍需翻譯 |
| **DX product**（使用者就是工程師） | ★ 寬鬆 | 工程師用語算行業語言；仍應避免 system internals（stack trace、null pointer 等） |

---

## propose 階段套用方式（design orchestrator 用）

design orchestrator 在 propose plan 時：

1. **diagnosis 階段** — `Copy` 維度若觸發任一 black-list signal → 標 ★★☆☆☆ 以下 + 列入 Core Plan
2. **plan 階段** — Core Plan 第一個位置（DRIFT 修復之後）排 `/impeccable clarify [target]`
3. **brief `/impeccable clarify`** — 必註明 "follow `references/copy-tone.md` rules; eliminate engineering jargon; preserve only domain-appropriate terms per PRODUCT.md Users"
4. **Exit Criteria** — 加 `Copy Tone Check passed`

---

## Block 條件

未通過 Copy Tone Check 的 plan **不得**標記為完成。具體判定：

- ❌ Block — 任何 user-facing string 仍含 black-list 詞
- ❌ Block — 任何縮寫未展開但目標使用者非技術人員
- ❌ Block — 任何中英混用且英文是工程詞
- ❌ Block — 保留的英文無法在 PRODUCT.md Users 欄位推得「使用者熟悉」

通過判定後才能進 ship phase。

---

## Exception 機制

若 plan 認為某個 black-list 詞**必須**保留（如 dev tool 的 API 文件展示、給工程師看的 admin 後台、debug log viewer），需在 plan 內顯式標註：

```
Copy Tone Exception:
- 詞: <英文詞>
- 位置: <檔案 / 元件>
- 理由: <為何此 case 例外，引用 PRODUCT.md Users 欄位佐證>
```

無例外標註者按 Block 條件處理。
