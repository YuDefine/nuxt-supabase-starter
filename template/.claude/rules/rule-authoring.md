---
description: 撰寫或修改 rule / SKILL.md / subagent brief / snippet 的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約配反開脫三件套、發佈前驗證
paths: ['.claude/rules/**/*.md', '.claude/skills/**/*.md', 'tasks/lessons.md', 'rules/**/*.md', 'plugins/hub-core/skills/**/*.md', 'claude-md/**/*.md', 'vendor/snippets/**/*.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/rule-authoring.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Rule Authoring（規約措辭工程）

**核心命題**：規約文字是塑形 agent 行為的 code，不是散文。形式選錯的規約看起來嚴謹、實測反效果——對「輸出形狀」問題用禁止句，違規率比不寫指引還高。本規則對**每一次** rule / SKILL.md / brief / snippet 的撰寫與修改生效，不是只有大改版才適用。

方法論來源：superpowers `writing-skills` v6.1.1（措辭 A/B 實測 + Meincke et al. 2025, N=28,000, compliance 33%→72%）+ clade pitfalls 實戰語料。操作 SOP 與模板見 cookbook `vendor/snippets/rule-authoring/`。

## 先分類失敗型態，再選形式（MUST）

寫任何規約段之前，先回答「baseline 失敗長什麼樣」，按表選形式：

| Baseline 失敗型態 | 正確形式 | 錯誤形式（實測反效果） |
| --- | --- | --- |
| 知道規則、壓力下仍違反（趕時間 / 沉沒成本 / 想收工） | 禁止句 + Iron Law + rationalization table + Red Flags（見下） | 軟性建議（「盡量」「建議」「prefer」） |
| 有遵守但輸出**形狀**錯（brief 肥大、結論埋沒、複述 spec、敘事化） | 正向 recipe / 契約：直接寫輸出「**是**」什麼——部件、順序、各部件一句話定義 | 禁止句清單（「不要複述」「不要敘事」「don't X」） |
| 漏掉必要元素（該有的欄位 / 段落沒出現） | 模板裡的 REQUIRED 欄位或占位符（結構解） | 模板旁的散文提醒 |
| 行為依條件而變 | 綁**可觀察 predicate** 的條件句（「若 `<file>` 存在 → …」） | 無條件規則 + 豁免子句 |

## 措辭三禁（NEVER）

1. **NEVER 加 nuance clause**——「不要 X，除非真的重要」= 重開協商空間。實測：對贏的 recipe 補一句 nuance clause，輸出從穩定變 noisy。真例外寫成獨立條件句、綁可觀察 predicate。
2. **NEVER 用豁免子句 scope**——「此限制不適用於 code block」實測仍會抑制 code block。需要豁免時重構規則，讓規則本身碰不到該區。
3. **NEVER 讓 description / 觸發條件摘要流程**——skill frontmatter description、rule 開頭只寫「何時適用」（症狀、情境、error 字樣、危險前兆），不寫「會做哪幾步」。實測：description 寫了流程摘要，agent 照 description 抄捷徑，跳過本體（兩段 review 被縮成一段）。

## 廣泛套用要明寫範圍（MUST）

Consumer 主線字面遵守指令、不外推。規約意圖是「對**所有** consumer / **每個** phase / **每個**符合的檔」生效時，措辭必須明寫全稱量詞：

- ❌「migration 後 MUST 重生 types」← 可能只對手上那一個做
- ✅「**每一個** migration 檔新增/修改後都 MUST 重生 types，不是只處理最後一個」

單一對象的規約照常寫。

## 紀律型規約三件套（高違規規約 MUST 全配）

判定「高違規」：已有對應 pitfall、或 oops / audit 訊號顯示同型違規 ≥2 次。三件套：

1. **Iron Law**：一行絕對句（如 `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`），前置「**違反字面就是違反精神**」——砍掉整類「我有遵守精神」開脫。
2. **Rationalization table**：一列一組「藉口 → 現實」。藉口**必須是逐字實錄**（從 pitfall 檔、session transcript、baseline 測試抽），不虛構假想藉口——虛構的堵不到真的洞。
3. **Red Flags**：「發現自己在想 X = 停」清單，收錄違規**前兆**句式（「就這一次」「這個情況不一樣」「先做了再補」）。

三件套的既有範本：[[testing-anti-patterns]]、`~/.claude/skills/receiving-code-review`。

## 發佈前驗證

- **新規約 / 改措辭前先跑 baseline（SHOULD）**：無規約下用誘發情境跑一次，確認失敗真的存在。對照組沒失敗 → 不要寫這條規約（沒有要修的東西，寫了只燒 token）。
- **高風險措辭 MUST micro-test**：≥5 reps 新鮮 context + 無指引對照組，逐個人工讀 flagged match（template 回聲與引用反例會偽裝成命中）。**Variance 本身是指標**：5 reps 出 5 種解讀 = 措辭沒綁住，先收斂形式再加字。
- 「高風險」判定：紀律型三件套規約、會散播到全 fleet 的 NEVER/MUST 行、歷史上重犯 ≥2 次的主題。
- 工具：`vendor/scripts/rule-pressure-test.mjs`（baseline / with-rule 對照跑）；情境寫法見 cookbook。

## Token 紀律

- 對 always-load rule（frontmatter 無 `paths:`）加段落前，先考慮 conditional-load 或併入既有 §；預算 gate：`scripts/audit-always-load-budget.mjs`（cap 176KB）。
- 跨 rule 引用用 `[[name]]`，**NEVER** 複製他 rule 內文——複本必漂移。

## 稽核

`node scripts/audit-rule-authoring.mjs`（warn-only）：偵測 description 流程摘要、NEVER/MUST 行 nuance clause、skill 內 `@` force-load 連結。
