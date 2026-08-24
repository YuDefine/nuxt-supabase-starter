---
description: 耦合與內聚的三層分工——import cycle / barrel 的 gate 判讀、server 碼跨界 import、跨檔重複 discriminant switch、audit 表的 NO-SCAN 語意、Review 層函式契約、第三方 SDK 邊界
paths: ['**/*.{ts,tsx,mts,cts,vue}']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/coupling-cohesion.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Coupling & Cohesion

SOLID 在 functional TS 語境的**可測子集**。這裡只收 S（內聚）、O（shotgun surgery）、D（依賴方向）——
L 與 I 在 composable-based 專案幾乎是空集合（沒有繼承層級就沒有 LSP 可違反；structural typing 下
ISP 自動成立大半），為它們寫 checklist 只會產出無法判定的條目。

## 三層分工

| 層 | 誰執行 | 管什麼 |
| --- | --- | --- |
| Gate | `vp lint`（pre-commit `vp-staged` / CI） | `import/no-cycle`、`oxc/no-barrel-file` —— 機械可判定、無爭議 |
| Signal | `node scripts/audit-coupling-cohesion.ts` | change coupling、跨檔 discriminant switch —— 報告不擋 commit |
| Review | `/code-review` checklist | 職責語意判斷 —— 機械測不到的部分 |

**Signal 層的輸出 NEVER 當 gate 用**：跨檔規則在 staged-only 情境算不準，把它接進 pre-commit 只會
產出「改一行擋十次」的體驗，然後大家學會加 disable comment。

## Review 層 checklist

本節純 review 層，無機械訊號。消費端是 `code-review` agent 的程式碼品質 checklist。規模門檻
（`max-params` / `max-lines` / `complexity`）不在本節、也不在 gate——理由見下方
§ 為什麼 gate 只有兩條規則。

**與 § Shotgun surgery 的關係**：本節管「一個函式做了幾件語意上不同的事」；Shotgun surgery 管
「同一個 discriminant 散落 ≥3 個檔」。兩層互補，不重複判準。

### 一個函式只做命令或只做查詢

一個函式 MUST 只做命令（改狀態）或只做查詢（回答案），NEVER 兩者兼具。

**NEVER 讓 query / check 型函式藏副作用**：`checkPassword` NEVER 順手初始化 session。名字說得出來
的操作 MUST 是它做的全部。

### NEVER 用 boolean flag 參數切換行為

`createUser(data, isAdmin)` 把「這個函式做兩件事」藏進 call site。MUST 拆成兩個具名函式
（`createAdminUser` / `createMemberUser`）。

這條管的是**切換行為的 flag**，不是「選項物件裡的 boolean 欄位」。`{ dryRun: true }` 這種不改
呼叫哪條路徑的選項，不是本條的對象。

### 函式內分段註解 = extract-method 警報

函式體內出現 `// Validation` / `// Calculation` / `// Persist` 這類分段標籤時，每個被標籤的區塊
MUST 抽成具名函式，讓上層函式讀起來是一份目錄而不是實作。區塊順序 MUST 讓呼叫端由上往下讀就能
跟上故事——先做什麼、再做什麼，不要先跳進細節。

### 參數順序有歧義時包成參數物件

`fn(user, true, 3)` 這種位置參數，caller 對不到第 2、第 3 個是什麼時，MUST 改成參數物件。
**NEVER** 把參數個數寫成 0–2 的硬門檻——§ 為什麼 gate 只有兩條規則 已用對照專案否決 `max-params`。

## Gate 判讀

`import/no-cycle` 炸了代表兩個模組互相依賴對方的**具體實作**。兩條標準拆法：

- **抽共用 type / 常數到第三個模組**，雙方都 import 它（最常見，cycle 多半由共享的 type 或 registry 常數造成）
- **依賴反轉**：把低層模組對高層的回呼改成參數注入，由高層在組裝時傳入

**NEVER disable `import/no-cycle`。** 出現違規時只有兩條合法路徑：當場修，或登一條 TD 記錄該 cycle
與預定修法。`// oxlint-disable-next-line import/no-cycle` 出現在 diff 裡，`/code-review` 會擋。

**既有 cycle 涉及檔數 > 20 的 consumer** 是唯一的降級情境——這種規模的 cycle 是結構性的，逐檔
boy-scout 修不動。降級 recipe（consumer 自家 session 執行，clade 不代勞）：

```typescript
// vite.config.ts —— business overrides 區塊
lint: {
  ...lintBase,
  rules: { ...lintBase.rules, 'import/no-cycle': 'warn' },
}
```

降級 **MUST** 同時登一條 TD 記錄涉及檔數與收斂計畫。**NEVER** 因為「暫時很吵」在 20 檔以下降級。

## Server / Client 邊界

**已有機械 gate，本節不另立規則**：`vendor/review-rules/patterns.json` 的
`app-imports-server-internals`（error 級，接在 pre-commit `review-rules-ban` check）擋
`app/**` 對 `~/server/`、`~~/server/` 的 value import，`import type` 放行。判讀與例外走
code-review agent 的 `references/clade-review-rules.md` § 分層真相 / API 契約。

```typescript
import type { InvoiceRow } from '~/server/utils/invoice'   // ✅ 型別在 build 時抹除
import { calcInvoice } from '~/server/utils/invoice'       // ❌ value——server 碼進了 client bundle
```

要共用實作就搬到 `shared/`，不要從 client 側伸手進 `server/`。

