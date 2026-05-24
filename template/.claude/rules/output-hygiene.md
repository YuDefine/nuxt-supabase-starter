<!--
🔒 LOCKED — managed by clade
Source: rules/core/output-hygiene.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Output Hygiene — 別把內部過程變成讀者的負擔

對外輸出（PR / commit message / code comment / Slack / email / 文件 / 跨團隊訊息 / 設計報告）只該讓讀者最快理解「**現況 + 為什麼**」。

**不**是回放思考歷史、嘗試過又退回來的選項、被糾正後的修補軌跡，或為錯誤決定做事後辯解。

跟 user 在 session 內透明揭露錯誤是必要的（誠實 ≠ 隱瞞），但這份內部歷史**不延伸**到對外文字。兩個場域要分清楚：

| 場域 | 該說什麼 |
| --- | --- |
| Session 對話（向 user 透明） | 完整：「我原本以為 X、被你指出 Y、查證後改 Z」 |
| 對外輸出（讀者沒有 session context） | 只給最終決定 + 必要 context；錯誤過程不外露 |

## 三種最常見的洩漏形式

### 1. 「不選 A」當理由

寫「不選 A / 排除 A / 跳過 A」必須能對應到下列其一，否則是 Claude 內部歷史，刪掉：

- ✅ 對方曾建議或考慮過 A
- ✅ 文件 / 規範 / 業界 default 是 A，需解釋為何偏離
- ✅ 讀者本來就會問「那 A 呢？」（高知名度替代方案）
- ❌ 純粹是 Claude 自己曾選過 A 後被糾正

### 2. 列舉「考慮過但沒選」的選項清單

除非 trade-off 對讀者實際有用（如評估 PR 設計、ADR 文件、技術選型 doc），否則別把比較過的選項寫進去。讀者要的是「決定 + 理由」，不是「Claude 的腦內試算」。

### 3. 「我一開始以為 / 後來發現 / 改成」這類敘事

對讀者無價值的 debug 流水帳。對 user 講可以，對外輸出不該有。

## 範例

被糾正後選 Node 24 的場景：

| 場景 | ❌ Bad | ✅ Good |
| --- | --- | --- |
| 給乙方訊息 | 「Node 22 有 packaging bug、Node 20 已 EOL，所以走 24」 | 「Node 22 有 packaging bug，所以走 24（Active LTS）」 |
| commit message | `Pin NODE_VERSION to 24, not 20 — earlier commit pinned 20, that was wrong, ...` | `Pin NODE_VERSION to 24 — sail 8.3 default Node 22 has nodesource npm packaging bug` |
| code comment | `// Use 24, not 20 (20 was EOL'd 2026-03-24)` | `// Pin to 24: nodesource 22.x npm packaging is broken` |

20 在三個 bad 例子裡都是 Claude 的內部歷史 — 對方沒推薦過 20、未來看 commit log / 程式碼的人也不知道前一版釘錯。把這層辯解寫進去只會讓讀者困惑或察覺 Claude 在自我合理化。

## 送出前自查

搜下列關鍵字，每條問「讀者知道嗎？讀者在乎嗎？」否則刪：

- 中：不選 / 排除 / 跳過 / 也不選 / 不該 / 一開始 / 後來發現 / 改成 / 修正前
- En: `not X` / `instead of` / `earlier` / `was wrong` / `used to` / `originally` / `previously`

## 例外

下列場景**該**保留決策過程，因為讀者需要：

- **ADR / 設計文件**：trade-off 比較是文件本身的價值
- **PR description 的 alternatives considered 段**：reviewer 需要知道為何拒絕替代方案
- **HANDOFF.md / 技術債登記**：未來接手者需要知道走過的死路

判別：讀者場域**主動需要**這些資訊，而不是 Claude 主動塞給沒問的人。

---

## Tool-derived 宣稱：quote 還是 synthesis（2026-05-24 補強）

對「X 工具 / 文件 / API 是這樣規範的」這類 attribution claim，必須能對應到工具回傳的**直接字句**。多條 fact 推論出來的 pattern claim **不能**用 `documented` / `canonical` / `規範` / `官方建議` / `recommended` / `the way to` 等修飾——那些 label 只能由 verbatim 引文支撐。

