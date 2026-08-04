---
description: 寫 createError 的 why / fix / internal 時，判斷哪些內容可以進 HTTP response、哪些必須只留在 log——受眾是已驗證使用者、尚未驗證的 caller、還是只有維運者
paths:
  - 'server/api/**'
  - 'server/routes/**'
  - 'server/middleware/**'
  - 'server/utils/**'
  - 'packages/*/server/utils/**'
  - 'packages/**/server/api/**'
  - 'packages/**/server/routes/**'
  - 'packages/**/server/middleware/**'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-error-exposure.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# evlog Error Exposure（why / fix / internal 的去處）

evlog 的 `why` / `fix` 會**進 HTTP response 的 `data`**（不是只進 log）。它們同時也進 wide
event。要讓某段內容只進 log，唯一去處是 `internal`——但在 Nitro v2 下需要一個 unwrap
plugin 才會生效，見 [[pitfall-evlog-nitro-plugin-error-hook-drops-internal]]。

## 落點判準

依**呼叫點所在的驗證面**與**狀態碼**決定，兩者都是可觀察的：

| 呼叫點條件 | `why` / `fix` 放哪 | 為什麼 |
| --- | --- | --- |
| `status >= 500` | `internal` | 5xx 的 `why` / `fix` 多半描述未預期的內部狀態。**只搬這兩個欄位**——`message` / `statusMessage` / `data` 照常保留：h3 現行行為就是原樣回傳它們，而 5xx 的 message 常是刻意寫的使用者文案（503 的「服務暫時無法使用」之類），換成通用字串是改變行為、不是保留 |
| **pre-auth 面**的 4xx——401 / 403，以及任何在 session 建立前就會回應的路徑（auth guard、shared-secret 驗證、rate limit、terminal/kiosk route lock） | `internal` | 受眾是**尚未通過驗證的 caller**。secret 的值沒出現不代表安全：驗證機制的操作說明（env var 名稱、header 名稱、allow-list 規則）同樣不該送給驗證失敗者 |
| **post-auth 面**的 4xx——已驗證使用者才到得了的 400 / 404 / 409 / 422 | `why` / `fix` 正常帶 | 對象是已登入使用者，`fix` 正是要給他們的行動指引 |

判別 pre-auth 的可觀察方式：這個 `createError` 在**驗證通過之前**就可能執行嗎？在 auth
middleware、guard、或 handler 裡任何 `requireRole` / `getUserSession` **之前**的分支 → 是。

## 內部識別字的處置

**post-auth 4xx 的 `why` 可以點名 schema / table**（`<consumer-b>.quotations` 這類）。不必為此重寫
文案：schema 名稱從 API 路徑與 client bundle 本來就推得出來，防線是 auth 與 RLS，不是
schema 匿名性；重寫只有編輯成本、零安全增益。

**pre-auth 面不適用上一段**——那裡的判準是受眾未經驗證，與內容像不像秘密無關。

## 完成證明

`evlog map` 的 `structured-errors` check 是 **AST 原始碼比對**：它看呼叫點的第一個參數有沒有
`why` / `fix` 這兩個 key，**不解析 `createError` 實際 resolve 到誰、也不驗欄位有沒有到達
runtime**。所以它的綠**從來不曾證明**這些欄位到過任何地方（同一命題見
[[evlog-adoption]] § 分數不是品質證明）。

完成證明 **MUST** 是實跑：一條 5xx 路由斷言 response 無 `why` / `fix`、NDJSON 的
`error.internal` 齊全；一條 post-auth 4xx 路由斷言 response 的 `data.why` / `data.fix` 存在
且 NDJSON 同步可見。命令見 `vendor/snippets/evlog-error-internal-unwrap/` § 驗證。

## 相關

- [[pitfall-evlog-nitro-plugin-error-hook-drops-internal]] — `internal` 在 Nitro v2 失效的成因與 unwrap plugin
- [[evlog-adoption]] § 分數不是品質證明 — 同一類「gate 綠 ≠ 功能生效」
- [[pitfall-evlog-catalog-silently-drops-custom-data]] — 遷移到 catalog 時 custom `data` 靜默消失
