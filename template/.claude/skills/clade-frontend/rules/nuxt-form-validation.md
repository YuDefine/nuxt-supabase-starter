---
description: 多欄位表單必用 UForm + Zod；input/textarea 必設 maxlength；placeholder 不代 label
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/nuxt-form-validation.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Form 驗證規約

## UForm + Zod（MUST）

多欄位表單 **MUST** 用 `<UForm :schema="zodSchema" :state="state" @submit="onSubmit">`。

**NEVER** 手寫 `:disabled="!field1 || !field2"` 鎖 submit — 使用者看不到缺什麼。UForm + Zod 會自動 focus 第一個錯誤欄位並 inline 提示。

## maxlength（MUST）

`<UInput>` / `<input>` / `<UTextarea>` / `<textarea>` **MUST** 設 `:maxlength`，對齊 schema / DB column 上限。

沒上限 = 對 server 開放任意長度寫入：DB column overflow 變 500、payload 無限大、UI layout 爆版。

例外：`readonly` / `disabled` input 可豁免；已有 schema `z.string().max(N)` + character counter 可省略但須註明。

## UFormField（MUST）

必填欄位的 `<UFormField>` **MUST** 有 `name` 屬性（讓 UForm 把 Zod 錯誤對應到欄位）+ `required`（UI 星號）。

## create／edit 共用一份欄位定義

同一個 resource 同時有新增與編輯表單時，欄位清單（name、label、輸入型別、必填、選項）只定義一份，兩個表單的 render、送出 body 的組裝、編輯時把 record 回填成 form state 都從它推導。**NEVER** 新增與編輯各寫一份——加欄位時漏改其中一份，編輯表單就會把那個欄位送成空值。欄位定義不取代 Zod：`UForm` 的 `:schema` 仍 **MUST** 是同一份 Zod schema。

編輯時把 record 回填成 form state、以及組送出 body，都 **MUST** 只取欄位定義列出的 key，**NEVER** 把整筆 record spread 進 form state——`id`、時間戳與 server 端才該寫的欄位會跟著被送回 endpoint。

表單要附檔案、且與純 JSON 共用同一支 endpoint 時，server 依 `Content-Type` 分流、把 FormData 依 Zod shape 轉型後過同一份 schema；最小示意見 `vendor/snippets/multipart-zod-body/`。

## placeholder 不代 label

`placeholder` 僅供範例提示。必填提示用 `required` / inline error，不靠 placeholder 灰字。

## Auto-generate slug 空值 fallback

從使用者輸入產生 slug / id 時，**MUST** 處理結果為空字串的 edge case（全中文 / emoji / 純符號經 `[^a-z0-9]+` replace 後為空）。
