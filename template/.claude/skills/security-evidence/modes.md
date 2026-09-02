<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/security-evidence/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# modes

## 判 mode

| 可觀察 predicate | mode |
| --- | --- |
| 使用者貼了（或指了）**一則** finding | `finding` |
| 使用者說「上線前」「還有哪些正式環境風險沒證據」「掃完 No findings 能不能上」 | `map` |
| 使用者貼了多則 finding | `finding`，一次一則，問先處理哪一則；**NEVER** 合併多則出一個 verdict |
| 兩個都像 | 先 `finding` 把眼前那則判完，report 結尾問要不要接 `map` |

## `finding` 的輸入輸出

輸入（缺就問，一次問一小批）：finding 完整原文（summary、檔案與行號、attack path、validation notes、Severity、Confidence、remediation、Coverage）、repository / commit / 掃描範圍、`SECURITY.md`、與此 finding 相關的 production 控制（RLS / IAM / storage 權限）的非敏感證據。

輸出：`references/finding-evidence-explainer.md` § output-format 的十個段落，逐字用那個標題結構。每一條 evidence 標 `Independently Verified` / `Report-Supplied` / `User-Confirmed` / `Unknown`。

結尾固定加一段 **→ TD 登記格式**（verdict 是 accept 或 needs more validation 時）：

```
## TD-NNN — <finding title>
**Class**: <依 consumer 慣例>
**Status**: open
**Priority**: <Severity 決定，NEVER 因 Confidence 低而降>
**Discovered**: <date> — security-scan <run_kind> <output_dir>，security-evidence finding verdict=<verdict>
**Location**: `<file>`
### 要做什麼
<remediation 一句>
### 自驗
- Proof Gap：<gap> → <safe way to obtain it>
- 修完：node $CLADE_HOME/scripts/security-scan.ts verify --finding <id>
```

## `map` 的輸入輸出

輸入（分層、一層一批）：`SECURITY.md`、掃描 Coverage 與既有 Finding Evidence Review、部署拓樸（DB / storage / payment / AI / queue / email / identity / workers）、staging 能測什麼、production 有哪些控制與非敏感證據、每個外部系統的 owner。

輸出：`references/production-blind-spot-mapper.md` § output-format 的整份 Production Security Evidence Map。狀態只准四值：`Confirmed` / `Needs Test` / `Needs Production Check` / `Unknown`。verdict 只准三值：`BLOCKED` / `CONDITIONAL` / `READY FOR REVIEWED SCOPE`（後者 MUST 列 scope 與日期）。

P0 / P1 每一項各登一條 TD（格式同上，`### 自驗` 寫 pass condition 與 safe evidence collection）。
