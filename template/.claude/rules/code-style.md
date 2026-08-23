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

#### `strict: false` 覆蓋範圍內：union 判定用 equality，不用 truthiness

在 `"strict": false`（連帶 `strictNullChecks: false`）的 tsconfig 覆蓋下，TypeScript 的
**truthiness narrowing 對 discriminated union 不生效**——`if (!x.ok)` 之後 `x` 仍是整個 union，
存取只在某一分支上的欄位就報 `TS2339 Property 'error' does not exist on type '{ ok: true }'`。
equality narrowing 不受影響。

**該範圍內的每一處 union 判定**都 MUST 用 equality，不是只有「報錯的那一行」：

```ts
if (x.ok === false) { … }   // ✅ literal 比較，strictNullChecks 開關不影響
if (!x.ok) { … }            // ❌ strict:false 下不 narrow
if (x.ok) { … }             // ❌ 正向分支同樣不 narrow，用 x.ok === true
```

**NEVER** 用 `as` 斷言或替 `{ ok: true }` 分支補 optional 欄位繞過——前者丟掉檢查，後者讓兩個
分支不再互斥，都是把型別系統關掉而不是用對它。

clade 端的覆蓋範圍是 `tsconfig.vendor.json` 的 `include`（`vendor/scripts/**`、`vendor/signals/*`、
`vendor/actions/**`、`vendor/oxc-shared/*`、`vendor/doctor-shared/*`、`vendor/review-rules/*`）。
**判準是「這個檔落在哪份 tsconfig 底下」，不是目錄名**——改動前不確定就跑
`npx tsc -p <tsconfig> --listFiles | grep <你的檔案>`（同下節 gate 1）。

本機 `node` 跑 `.ts` 只做 type stripping、**完全不檢查型別**，所以功能測試全綠不代表寫法正確；
這類錯誤只在 typecheck 才現形。成因與實測見 [[pitfall-strict-false-disables-truthiness-narrowing]]。

#### 兩個涵蓋 gate（新增或改名成 TS 時逐項確認）

這兩層都是**靜默**失效——沒接上時不會報錯，只會安靜地什麼都不做：

1. **typecheck 涵蓋**：跑 `npx tsc -p <tsconfig> --listFiles | grep <你的檔案>` 確認它真的在編譯清單裡。**NEVER** 因為 `include` 的 glob 看起來會涵蓋就當它涵蓋
2. **test runner 涵蓋**：測試檔改副檔名後，**MUST** 比對測試**數量**與改名前相同。test glob 沒接上時 `node --test` 回報的是「0 個測試通過」，不是失敗

## 失敗要留痕：寫 `catch → 空值` 之前先分類（MUST）

**核心命題**：「解不出 → 回 `null` → 保守放行」把**兩件語義完全不同**的事塌成同一個值，而下游只看得到「有 / 沒有」。故障於是渲染成缺席，而缺席跟「本來就不適用」在畫面上無法區分——發現者永遠變成使用者。

**每一個** `catch` 回 `null` / `[]` / `{}` / `false` / `undefined` 的點，落筆前 **MUST** 歸到下表其中一類，不是只處理「看起來比較重要的那幾個」：

| 類別 | 可觀察判準 | 處置 |
| --- | --- | --- |
| **真不適用** | 這個否定答案是**預期內**的正常結果（`new URL(x)` 對一段本來就不是 URL 的文字 throw；探測「有沒有別的 server 在跑」得到 connection refused） | 照舊回空值，不記 |
| **嘗試過但失敗** | 本來**應該**拿得到（檔案在但讀不到、JSON 壞掉、外部命令沒裝或被拒、權限不足） | **MUST** 先 `recordDiagnostic()` 之類的留痕再回空值，訊息要寫出「因此下游會少掉什麼」 |

**判不出來 default 記**——多一條灰色提示的成本，遠低於下一個只有人踩得到的 bug。

```ts
// 真不適用 → 照舊回 null，不記
try { return new URL(token) } catch { return null }

// 嘗試過但失敗 → 記一筆再回 null
try { src = readFileSync(routeFile, 'utf8') } catch (err) {
  recordDiagnostic('role-list-unreadable', `${routeFile} 解不出 role 清單（${err.message}）——寫錯 role 的 item 不會再被標出來`)
  return null
}
```

**三態 NEVER 塌成布林**：「沒有」與「問不出來」是兩件事。探測類函式回 `none`（確認沒有）/ `unknown`（有但問不出身分）/ `known`，`unknown` **MUST** 照樣出警示——**「不知道」不等於「沒問題」**。

