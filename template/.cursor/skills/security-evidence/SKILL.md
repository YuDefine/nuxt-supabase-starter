---
name: security-evidence
description: Use when 要判一則 Codex Security finding 是真漏洞還是假警報（finding mode），或上線前要分清 repo / staging / production 各層還缺哪些安全證據（map mode）。NOT for 修 code、跑掃描、寫 SECURITY.md。
effort: high
permission_tier: read
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/security-evidence/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# security-evidence

兩個 mode，各對應一份逐字 prompt（`references/`）。**MUST 先讀 `modes.md` 判 mode，再讀對應 reference 全文照它的 context-gathering 逐步問**——它們刻意分小步等答案，不要一次把全部問題丟出去。

| mode | 什麼時候 | reference | 產物 |
| --- | --- | --- | --- |
| `finding` | 一次一則 finding；報告出現 High / Medium、看不懂、有爭議、修之前 | `references/finding-evidence-explainer.md` | Finding Evidence Review：Source / Control / Sink、反證、Severity 與 Confidence 分開、Coverage、Proof Gaps、verdict（accept / needs more validation / unsupported） |
| `map` | 上線前、重大改版、修完重要 finding、掃描回 No findings | `references/production-blind-spot-mapper.md` | Production Security Evidence Map：五層 Coverage、P0 / P1 / P2 清單（pass condition、evidence、owner）、scope-limited verdict |

## 讀取順序（唯讀）

1. target 的 `SECURITY.md`（安全憲法）——每一條 `INV-n` 都是判 counterevidence 的依據；沒有這份就先說明 Confidence 會被壓低
2. finding 原文（`<output_dir>/findings.json` 該條 + `report.md` 對應段）與 `coverage.json` 的 Coverage
3. 被點名的檔案及其直接 caller / callee；**NEVER** 無方向爬 codebase

## 出口

- verdict `accept` / `needs more validation` → 登 TD（consumer 自家 `docs/tech-debt.md`），`### 自驗` 寫 Proof Gap 的驗證動作；修完跑 `scripts/security-scan.ts verify --finding <id>`
- verdict `unsupported` → 寫進本次 review 報告，不開 TD、不改 code
- `map` 的 P0 / P1 每一項各登一條 TD，owner 缺就寫 `Owner Missing`，**NEVER** 自己指派

## NEVER

- NEVER 把 scanner 的 High 標籤當成 Severity 與 Confidence 都是 High——兩者分開判
- NEVER 因為 `No findings` 就給 READY 或「安全」
- NEVER 要 secret 值或真實客戶資料；要 key 名與遮蔽片段
- NEVER 對 production 發測試流量或改設定；本 skill 只產出判讀與驗證計畫