### 為何加這層

`rules/core/code-discovery` + 各 MCP 規約（[[nuxt-ui-mcp]] / [[modern-web-mcp]] 等）已擋下「亂湊 API surface」，但沒擋「拿合法 MCP fact 合成 prescriptive pattern claim」。實證：2026-05-24 <consumer-a> 撞到一次——主線把 `placeholder` prop（MCP fact）+ `modelValue` 型別接受 `null`（MCP fact）+ `resetModelValueOnClear` 預設 `null`（MCP fact）三條 synth 成「Nuxt UI v3 規範 pattern」貼上 doc 背書 label，被 user 標為**重大錯誤**。MCP 從沒明文宣告這個 pattern。

### Hard rule

寫含下列措辭的句子前，**MUST** 自查能否找到 verbatim MCP / docs / API 引文：

- 中：`官方 / 規範 / 文件規定 / 官方建議 / canonical / 推薦做法 / 標準寫法 / 規範路徑 / 規範 pattern`
- En: `canonical` / `the canonical way` / `officially / official approach` / `documented as` / `recommended` / `prescribed` / `the way to do X` / `the right way`

找得到 → **MUST** 標出處（`[per <tool> <command> §<section>]` 或直接貼引文 ≤2 行）
找不到 → **MUST** 改用以下任一非 prescriptive 措辭：

- `per type signature ...` — 型別簽名允許
- `one demonstrated usage shows ...` — example 段示範但無 prescriptive label
- `empirical observation: ...` — 從 runtime 行為觀察
- `inferred from <facts 列舉>` — 明說是 synthesis 不假裝 doc 背書

### 適用範圍

不限 Nuxt UI——同樣適用於 modern-web-guidance、codebase-memory-mcp、任何 MCP / docs 抓資料後的二手宣稱：

- **codebase-memory-mcp**：「`search_graph` 顯示 X 函式被 5 個 caller 呼叫」(✅ MCP 直接 fact) vs 「這個函式是 hot path 應該優化」(❌ synth + prescriptive)
- **modern-web-guidance**：「CSS Anchor Positioning Baseline Widely 2024」(✅ skill 回傳 fact) vs 「Modern web 規範 popover 應該用 Anchor Positioning」(❌ synth + prescriptive)
- **Reka UI / Headless UI / shadcn-vue**：API surface fact OK，「the recommended pattern」synth 禁止
- **WebFetch 抓的 third-party blog**：作者意見 ≠ official spec，引用時 **MUST** 標 source URL + 「per <author>」不要寫「規範」

### Counter-examples

| ❌ Bad | ✅ Good |
| --- | --- |
| 「Vue 3 規範用 `<script setup>` 不用 Options API」 | 「Vue 3 docs 兩種都示範；本 repo CLAUDE.md `vue-best-practices` 要求 `<script setup>`」 |
| 「Tailwind 規範用 utility class 不用 `@apply`」 | 「Tailwind docs 兩種都列；本 repo `code-style.md` 偏好 utility class（[link]）」 |
| 「Better Auth 規範用 server-side session」 | 「per Better Auth getting-started example 用 server-side session；本 repo `auth.md` 對齊此 example」 |
| 「Pinia 規範 store 用 composition API setup function」 | 「per Pinia docs `defineStore` 第二參數可傳 options 或 setup function；本 repo `pinia-store.md` 強制 setup function（[link]）」 |

### 何時可以寫 prescriptive

- 引用**本 repo 內部規約**（CLAUDE.md / `.claude/rules/`）：「本 repo 規範 X」 ✅（這條 rule 本身就是內部規約，不需 verbatim 外部引文）
- 引用**有 verbatim 字句 MCP / docs**：必標出處
- 引用**業界 RFC / W3C spec / ECMAScript 規範**：必標 spec 編號或 section

### 何時不可以

- 從多條 MCP fact synth 出來的 pattern：**禁** prescriptive
- 從訓練記憶寫的「業界慣例」：**禁** prescriptive（記憶不可信）
- 從 GitHub stars / community blog 推論的「主流寫法」：**禁** prescriptive

