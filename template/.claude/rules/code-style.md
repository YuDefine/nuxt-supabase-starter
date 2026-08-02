---
description: 寫 code 當下的 TypeScript 語法限制（type stripping 擋不掉的三條）、副檔名與 import specifier 規則、用 vp 命令驗證；工具鏈設定治理在 code-style.toolchain
paths: ['**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts}']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/code-style.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


> **工具鏈治理已拆到 [[code-style.toolchain]]**（動 `vite.config.*` / `package.json` /
> `tsconfig*.json` / `.github/workflows/**` / `.husky/**` / 任何 `rc` 或 ignore 檔時自動載入）：
> preset 是唯一設定入口、eslint / prettier 全面禁令、`vite.config.ts` 必備欄位、CI 與
> pre-commit 的命令邊界、ignore patterns 雙軌制。
>
> **要改工具鏈設定卻沒看到那份規約時 MUST 先開它**——本檔不重複那些條文，看不到不等於沒有。

# Code Style — 寫 code 當下

風格本身（single quote / no semicolons / printWidth 等）由 `vp fmt` **機械保證**，不需要記；
本檔只收機器擋不住、要寫的人自己遵守的部分。

適用範圍含 **`.vue` SFC 的 `<script setup lang="ts">` 區塊**——下面三條語法限制在 SFC 內
一樣成立，Node 的 type stripping 與 `erasableSyntaxOnly` 對它們一視同仁。

## 新增腳本一律 TypeScript

**每一個**新增的 Node 腳本都 MUST 用 TypeScript 寫，不是只有「看起來比較複雜的那幾支」。既有 `.mjs` / `.js` 不強制回頭改寫——動到它的時候順手遷移，不動就留著。

副檔名一律用 `.ts`，**不要**用 `.mts`。

`.mts` 看起來更安全（它永遠是 ESM，而 `.ts` 的模組系統由最近的 package.json `type` 決定），但實測下來那個保證換不到東西、還會壞掉：**Vite 的 config loader 無法 resolve `.mts`**。consumer 的 `vite.config.ts` 一 import 散播進去的 `.mts`，`vp check` / build 就整個掛掉（`UNRESOLVED_IMPORT`，檔案明明存在）。2026-07-31 全 fleet 實測，10 個 consumer 同時中。

`.ts` 的前提是**散播落點所在目錄的最近 package.json 必須是 `"type": "module"`**。這個前提由 `scripts/audit-governance-drift.ts` 的 consumer-module-type check 機械驗，不是靠「現在剛好都是」。

#### 三條語法限制

Node 的 type stripping 只抹除型別，不做語法轉換：

- **NEVER** 用 `enum`、`namespace`、constructor parameter properties、legacy decorators
- type-only import **MUST** 寫成 `import type { X } from '...'`
- import specifier **MUST** 帶**真實**副檔名（`import './foo.ts'`）。stripping 不做副檔名改寫，寫 `.mjs` 指向 `.ts` 檔會在 runtime 炸 `ERR_MODULE_NOT_FOUND`
  - **例外：`nuxt.config.ts` 的相對 import 一律 extensionless**（`from './vendor/doctor-shared/preset'`）。判準是**誰載這個檔**，不是風格偏好：`nuxt.config.ts` 由 Nuxt 的 config loader 載（解析得了 extensionless）**且**在 `nuxi typecheck` 的 program 內，而 TS 只有在 `allowImportingTsExtensions: true` 時才允許 `.ts` 結尾的 import——那個 flag Nuxt 4.5.x 的生成 tsconfig 有、**4.4.x 沒有**。帶副檔名在 4.4.x 上就是 `TS5097`，pre-push 的 typecheck gate 直接擋死所有 push
  - **`vite.config.ts` 反過來，MUST 保留 `.ts`**：`vp` 走 Node 原生 ESM loader 載它，extensionless 會 `ERR_MODULE_NOT_FOUND`；而它不在 `nuxi typecheck` 的 program 內，所以不觸發 `TS5097`
  - 兩個 config 檔寫法不同**不是**不一致，是各自的載入器決定的。改任何一邊之前先問「誰載它、它在不在 typecheck program 內」，**NEVER** 為了看起來整齊把兩邊統一

tsconfig **MUST** 開 `"erasableSyntaxOnly": true`，讓前兩條由 tsc 擋掉，而不是靠寫的人記得。

**NEVER** 在命令列補 `--experimental-strip-types`。Node 22.18 起 type stripping 預設開啟，這個 flag 已是 no-op；留著會讓後來的人以為跑 TS 需要特殊 flag。

#### 兩個涵蓋 gate（新增或改名成 TS 時逐項確認）

這兩層都是**靜默**失效——沒接上時不會報錯，只會安靜地什麼都不做：

1. **typecheck 涵蓋**：跑 `npx tsc -p <tsconfig> --listFiles | grep <你的檔案>` 確認它真的在編譯清單裡。**NEVER** 因為 `include` 的 glob 看起來會涵蓋就當它涵蓋
2. **test runner 涵蓋**：測試檔改副檔名後，**MUST** 比對測試**數量**與改名前相同。test glob 沒接上時 `node --test` 回報的是「0 個測試通過」，不是失敗

## 用 vp 命令做 lint / format

```bash
## 心智模型

| 情境 | 工具 | 命令 |
| --- | --- | --- |
| 寫 code 時 IDE 即時 format | oxfmt（vp 包） | IDE 設 oxfmt 為 formatter |
| 寫 code 時 IDE 即時 lint | oxlint（vp 包） | IDE 設 oxlint extension |
| 跑全專案 lint | vp | `pnpm vp lint --fix` |
| 跑全專案 format | vp | `pnpm vp fmt` |
| pre-commit | vp | `vp staged` |
| CI lint check | vp | `pnpm vp lint`（非 --fix） |
| CI format check | vp | `pnpm vp fmt --check` |

## 與其他規則的關係

- `commit.md`：commit 走 `/commit` 流程；本規則補充 commit 前 `vp staged` 應該 pass
- `development.md`（framework/nuxt 等 variant）：framework-specific 風格約定（Composition API、`<script setup>` 等）跟本規則正交，**都要遵守**

## 違反時的回報方式

```
[Code Style] 偵測到禁止的工具鏈設定

問題：<檔案路徑> 是 eslint/prettier 設定檔

修正方式：
  - 刪除該檔案
  - 改用 vp lint / vp fmt（已透過 vite-plus 安裝）
  - 若有 customization 需求，移到 vp.config.ts

繞過：
  - 若有不可避免的 peer dependency 需求，加 <bypass marker> 並在
    docs/decisions/YYYY-MM-DD-<topic>.md 記錄理由
```
