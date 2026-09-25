---
description: 寫 code 當下的 TypeScript 語法限制（type stripping 擋不掉的三條）、副檔名與 import specifier 規則、命名與註解（機器擋不住的那一半）、用 vp 命令驗證；工具鏈設定治理在 code-style.toolchain
paths: ['**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts}']
---
<!-- Clade native rule; source: rules/core/code-style.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

> **工具鏈治理在 [[code-style.toolchain]]**（動 `vite.config.*` / `package.json` / `tsconfig*.json` /
> `.github/workflows/**` / `.husky/**` / 任何 `rc` 或 ignore 檔時適用；沒看到那份規約時 MUST 先開它）。
>
> **format/lint check 紅了 MUST 立刻 `pnpm format` / lint fix 再 check 到綠**（不限 `/commit`、
> 不等 CI）——全文在 [[code-style.toolchain]] § Agent 義務：check 紅了立刻 fix。

# Code Style — 寫 code 當下

風格本身由 `vp fmt` 機械保證；本檔只收機器擋不住的部分。適用範圍含 `.vue` SFC 的 `<script setup lang="ts">` 區塊。

## 新增腳本一律 TypeScript

**每一個**新增的 Node 腳本都 MUST 用 TypeScript 寫，不是只有「看起來比較複雜的那幾支」。既有 `.mjs` / `.js` 不強制回頭改寫——動到它的時候順手遷移，不動就留著。

副檔名一律用 `.ts`，**不要**用 `.mts`。

Vite 的 config loader 無法 resolve `.mts`（`UNRESOLVED_IMPORT`）。`.ts` 的前提是散播落點最近的 package.json 為 `"type": "module"`，由 `scripts/audit-governance-drift.ts` 的 consumer-module-type check 機械驗。

#### 三條語法限制

Node 的 type stripping 只抹除型別，不做語法轉換：

- **NEVER** 用 `enum`、`namespace`、constructor parameter properties、legacy decorators
- type-only import **MUST** 寫成 `import type { X } from '...'`
- import specifier **MUST** 帶**真實**副檔名（`import './foo.ts'`）。stripping 不做副檔名改寫，寫 `.mjs` 指向 `.ts` 檔會在 runtime 炸 `ERR_MODULE_NOT_FOUND`
  - **例外：`nuxt.config.ts` 的相對 import 一律 extensionless**：它由 Nuxt loader 載且在 `nuxi typecheck` program 內，Nuxt 4.4.x 生成的 tsconfig 沒有 `allowImportingTsExtensions`，帶 `.ts` 會 `TS5097`
  - **`vite.config.ts` 反過來，MUST 保留 `.ts`**：`vp` 走 Node 原生 ESM loader，extensionless 會 `ERR_MODULE_NOT_FOUND`
  - 判準是「誰載它、它在不在 typecheck program 內」，**NEVER** 為了看起來整齊把兩邊統一

tsconfig **MUST** 開 `"erasableSyntaxOnly": true`，讓前兩條由 tsc 擋掉，而不是靠寫的人記得。

**NEVER** 在命令列補 `--experimental-strip-types`（Node 22.18+ 預設開啟，是 no-op）。

#### `strict: false` 覆蓋範圍內：union 判定用 equality，不用 truthiness

`"strict": false` 下 truthiness narrowing 對 discriminated union 不生效（`TS2339`），equality narrowing 不受影響。

**該範圍內的每一處 union 判定**都 MUST 用 equality，不是只有「報錯的那一行」：

```ts
if (x.ok === false) { … }   // ✅ literal 比較，strictNullChecks 開關不影響
if (!x.ok) { … }            // ❌ strict:false 下不 narrow
if (x.ok) { … }             // ❌ 正向分支同樣不 narrow，用 x.ok === true
```

**NEVER** 用 `as` 斷言或替 `{ ok: true }` 分支補 optional 欄位繞過。

判準是「這個檔落在哪份 tsconfig 底下」（clade 端是 `tsconfig.vendor.json` 的 `include`），不是目錄名；不確定就跑下節 gate 1。`node` 跑 `.ts` 不檢查型別，功能測試全綠不代表寫法正確（[[pitfall-strict-false-disables-truthiness-narrowing]]）。

#### 兩個涵蓋 gate（新增或改名成 TS 時逐項確認）

1. **typecheck 涵蓋**：跑 `npx tsc -p <tsconfig> --listFiles | grep <你的檔案>` 確認它真的在編譯清單裡。**NEVER** 因為 `include` 的 glob 看起來會涵蓋就當它涵蓋
2. **test runner 涵蓋**：測試檔改副檔名後，**MUST** 比對測試**數量**與改名前相同。test glob 沒接上時 `node --test` 回報的是「0 個測試通過」，不是失敗

