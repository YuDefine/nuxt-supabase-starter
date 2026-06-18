---
description: 多欄位表單必用 UForm + Zod；input/textarea 必設 maxlength；placeholder 不代 label
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-form-validation.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


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

## placeholder 不代 label

`placeholder` 僅供範例提示。必填提示用 `required` / inline error，不靠 placeholder 灰字。

## Auto-generate slug 空值 fallback

從使用者輸入產生 slug / id 時，**MUST** 處理結果為空字串的 edge case（全中文 / emoji / 純符號經 `[^a-z0-9]+` replace 後為空）。
