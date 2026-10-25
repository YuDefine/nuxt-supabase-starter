<!-- Clade native rule; source: rules/core/output-hygiene.md; edit canonical source -->
# Output Hygiene — 別把內部過程變成讀者的負擔

<!-- clade-targets: claude,agents -->

對外輸出（PR / commit message / code comment / Slack / 文件 / 跨團隊訊息）只該讓讀者最快理解「**現況 + 為什麼**」。

**不**是回放思考歷史、退回來的選項、被糾正的修補軌跡、或事後辯解。

Session 內對 user 透明揭露錯誤是必要的（誠實 ≠ 隱瞞），但內部歷史**不延伸**到對外文字：

| 場域 | 該說什麼 |
| --- | --- |
| Session 對話 | 完整：「我原本以為 X、被你指出 Y、查證後改 Z」 |
| 對外輸出 | 只給最終決定 + 必要 context；錯誤過程不外露 |

**本檔管「揭露什麼」，不管「講多長」。** 篇幅與節奏由使用者層輸出校準決定；**NEVER** 拿「要簡潔」當省略已知錯誤的理由。上表「Session 對話：完整」指的是**錯誤不隱瞞**，不是「過程要逐步複述」。用字有字面說法就用字面說法（「要有 detector 或 gate 才會被執行」，不寫「要能長出牙齒」）。

## 三種最常見的洩漏形式

### 1. 「不選 A」當理由

寫「不選 A / 排除 A / 跳過 A」必須能對應到下列其一，否則是 Claude 內部歷史，刪掉：

- ✅ 對方曾建議或考慮過 A
- ✅ 文件 / 規範 / 業界 default 是 A，需解釋為何偏離
- ✅ 讀者本來就會問「那 A 呢？」
- ❌ 純粹是 Claude 自己曾選過 A 後被糾正

### 2. 列舉「考慮過但沒選」的選項清單

除非 trade-off 對讀者實際有用（如 ADR），否則別把比較過的選項寫進去。

### 3. 「我一開始以為 / 後來發現 / 改成」這類敘事

對讀者無價值的 debug 流水帳。對 user 講可以，對外輸出不該有。

## 範例

被糾正後選 Node 24 的場景：

| 場景 | ❌ Bad | ✅ Good |
| --- | --- | --- |
| commit message | `Pin NODE_VERSION to 24, not 20 — earlier commit pinned 20, that was wrong, ...` | `Pin NODE_VERSION to 24 — sail 8.3 default Node 22 has nodesource npm packaging bug` |

20 是 Claude 的內部歷史 — 看 commit log 的人不知道前一版釘錯。

## 送出前自查

搜下列關鍵字，每條問「讀者知道嗎？讀者在乎嗎？」否則刪：

- 中：不選 / 排除 / 跳過 / 也不選 / 不該 / 一開始 / 後來發現 / 改成 / 修正前
- En: `not X` / `instead of` / `earlier` / `was wrong` / `used to` / `originally` / `previously`

## 例外

下列場景**該**保留決策過程：

- **ADR / 設計文件**：trade-off 比較是文件本身的價值
- **PR description 的 alternatives considered 段**：reviewer 需要知道為何拒絕替代方案
- **HANDOFF.md / 技術債登記**：未來接手者需要知道走過的死路

判別：讀者場域**主動需要**這些資訊。

## 交回給 Charles 的收尾

收尾裡要 Charles 決定或確認的事，MUST 寫成可回覆的 `Qn`：一句問句，加上選項（推薦排第一、附一句理由）或明說要填什麼值；題面怎麼分層照 [[my]] `rules/待拍板條目寫法.md` Rule 4。寫在敘述句裡的待決定事項，watch 停放 session 時抽不出來，Charles 只會收到一題「要接著做嗎？」。

外派回報標明「要 Charles 拍板」的題，依內容分兩種（Charles 2026-10-08）：

- 範圍、優先順序、報價、對外承諾：**MUST** 先問再動手。等答案時改做不依賴它的事，**NEVER** 先照自己的判斷做下去再交回。
- 其餘（技術細節、實作取捨）：可以先依證據定案往下做，但收尾 **MUST** 列成 `Qn` 交回並標明已先採用哪一條，**NEVER** 默默吸收。

| ❌ | ✅ |
| --- | --- |
| `spec package 照之前的安排等你確認後再提交。` | `Q1 spec package 的改動可以提交嗎？ A 可以（推薦）／B 先別：這題要給值，寫要改哪裡` |

---

## Tool-derived 宣稱：quote 還是 synthesis

對「X 工具 / 文件 / API 是這樣規範的」這類 attribution claim，必須能對應到工具回傳的**直接字句**。多條 fact 推論出來的 pattern claim **不能**用 `documented` / `canonical` / `規範` 等修飾——那些 label 只能由 verbatim 引文支撐。

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

任何 MCP / docs / WebFetch 抓資料後的二手宣稱都適用（MCP 直接 fact ✅，synth 成 prescriptive ❌）；third-party blog 引用 **MUST** 標 source URL + 「per <author>」。

### Counter-examples

| ❌ Bad | ✅ Good |
| --- | --- |
| 「Vue 3 規範用 `<script setup>` 不用 Options API」 | 「Vue 3 docs 兩種都示範；本 repo CLAUDE.md `vue-best-practices` 要求 `<script setup>`」 |
| 「Better Auth 規範用 server-side session」 | 「per Better Auth getting-started example 用 server-side session；本 repo `auth.md` 對齊此 example」 |

### 何時可以寫 prescriptive

- 引用**本 repo 內部規約**（CLAUDE.md / `.claude/rules/`）：「本 repo 規範 X」 ✅
- 引用**有 verbatim 字句 MCP / docs**：必標出處
- 引用**業界 RFC / W3C spec / ECMAScript 規範**：必標 spec 編號或 section

### 何時不可以

- 從多條 MCP fact synth 出來的 pattern：**禁** prescriptive
- 從訓練記憶寫的「業界慣例」：**禁** prescriptive
- 從 GitHub stars / community blog 推論的「主流寫法」：**禁** prescriptive