## 失敗要留痕：寫 `catch → 空值` 之前先分類（MUST）

「解不出 → 回 `null`」把故障與「本來就不適用」塌成同一個值，故障就渲染成缺席。

**每一個** `catch` 回 `null` / `[]` / `{}` / `false` / `undefined` 的點，落筆前 **MUST** 歸到下表其中一類，不是只處理「看起來比較重要的那幾個」：

| 類別 | 可觀察判準 | 處置 |
| --- | --- | --- |
| **真不適用** | 這個否定答案是**預期內**的正常結果（`new URL(x)` 對一段本來就不是 URL 的文字 throw；探測「有沒有別的 server 在跑」得到 connection refused） | 照舊回空值，不記 |
| **嘗試過但失敗** | 本來**應該**拿得到（檔案在但讀不到、JSON 壞掉、外部命令沒裝或被拒、權限不足） | **MUST** 先 `recordDiagnostic()` 之類的留痕再回空值，訊息要寫出「因此下游會少掉什麼」 |

**判不出來 default 記。**

```ts
// 真不適用 → 照舊回 null，不記
try { return new URL(token) } catch { return null }

// 嘗試過但失敗 → 記一筆再回 null
try { src = readFileSync(routeFile, 'utf8') } catch (err) {
  recordDiagnostic('role-list-unreadable', `${routeFile} 解不出 role 清單（${err.message}）——寫錯 role 的 item 不會再被標出來`)
  return null
}
```

**三態 NEVER 塌成布林**：探測類函式回 `none` / `unknown` / `known`，`unknown` **MUST** 照樣出警示。

**全域掃描的前置條件（如 `consumers.local`）讀不到 MUST `throw` + 非 0 exit，NEVER 回空結果**——`total 0` 與「fleet 乾淨」同形。

**子程序 / 多出口的失敗 MUST 在單一出口收**（例：在 log 單一出口認出 `✘` 前綴寫進 error 集合），**NEVER** 逐個出口補。

測試要接住，得對每個 `catch → 空值` 點注入失敗並斷言 diagnostic 存在（[[pitfall-silent-null-renders-failure-as-absence]]）。

## 型別宣告 NEVER 代替驗證：把假設搬家不等於查證（MUST）

把未經驗證的形狀假設從 consume site 移到宣告處（`as unknown as X` → `.overrideTypes<X>()`、`satisfies`、手寫 `interface`）讓靜態檢查轉綠，驗證總量卻是零。

**每一次**把型別從 consume site 搬到宣告處時，**MUST** 先對那個型別的**每一個**欄位查出執行期實際形狀，
不是只查「看起來可疑的那幾個」。查不到就 **NEVER** 宣告——留著原本的斷言，它至少誠實。

最常踩的一格是 **PostgREST embed 的基數**：多對一執行期是**物件**，一對多才是**陣列**。
宣告成陣列時 consume site 補的 `[0]` 對物件恆為 `undefined`，被後面的 `?.` 吞掉。

- 判基數的唯一決定性依據是 migration 的 `REFERENCES`（FK 欄位長在哪一張表上）。
  **NEVER** 從既有型別、變數命名或複數形推——generated types 裡一對多關聯常是陣列，形狀相近、肉眼難分
- 查法、四條 NEVER、override 型別的正確寫法：`~/offline/clade/vendor/snippets/postgrest-embed-cardinality/`

**NEVER 把「typecheck 0 error + doctor 100/100 + 測試全綠」讀成這批改動安全**——三者對「宣告與執行期形狀不一致」都結構性盲（[[pitfall-overridetypes-declares-many-to-one-embed-as-array]]）。

## CLI script 的 stdout 收尾：會被 pipe 消費就 MUST 等 flush（MUST）

`process.stdout` 導向 pipe 時非同步、導向檔案時同步，所以 `write` 緊接 `process.exit()` 只在 pipe 路徑丟尾段。

**每一個** CLI script 的每一個 `process.exit()` 出口，落筆前 MUST 用下表判一次，不是只處理
「輸出看起來最長的那一個」：

| 可觀察 predicate | 處置 |
| --- | --- |
| 這支有 `--json` / `--markdown` 之類**給程式消費**的輸出模式，或任何文件 / 規約 / gate 裡出現過 `<這支> \| <consumer>` 的用法 | **MUST** 走下面的 `writeThenExit`，每個出口都要 |
| 輸出只走 stderr，或只寫檔，或恆為固定幾行且沒有任何 pipe 消費者 | 照舊 `process.exit(code)` |

