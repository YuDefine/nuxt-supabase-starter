---
description: Nuxt UI v3/v4 component / composable / theming / icon 必走 nuxt-ui-remote MCP；ban prescriptive synthesis
paths: ['app/**/*.{vue,ts}', 'packages/*/app/**/*.{vue,ts}', 'template/app/**/*.{vue,ts}', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'template/pages/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'template/components/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'template/layouts/**/*.vue', 'app.config.ts', 'nuxt.config.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-ui-mcp.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Nuxt UI MCP（強制走 nuxt-ui-remote）

**核心命題**：Nuxt UI 是 fast-moving 套件（v2 → v3 重寫、ui-pro 持續迭代、components / composables / icons 隨版本演變）。模型訓練資料對 component prop / slot / theming API 的記憶**幾乎一定過時或錯誤**，硬寫出來的 code 看起來合理但 runtime 會壞。`nuxt-ui-remote` MCP 是 Nuxt UI 官方最新 docs 的唯一可信來源。

此規則優先於個別 skill 說明與其他規則。

---

## 範圍

以下**全部**屬於本規則「Nuxt UI 實做」範圍，**MUST** 走 MCP：

- `@nuxt/ui` v3 / v4（現行主線）— components、composables、icons、theming、`app.config.ts` 的 `ui.*` 區塊
- `@nuxt/ui` v2（legacy，少數舊專案）
- `@nuxt/ui-pro`（Pro 版高階 component 與 template）
- Nuxt UI 官方 templates（starter / dashboard / saas 等結構與配置）

判斷標準：**任何**會寫進 `.vue` / `.ts` / `app.config.ts` / `nuxt.config.ts` 且觸及 `U*` component、`use*` composable（Nuxt UI 自家）、`ui.*` theming key、`@nuxt/ui*` import 的內容，都算 Nuxt UI 實做。

---

## Hard rule — API surface 層

**MUST**：

1. 寫任何 Nuxt UI component / composable / theming / config 之前，**先**呼叫對應 nuxt-ui-remote MCP tool 取得當前版本的真實 API：
   - `search-components` / `get-component` / `get-component-metadata` — component prop / slot / emit
   - `search-composables` — composable signature
   - `search-icons` — icon name 對照
   - `get-example` / `list-examples` — 官方推薦寫法
   - `get-template` / `list-templates` — template 結構
   - `get-documentation-page` / `search-documentation` — 一般 docs / theming / config
   - `get-migration-guide` — v2 → v3 / 跨版本 BC
2. 取得 MCP 回傳後**才**寫 code；引用的 prop / slot / API 必須能對應到 MCP 回傳內容。

**NEVER**：

- ❌ 憑訓練記憶寫 `<UButton color="..." variant="..." size="..." />` 等 component usage——即使「看起來很標準」也禁止
- ❌ 憑訓練記憶寫 `app.config.ts` 的 `ui: { ... }` theming key
- ❌ 憑訓練記憶寫 `useToast()` / `useOverlay()` 等 composable 呼叫
- ❌ 用 `<UButton>` 但實際是某個你以為存在的 prop（例如 v2 的 prop 殘留到 v3 寫法）
- ❌ 跳過 MCP 直接讀 `node_modules/@nuxt/ui/**` 推測 API（source 可作 sanity check 輔助，但**不**作為唯一依據；MCP 才是規約來源）

---

## Hard rule — prescriptive synthesis 層（2026-05-24 補強）

**NEVER 對 Nuxt UI 寫 prescriptive 宣稱**——這類措辭只能在 MCP 回傳的 doc prose 中找到 verbatim 對應字句時才能用：

- "canonical pattern" / "the canonical way" / "the prescribed pattern"
- "Nuxt UI v3/v4 recommends X" / "officially recommended" / "official approach"
- "documented as best practice" / "documented as canonical" / "per the docs"
- 中：「官方建議 / 官方規範 / 文件規範路徑 / 規範 pattern / canonical 寫法 / 推薦做法」
- "the way to do X" / "the right way" / "the proper way"

### 為何加這層

API surface 規約只擋「props/slots/API 名亂湊」，但**不擋**「多條合法 fact 合成成 prescriptive pattern claim」。例如：MCP 告訴你 `placeholder` prop 存在 + `modelValue` 型別接受 `null` + clear 按鈕 reset 成 `null`。三條 fact 都來自 MCP。但你**不能**把它們 synth 成「Nuxt UI 規範 pattern 是 placeholder + null sentinel」——這個「pattern」claim MCP 從未明文背書。

實證：2026-05-24 <consumer-a> `app-status-badge-extraction` session，主線 Claude 用上述 synth 推論替「用 placeholder + null 取代 empty-string item value」這個修法背書，被 user 標為**重大錯誤**。Synth pattern 標上「官方」「規範」label 等於把推論偽裝成 authority。

### 判別自查

寫出含 prescriptive 措辭的句子時，反問自己：

1. 這個「pattern / recommendation / canonical」claim 對應到 MCP 哪一段**逐字** prose？
2. 找得到 verbatim 引文 → OK，引用時 **MUST** 標出處（`[per get-component <name> §<section>]` 或直接貼引文）
3. 找不到 → **MUST** 改用以下任一非 prescriptive 措辭：
   - 「per type signature」（型別簽名允許）
   - 「one demonstrated usage example shows ...」（example 段示範但無 prescriptive label）
   - 「empirical observation: ...」（從 runtime 行為觀察）
   - 「inferred from <facts 列舉>」（明說是 synthesis 不假裝是 doc 背書）

### Counter-examples

- ❌「Nuxt UI v3 規範 pattern 是 placeholder + null sentinel」（synth 偽裝 doc 背書）
- ✅「per type signature `modelValue` 接受 `null`，且 `placeholder` prop 存在；MCP 沒明文宣告 `placeholder + null` 為 canonical pattern」
- ❌「官方建議用 `defaultValue` 而非 v-model 做 uncontrolled」
- ✅「MCP usage section 有一個 example 用 `default-value` 不帶 v-model，但沒 prescriptive label 說『uncontrolled 時應用 defaultValue』」
- ❌「Nuxt UI 規定 size 必須顯式聲明」
- ✅「per get-component UButton size prop 預設 `md`，未見 MUST/SHOULD 規約」

---

## MCP 不通時

「不通」定義：MCP tool call 回傳 error、timeout、明顯異常輸出（empty、HTTP 5xx、schema 不對）。

**MUST**：

1. **STOP 寫 code**。不要憑記憶補完，不要「先寫個草稿再說」
2. 對 user 回報：
   - 哪個 MCP tool 失敗（tool 名 + 呼叫參數）
   - 看到的錯誤訊息 / 異常徵兆
   - 推測的可能原因（network / MCP server 未啟動 / config / auth / rate limit）— 給診斷資訊幫 user 判斷
3. **等 user 指示**：可能的後續是 user 修 MCP 連線、user 改用其他方式、user 例外授權你查 source。**不**自行決定降級方案。

**NEVER**：

- ❌「MCP 不通，我就用記憶寫了」
- ❌ 沈默退到 grep `node_modules` / WebSearch 等 fallback
- ❌ 把 MCP 失敗包裝成「先寫個版本，之後再驗」

---

## 為什麼這條 rule 存在

- Nuxt UI v3 / v4 大量重新命名 component prop 與 theming key，訓練資料寫出來的 v2 API 在 v3 / v4 直接 runtime error
- ui-pro components 多為 paid + iterative，模型對其 API 的記憶覆蓋率與正確率都低
- Nuxt UI 自家 icon name 與 Iconify name 之間有 alias / 慣例差異，憑記憶寫常踩到「icon 名看起來對但 render 不出來」
- theming 改動經常牽動跨 component 的 token / variant，憑記憶補的 `app.config.ts` 往往視覺對但 type / runtime 報錯
- prescriptive claim（「官方規範」「canonical pattern」）為 user 帶來 false authority——把 Claude 的 synth 推論偽裝成 doc 背書，user 沒查證的話會誤信

可信來源優先序：**nuxt-ui-remote MCP** > Nuxt UI 官網（manual fetch） > `node_modules/@nuxt/ui` source >> 訓練記憶（基本視為不可信）。