**全域掃描的前置條件讀不到 MUST `throw` + 非 0 exit，NEVER 回空結果**：`consumers.local` 之類的清單來源讀不到時回 `total 0`，跟「掃過了、fleet 乾淨」在輸出上一模一樣。這條對**新寫的** script 同樣適用——2026-08-02 當天寫的新 audit script 自己就犯了一次。

**子程序 / 多出口的失敗 MUST 在單一出口收**：二十個 `return 'failed'` 前面各印一行 `✘ <原因>`，卻沒有一個寫進 `metrics.error`，結尾摘要就會印「（無 error 記錄）」。修法是在 log 的**單一出口**認出 `✘` 前綴時寫進 error 集合，**NEVER** 逐個出口補。

> **為什麼測試接不住**：現有測試測的是 graceful degradation 的**結果**，不是 degradation 有沒有**留下痕跡**。「回 null 不 throw」在單元測試裡看起來永遠是對的——那正是它通過的原因。要接住得對每個 `catch → 空值` 點注入失敗，斷言 diagnostic 存在。（per [[pitfall-silent-null-renders-failure-as-absence]]）

## CLI script 的 stdout 收尾：會被 pipe 消費就 MUST 等 flush（MUST）

**核心命題**：Node 的 `process.stdout` 導向 **pipe** 時是非同步寫入、導向**檔案**時是同步寫入。
所以 `process.stdout.write(payload)` 緊接 `process.exit()` **只在 pipe 那條路徑**丟尾段——同一支
script 重導到檔案完整無缺、接 `| jq` 卻截斷。**只驗過寫檔路徑的人拿到的是真的全綠**。

**每一個** CLI script 的每一個 `process.exit()` 出口，落筆前 MUST 用下表判一次，不是只處理
「輸出看起來最長的那一個」：

| 可觀察 predicate | 處置 |
| --- | --- |
| 這支有 `--json` / `--markdown` 之類**給程式消費**的輸出模式，或任何文件 / 規約 / gate 裡出現過 `<這支> \| <consumer>` 的用法 | **MUST** 走下面的 `writeThenExit`，每個出口都要 |
| 輸出只走 stderr，或只寫檔，或恆為固定幾行且沒有任何 pipe 消費者 | 照舊 `process.exit(code)` |

判不出來 default 走 `writeThenExit`——它的成本是一個 await，錯過的成本是下游拿到**語法上合法但被
截斷**的 JSON。

```ts
async function writeThenExit(payload: string, code: number): Promise<never> {
  await new Promise<void>((resolve) => process.stdout.write(payload, () => resolve()))
  process.exit(code)
}
```

**NEVER 改成裸的 `process.exitCode = code`**——它確實會讓 Node 跑完 event loop 才退出、也確實會把
尚未 flush 的 stdout 寫完，但有未關閉 handle 時會從「截斷」變成「掛住」，比原本更難診斷（CI 上表現為
無訊息的 timeout）。要的是 flush callback，不是拿掉 exit。

**NEVER 用「這支輸出很短 / 沒破 64 KB」當跳過的理由**：風險子集的正確定義是
**「輸出量體隨資料單調成長 ∧ 有 pipe 消費者」**，不是當下的絕對量體。2026-08-13 實測推翻量體篩選——
真形狀的三支當下各 50 B / 1.6 KB / 未測，全遠低於 64 KB，而真正出事那支是 128 KB；差別在量體**由什麼
驅動**，consumer 數或 finding 數一長它就會過線，而過線那天沒有任何東西會轉紅。

**驗這條 MUST 用多次小 write 當 control，NEVER 用單次大 write**：500 KB 單次 `write` 在裸 exit 下
兩版都不截斷，量出來是**假陰性**。可複驗的雙向 control（2026-08-24 實測）：

```bash
# 20000 次小 write + 裸 exit → pipe 丟 13.6%（17281/20000），同段 code 重導到檔案 20000/20000
# 同樣 20000 行改走 writeThenExit → pipe 20000/20000
```

> **為什麼測試接不住**：單元測試呼叫的是函式、不是 CLI 進程，`process.exit` 那一步根本不在測試路徑上；
> 而端到端測試多半把輸出重導到檔案或用 `execFileSync` 收 stdout（兩者都是同步路徑）。這條只有在
> **真的接一個 pipe consumer** 時才會現形。（per [[TD-488]]）

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