判不出來 default 走 `writeThenExit`。

```ts
async function writeThenExit(payload: string, code: number): Promise<never> {
  await new Promise<void>((resolve) => process.stdout.write(payload, () => resolve()))
  process.exit(code)
}
```

**NEVER 改成裸的 `process.exitCode = code`**——有未關閉 handle 時會從截斷變成掛住。

**NEVER 用「這支輸出很短 / 沒破 64 KB」當跳過的理由**：風險判準是「輸出量體隨資料成長 ∧ 有 pipe 消費者」。

**驗這條 MUST 用多次小 write（如 20000 次）接真的 pipe 當 control，NEVER 用單次大 write**（假陰性）；重導到檔案或 `execFileSync` 都走同步路徑，驗不到（[[TD-488]]）。

## 用 vp 命令做 lint / format

lint `pnpm vp lint --fix`、format `pnpm vp fmt`；CI 跑 `pnpm vp lint` 與 `pnpm vp fmt --check`；pre-commit 走 `bash scripts/pre-commit/runner.sh`，commit 前應 pass。

## 命名：機器擋不住的那一半

oxlint 判不了 `accountList` 到底是不是 List。本節純 review 層，無機械訊號；消費端是
`code-review` agent 的程式碼品質 checklist。

### 名字要能回答「為什麼」

一個名字若需要旁邊那行註解才看得懂，MUST 改名到那行註解變成冗詞。**每一個**需要「翻譯」
才能讀的名字都算——不是只處理「看起來最怪的那幾個」。

```ts
const d = 86400 // 一天的秒數     // ❌ 註解在做名字該做的事
const SECONDS_PER_DAY = 86400    // ✅
```

### NEVER 讓名字對型別說謊

名字帶 `List` / `Map` / `Count` / `isX` / `hasX` 時，值 MUST 真的是那個型別。型別系統擋得住
`accountList: Account`，擋不住 `accountList: AccountBag`。

```ts
const accountList: AccountBag = bag  // ❌ 名字說 List，值是 Bag
const accounts: AccountBag = bag     // ✅
const isReady = 0                    // ❌ isX 不是 boolean
```

### 可搜尋 > 簡短

magic number 與單字母名 MUST 換成可 grep 的具名常數。一行 lambda 的參數（`.map(x => x.id)`）除外。

```ts
if (status === 3) wait(5000)   // ❌ 3 與 5000 搜不到語意
const STATUS_PENDING = 3
const RETRY_DELAY_MS = 5000
```

### NEVER 用這三種名字

- Hungarian 前綴（`strName` / `iCount` / `bReady`）——型別系統已經在講型別
- 不可發音的縮寫（`genymdhms` / `btnMgr`）
- 只差 `Info` / `Data` / `2` 的一對名字（`User` vs `UserInfo`、`load` vs `load2`）

判準：caller 不必打開實作就能選對哪一個。選不出來 = 這組名字還沒取完。

## 註解：預設不寫，寫了就要對

closing-brace tag（`} // end`）與檔頭 changelog / `@author` 由 `vendor/review-rules/patterns.json` 機械掃（warning）；banner 分隔線與其餘判準留在 review 層（`code-review` agent 程式碼品質 checklist）。

### 註解預設不寫

想寫註解解釋一段複雜布林邏輯時，MUST 先抽成具名 local variable 或 helper。抽出後還需要註解
才看得懂的，才寫。

```ts
// ❌ 註解在翻譯布林
// 員工在職且通過考核，或主管特批
if ((e.status === 'active' && e.score >= 80) || e.override) { ... }

// ✅ 名字就是註解
const eligible = e.status === 'active' && e.score >= PASSING_SCORE
if (eligible || e.override) { ... }
```

### 寫了就 MUST 100% 對

註解描述的行為與 code 不符時 MUST 當場刪掉，NEVER 留著。錯的註解比沒有註解更糟。

### 值得寫的三種

1. **非直覺 workaround 的成因與移除條件**。MUST 帶 `@followup[<id>]`，id 用 [[follow-up-register]]
   的登記（`plan:<work-id>`；未遷移 consumer 用 `TD-NNN`），NEVER 自創一套 issue ID 慣例。
2. **public API 的 param / return / throws**（給不讀實作的 caller）
3. **測試裡對慣例值（`-1` / `0` / `1`）的語意翻譯**

```ts
// @followup[TD-412] stripe SDK 在空字串 idempotencyKey 會 400，空值改傳 undefined。升級後刪。
```