**這道 gate 是 `layer: ratchet`——它只擋新增，不擋存量。** 既有的跨界 import 會原地留著且
不報任何訊號（2026-08 實測：<consumer-b> 有 2 筆存量落在 `app/**` 內，正好是 gate 宣稱管的範圍）。
所以「pre-commit 綠」**NEVER** 讀成「這個 repo 沒有跨界 import」——它只代表你這次沒有新增。

**另一個缺口是範圍**：`fileGlob` 只有 `app/**`，root 層 `composables/**`、`components/**`
與 `shared/**` 無機械覆蓋。`shared/**` 最值得注意——它同時被 client 與 server 匯入，從那裡
import server 內部模組會把 server 碼一路帶進 client bundle。

兩個缺口都登在 TD-402，本次不順手改（擴 ratchet 的觸發面等於對全 registry consumer 同時提高
門檻，先量再擴）。**NEVER** 因為「gate 沒擋」就在這些位置 import server 碼。

## Shotgun surgery

同一個 discriminant（`type` / `kind` / `status` / `variant` / `mode` / `state`）在 **≥3 個不同檔案**
各自有一條 switch —— 加一個 variant 要改 N 處，這是 OCP 意義下的真違規，收斂成單一 map 或 strategy 表。

**單檔內的 exhaustive switch NEVER 當違規報。** TS discriminated union + exhaustive switch 是慣用法，
常常比多型更清楚——它的問題只在**散落多檔**時才出現。audit 的 (c) module 有已知 false positive
（不同 union 撞到同一個 prop 名），判讀時先確認那幾個 switch 吃的是不是同一個 union。

## Audit signal 判讀

fleet 表每格是 `violations / scanned` 雙數字，三種狀態不可混讀：

| 格子內容 | 意思 | 該做什麼 |
| --- | --- | --- |
| `0 / 263` | 掃了 263 個檔，乾淨 | 無事 |
| `6 / 412` | 掃了 412 個檔，6 個違規 | 依 Gate 判讀處理 |
| `NO-SCAN` | **scanned = 0**，該 consumer 的 lint 管線無輸出 | 這格**不是**綠的——該 consumer 的 gate 正在靜默全綠，修復歸 consumer 自治區 |
| `N/A` | 管線形狀本來就不適用（monorepo 無 root、template 型 repo） | 無事，但 **NEVER** 與 `NO-SCAN` 混為一談 |

**`NEVER` 把 `NO-SCAN` 讀成 0。** 這兩者在單一數字的表上長得一模一樣，而它們的意思相反：一個是
「掃過，乾淨」，一個是「根本沒掃到，一無所知」。script 的 exit code 2 專門標記表上存在 `NO-SCAN`。

## 為什麼 gate 只有兩條規則

`max-lines-per-function` / `max-lines` / `complexity` / `max-depth` / `max-params` **刻意不收**。
它們量的是規模與分支密度，不是職責內聚：300 行零分支的 mapper 是 SRP 違規但 complexity 抓不到，
40 行的 exhaustive switch 是好碼卻會被誤傷。<consumer-b> 實測 862 violations / 542 檔（2026-08 快照），
其中 88% 的違規檔近 30 天仍在改動——staged-only 救不了，開成 error 等於天天擋路。對照組
microsoft/TypeScript、vuejs/core、vitejs/vite、facebook/react、nuxt/nuxt、antfu/eslint-config、xo
八個專案無一啟用其中任何一條（2026-08 快照）。

複跑（在任一 consumer 根目錄；`-A all` 先關掉預設類別，只留這五條）：

```bash
npx vp lint -A all -D max-lines-per-function -D max-lines -D complexity -D max-depth -D max-params .
# 尾行的 "Found N warnings and M errors" 就是 violations，"on K files" 是掃描分母
CHANGED=$(mktemp -t changed-30d.XXXXXXXXXX)   # NEVER 寫死 /tmp/<固定名>：全機器所有 session 共用同一個檔
git log --since=2026-07-06T00:00:00 --until=2026-08-06T00:00:00 --name-only --pretty= \
  | sort -u > "$CHANGED"             # 與上面的違規檔清單取交集 = 「近 30 天仍在改動」那 88%
```

**NEVER** 直接跑 `npx oxlint`——本 repo 的 wrapper 只給 IDE `--lsp` 用，會拒絕執行。

本證據決定：gate 層收哪幾條規則。
本證據不決定：要不要管內聚——**NEVER** 拿本節當「規模與複雜度不必管」的理由，那部分移到 Review 層
由人判讀，不是消失了。

## 第三方邊界

本節補 § 三層分工 宣告的 D（依賴方向）裡「domain code 對第三方 SDK」那一半。server / client
邊界見上方 § Server / Client 邊界。操作範本：`~/offline/clade/vendor/snippets/third-party-boundary/`。

本節純 review 層，無機械訊號。目前無 audit script。

### 第三方 SDK MUST 包在自己的 wrapper 後面

讓上游 breaking change 的修改面收斂到單一檔。可觀察判準：**upstream 這支 API 改簽名，要動幾個檔？
> 1 就是沒有邊界。**

這條管的是 **domain / 業務層** 對 SDK 的依賴，不是「專案裡每一個檔都不准 import `stripe`」。
adapter 檔本身 MUST import SDK；業務函式 MUST 只看到自家 interface。

### 邊界上 MUST 把 vendor 的例外型別翻譯成自家 domain 例外

NEVER 讓 `PostgrestError` / `StripeError` 這類型別出現在 domain 層的 `catch`。與
[[error-handling]] § PostgREST 錯誤碼診斷互補：那邊講在邊界上怎麼判讀那些碼，本條講判讀完之後
不准讓它們往上漏。
