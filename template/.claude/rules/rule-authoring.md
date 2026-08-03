---
description: 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約配反開脫三件套、長度配讀者要做的決定、發佈前驗證
paths: ['.claude/rules/**/*.md', '.claude/skills/**/*.md', 'tasks/lessons.md', 'rules/**/*.md', 'plugins/hub-core/skills/**/*.md', 'claude-md/**/*.md', 'vendor/snippets/**/*.md', 'docs/pitfalls/**/*.md', 'docs/digests/**/*.md', 'docs/tech-debt.md', 'HANDOFF.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/rule-authoring.md
Edit at: $CLADE_HOME
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

### 選好形式之後，再檢查義務綁在哪個事件上（MUST）

形式對了、措辭對了，規約仍可能整條失效——因為它掛的觸發事件不會發生，或發生時注意力已經被別人拿走。動筆前對每條義務問兩題：

1. **這個觸發事件保證會發生嗎？** 掛在「session 結束時做 X」的義務 **MUST** 同時給一個不依賴 session 正常結束的兜底（時效門檻、或下一 session 的接手條件）——session 被 auto-compact／中斷是常態不是例外，原 session 一旦消失，義務就永遠不會被履行，而**沒有人有權代勞**的規約會讓殘留物單調累積。
2. **這個時刻有沒有更大聲的機制在搶？** 義務若可被 harness 內建工具「看似滿足」（`TaskCreate` 之於 tasks 檔），**MUST** 明寫兩者邊界，並在**該工具的觸發點**接機械提醒。規約只在冷載時說一次，harness 提醒會反覆出現——單靠文字必輸。以 harness 治 harness：hook 是主要防線，規約那句提供 hook 訊息可引用的 SoT。

兩題的實證都在 [[session-tasks]]：第 1 題對應 `tasks/` 的無主檔接管（2026-08-02 實測全 fleet 38 檔堆積），第 2 題對應 `TaskCreate` 取代建檔（寫規約的那個 session 自己就違反了）。對應 pitfall [[pitfall-end-of-session-obligation-orphaned-by-compact]] 與 [[pitfall-harness-todo-tool-shadows-file-based-tasks]]。

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

**可選第四件——completion checkbox＋證據 gate**：兩條**同時**成立才加——(1) 完成宣告本身是高違規點的流程型 skill（apply / verify / commit 類），且 (2) 該步驟的完成**有外部可取事實可查**（實跑輸出 / 截圖 / API 回應 / DB 狀態 / exit code）。兩條都中，把 completion criterion 寫成 checkbox 清單，每格綁「貼出實跑 invocation 與 output」——宣告完成前逐格附證據，只宣稱 done 不算完成。這是 § 資訊架構與拆分 sequence-cut 順序裡「先 sharpen criterion」的實作形式（便宜且局部，先於拆步驟）。出處：mattpocock/skills `diagnosing-bugs` completion checklist。落地實例：spectra-apply「Completion evidence gate」、spectra-verify Step 8、commit Step 6。

**(2) 不成立就 NEVER 加**：完成與否只能靠重讀自己的推理判定的步驟（判斷寫得對不對、措辭合不合適、方案選得好不好），加 gate 買不到東西——模型會自行捕捉並修正自己的錯誤，gate 只是把同一份判斷跑第二次，燒 token 不提升品質。判別法：寫得出「勾這格要貼哪一條命令的哪一段輸出」才算 (2) 成立，寫不出來就是純推理步驟。同一條界線的另一半見 [[checker-subagent]] § 為什麼——fresh context 買到的是「沒看過實作過程」，不是「更嚴格」。

## 發佈前驗證

- **新規約 / 改措辭前先跑 baseline（SHOULD）**：無規約下用誘發情境跑一次，確認失敗真的存在。對照組沒失敗 → 不要寫這條規約（沒有要修的東西，寫了只燒 token）。
- **情境 MUST 只觸發你要測的那一條規約**：情境若同時命中第二條規約而兩者指向不同動作，正解就變歧義、pass 率被稀釋成雜訊，看起來像規約沒綁住、實際是題目出錯。判定法：寫完情境後自問「還有哪條規約會被這段描述叫醒？」（實例：`destructive-euphemism` 原版把 untracked 目錄設成 `openspec/changes/archive/…`，同時叫醒 [[commit]] § Partial Archive Gate「partial state MUST 由 user 拍板」，使兩個選項都站得住；換成一般 scratch 目錄後 baseline 0/5 → with-rule 4/5，鑑別力才回來）。
- **對照組沒失敗有兩種成因，別混為一談**：(a) 規約沒有要修的東西 → 不要寫；(b) 規約教的是**模型原本沒有的選項**（如「有 codex 這個 runtime 可以派」），無規約時模型根本無從違反 → 對照組**必然**通過，此類規約要改測反方向才有鑑別力。誤判成 (a) 會刪掉有效規約。
- **高風險措辭 MUST micro-test**：≥5 reps 新鮮 context + 無指引對照組，逐個人工讀 flagged match（template 回聲與引用反例會偽裝成命中）。**Variance 本身是指標**：5 reps 出 5 種解讀 = 措辭沒綁住，先收斂形式再加字。
- 「高風險」判定：紀律型三件套規約、會散播到全 fleet 的 NEVER/MUST 行、歷史上重犯 ≥2 次的主題、**反轉或收窄既有 NEVER/MUST 行的觸發條件**——改方向的規約最容易讓模型兩邊都不遵守：舊的 default 已經拆掉、新的 default 還沒綁住，中間那段真空比原本沒規約更糟。
- **判讀一律以人工複讀為準，assertion regex 只當初篩**：regex 嚴重低估命中率。實測語料：`我選 **B**` 這個最常見的開頭因為 `我` 卡在行首而不匹配，人工複讀 5/5、assertion 只認 2/5。看 assertion 數字下結論等於量錯了還不知道。
- **廢樣本 MUST 跟失敗樣本分開計**：`--tools ''` 隔離下模型可能把整個輸出耗在幻覺工具呼叫上，那種 rep 沒有決策可讀，是**廢樣本**不是失敗樣本。混在一起算會讓 pass 率虛低，看起來像措辭沒綁住。
- 工具：`vendor/scripts/rule-pressure-test.ts`（baseline / with-rule 對照跑）；情境寫法見 cookbook。

## load-bearing 句登記（改寫既有規約時 MUST 查）

`sync-rules.ts` 的 checksum 擋的是**投影被竄改**。它擋不到反方向：**源檔自己在改寫時掉了一條 load-bearing 句**——源檔變了、投影跟著變、`.hub-state.json` 更新，drift / stale / orphan 三態全綠，規約已失去牙齒卻零訊號，然後散播到全 registry consumer。diff 上它看起來像「精簡措辭」。

`registry/rule-invariants.json` 逐條登記「這句話必須**逐字**存在於這個檔」，稽核跑 `node scripts/audit-rule-invariants.ts`（預設 warn-only，`--strict` 給 gate 用）。

- **改寫已登記的句子前 MUST 先查**：`node scripts/audit-rule-invariants.ts --json | jq '.findings'`，或直接 grep registry。動到登記句而不更新 registry，audit 會報 missing
- **刻意要拿掉某句** → 先從 registry 移除該條目，再改 rule。**NEVER** 為了讓 audit 變綠而刪條目——那正好把「明確決定刪掉」退回成「不小心刪掉」
- **收錄判準**：安全 carve-out、逐字反開脫句、具名指令禁令、可觀察 predicate 的 gate 句。**純解釋性理由句不收**——那些本來就該隨迭代改寫，登記它們只會製造改寫摩擦
- **phrase 保留 markdown 強調符號**（`**NEVER**`）：措辭稀釋最常見的形式就是把 `**NEVER**` 降級成「不建議」，保留符號才抓得到降級
- **registry 不存行號**：行號隨編輯漂移，phrase 不會。phrase MUST 在該檔內唯一（audit 的 `ambiguous` 就是在報這個）

## 可變事實指 SoT，不 inline（MUST）

規約 prose 內**NEVER** 寫死會隨時間變的事實——consumer 數量、版本號、檔案行數、百分比。一律指 SoT（`registry/consumers.json`、audit script 實跑）；歷史快照要標「(YYYY-MM 快照)」。實證：fleet 規模「5」曾同時存在於 6 份文件，registry 實際 12——每份 inline 快照都是一顆漂移地雷（2026-07-05 語料掃描）。

## 反開脫要精準嵌逐字，不散彈列舉

Rationalization 反制的效力來自**逐字命中**真實開脫句（agent 看到自己正要說的那句話被點名，才會停）。同一手法的過度版是「NEVER 牆」——幾十條泛化禁令連發，單條命中率低、閱讀成本高、且多半在用禁止句處理形狀問題（違反 § 先分類失敗型態）。判準：

- ✅ 正例：[[agent-self-verification]] § NEVER 句型黑名單——每條是實際 session 的逐字句（「截圖無法驗證 X 所以跳過」）
- ❌ 反例：單一 rule 內 20+ 條連續泛化 NEVER——收斂成正向 canonical 契約表 + 少數逐字反制

## 成本論證要自帶邊界

規約裡為了說服而附的成本數字（token 浪費、實測百分比、失敗案例）會被**反向引用**——拿去論證該規約反對的那個行為。因為它提供了現成的權威說法，而引用者不必自己承擔舉證責任。

實證（2026-07-26 `\do-all` baseline，語料見 `vendor/snippets/rule-authoring/scenarios/do-all-linear-execution.md`）：`Parallel Subagent Fan-out §` 用「13 個 fresh subagent 冷載 = 單 session 49% token」論證**要用 thin brief ＋ 具名長駐**；對照組把它讀成「派 subagent 很貴」，逐字寫出「光是 subagent 冷載 context 就比自己做貴」來論證**整批不派**。規約沒被違反，是被**當成理由**——這比違反更難抓，因為輸出看起來有引用、有根據。

所以含成本證據的**論證區塊**——出現數字、百分比、倍數、token 量、耗時，或「很貴 / 浪費 / 拖慢 / 划不來」這類定性成本詞——**MUST** 在區塊末尾帶一組固定標籤，字面照抄不改寫：

```
本證據決定：<它管的那個選擇>
本證據不決定：<不准拿它論證的那個選擇>
```

**一個區塊一組，不逐句重複**；同段多句共享同一決策邊界時只寫一次。

- ❌「N 個 fresh subagent = N 倍 token 浪費」——只給成本，讀者自行外推成「所以少派」
- ✅ 同區塊末尾接 `本證據決定：怎麼派（thin brief ＋ 具名長駐）` / `本證據不決定：要不要派——NEVER 拿它當「不要派」的理由`

本證據決定：成本證據怎麼寫。
本證據不決定：要不要提供成本證據——**NEVER** 拿本節當刪除、隱藏或省略成本證據的理由。拿掉證據的規約只剩命令，更難說服、更容易被繞過。

## Leading word 與詞彙鎖定

高頻概念挑一個模型 pretrained 已有語意的緊湊詞（如 ratchet / baseline / claim / absorb）當錨定詞，全文逐字重複使用——用最少 token 綁住一整區行為；比自創詞省，因為自創詞得額外花 token 現場定義，pretrained 詞免費繼承既有語意。

**NEVER 同義詞漂移**——同一概念換著叫（這次「稽核」下次「檢核」下次「盤點」）等於錨定失效，agent 認不出是同一件事。新詞收進 cookbook `vendor/snippets/rule-authoring/GLOSSARY.md`，詞條**MUST**帶 `_Avoid_`：列被拒同義詞＋拒絕理由。

**入表判準**：一個概念在 ≥2 檔重複出現、或存在 ≥1 個危險近義詞（如 claim 同時指 session-claim 與 change-scoped work-claim，字面相關但語意是兩件事）→ 必須入 GLOSSARY。

方法論來源：mattpocock/skills `writing-great-skills`（Leitwort + glossary `_Avoid_` 手法），與 § 先分類失敗型態，再選形式互補——那條管句式層，本條管詞彙層。

## 資訊架構與拆分（skill 結構層）

Skill / rule 內容擺哪一層，決定 agent 讀不讀得到。三層資訊梯（觸達率由高到低）：**in-skill step**（主流程步驟內）＞ in-skill reference（同檔他 §）＞ disclosed reference（pointer 後的外部檔）。金字塔頂保持可讀，能下推的細節就下推——但下推的代價是觸達變機率性。

- **Branch disclosure test**：**每個** branch 都會用到的材料 inline 在主層；只有部分 branch 走到的推到 pointer 後。
- **Pointer 措辭準則**：必讀材料擺在弱措辭 pointer 後（「詳見 X」「參考 Y」）＝variance bug——有時讀有時不讀。修法**先改 pointer 措辭**（明寫「何時 MUST 讀、讀哪一段」），措辭修不動才把內容 inline 回來。
- **Sequence-cut 順序**（防 premature completion——agent 看得到後續步驟時提前宣告完成）：先 sharpen completion criterion（可勾稽、含證據要求；便宜且局部）；criterion 已收斂到底**且實際觀察到 rush** 才拆步驟；拆分只有跨**真 context boundary**（subagent dispatch，後續步驟真的不可見）才有效——inline Skill invoke 擋不住，後續步驟仍在同一 context。
- **Hard / soft dependency**：缺了會產出**錯誤結果**的前置才放 explicit setup pointer；缺了只是變鈍的用一般 prose 帶過，保持 token-light。
- **橫向落點是另一個軸**：本節管的是同一份資產**內部**的深度（哪一段擺主層、哪一段推到 pointer 後）。「這份資產本身該放哪個目錄」——rule / skill / snippet / rationale doc / conventions entry 之間怎麼選——**MUST** 走 `/bp` skill，讀它的 `references/placement-routing.md`；那份帶 7 個落點的散播機制與載入時機對照，以及縱向下推三分法（留原處 / `docs/rule-rationale/` / 新建帶 `paths:` 的 conditional rule）。憑印象挑目錄是既有的 variance 來源。

出處：mattpocock/skills `writing-great-skills`（information hierarchy / premature completion）＋ `.agents/adr/0001`。

## Invocation 成本模型（skill frontmatter）

model-invoked skill（frontmatter 省略 `disable-model-invocation`）付**context 成本**——description 常駐每輪視窗，agent 可自主觸發；user-invoked（設 `disable-model-invocation: true`）付**認知成本**——description 對 model 隱形，人得自己記得它存在、手動呼叫。

**適用 `disable-model-invocation: true`**：高副作用儀式型（publish / deploy 類）、低頻手動流程——這類即使 description 寫得再精準，也不該讓 model 自主觸發引爆副作用。

**選錯邊訊號**：model-invoked 但實測長期沒被自動觸發過（白付 context 成本卻無收益）；user-invoked 但 user 常忘記它存在（該省的認知成本沒省到，還漏用）。Description 字元預算與 `desc-verbose` detector 對應 TD-232 sweep（`scripts/audit-rule-authoring.ts`）。

**One trigger per branch（description 觸發詞紀律，MUST）**：model-invoked description 內每個觸發詞對應一個**真正不同**的使用分支；同一分支的同義改寫（「截圖」「看畫面」「幫我看 UI」寫三次）是 duplication，MUST collapse 成一個。description 開頭前置該 skill 的 leading word，invocation 工作靠它完成。

**Negative boundary（description 邊界紀律）**：**每一支**有語義相鄰兄弟的 model-invoked skill，description **MUST** 寫出最容易被誤觸發的那個相鄰場景，並指名該去哪一支。觸發詞只寫正面，邊界就由 agent 當場猜——而它猜的時候看不到兄弟 skill 的 description，只看得到自己這一份。

判準綁可觀察 predicate：**有沒有另一支 skill 會被同一批觸發詞吸過來？** 有就 MUST 寫，沒有就不必寫。`audit-rule-authoring.ts` 的 `skill-trigger-collision` 訊號列出的每一對，兩邊都該有指向對方的 boundary。

clade 自家正例：`notion-board` 的「**NOT for** 主動建立一張新的決策題 ticket 去問客戶拍板——那是 outbound，走 /notion-ticket」、`codex-drive` 的「**NOT for** 小修改（Claude Code 直接做更快）、已有 Spectra 的專案、或純 review 工作」。兩者都做到「講出相鄰場景 + 指名去處」，只寫「NOT for 小修改」而不說去哪，agent 仍得自己猜。

出處：`openai/codex-security` 的 skill 集（2026-08 快照）——階段型 skill（finding-discovery / validation / attack-path-analysis / threat-model）每一支 description 都帶「Do not use as the primary trigger for full PR, commit, branch, patch, or repository scans」，把「頂層入口 vs 階段內部」這條邊界寫死在 description 而非 body。稽核見 § 稽核 的 `desc-no-negative-boundary`。

**Callee MUST 保持 model-invoked**：被其他 skill 以 Skill tool 呼叫的 skill，`disable-model-invocation: true` 會連 orchestrator 的呼叫一起擋掉。設定前 MUST grep 全 skill / rule 確認無跨檔 Skill-tool 呼叫（實證：screenshots-archive / review-archive 被 spectra-archive 與 spectra orchestrator 自動呼叫，2026-07-24 排雷）。

出處：mattpocock/skills `.agents/invocation.md` 的 model-invoked／user-invoked 成本二分法 + `writing-great-skills`（"Synonyms that rename a single branch are duplication"）。

## Token 紀律

- 對 always-load rule（frontmatter 無 `paths:`）加段落前，先考慮 conditional-load 或併入既有 §；預算 gate：`scripts/audit-always-load-budget.ts`（cap 以該 script 為準）。
- **`paths:` 的寬度是成本變數，conditional-load 不等於免費（MUST）**：條件式規約一旦命中就是**整份**進場，之後被該 session 剩下的每一個 request 以 cache-read 重讀。實測（2026-08-02，7 天）：`nested_memory` 注入 2,105 次、8.45M tokens，約佔加權帳單 5.8%——單次注入 8–12.5k tokens。所以「移到 conditional 就不用管長度」是錯的，**上一條的長度校準對 conditional 規約一樣適用**。

  寫或改 `paths:` 時 **MUST** 逐個 glob 問：**這個副檔名 / 目錄底下的編輯，本規約真的有對應條文嗎？** 答不出來就不要放進去。三個實測命中的反例：

  | 反例 | 為什麼錯 |
  | --- | --- |
  | `code-style.md` 的 glob 含 `md` | 全部條文是 eslint 禁令 / vite-plus 安裝 / CI 命令 / TS 腳本慣例，沒有一條在編輯 markdown 時適用；而它自己的 fmt `ignorePatterns` 就寫著 `'**/*.md'` |
  | `data-layer-d1.md` 放在 `rules/core/` + glob `**/*.{ts,vue,sql}` | D1 專用規約卻投影給全部 consumer，`hub.json` 顯示只有 3 個是 `db-schema: cf-d1`；用 supabase 的 consumer 每次改 `.ts` 就吃 8.5k tokens |
  | `nuxt-data-perf.md` 的 `**/*.ts` | 會在編輯 `scripts/` / `test/` / `e2e/` / `vendor/` 時觸發，那些位置沒有對應條文 |

- **`paths:` 的成本是「包」不是「支」（MUST）**：上一條問的是「本規約有沒有對應條文」，那是**單支**的問題。真正付出去的成本是**所有 glob 命中同一條路徑的規約總和**——十幾支各自宣告 `openspec/changes/**`，每一支分開看都站得住，但編輯一次 `tasks.md` 就把它們全部拉進 context。

  **這是湧現成本，沒有任何一個規約作者在自己那份檔案裡看得見它。** 2026-08-02 全 fleet 7 天實測：

  | 一次觸發拉幾支 | 觸發次數 | tokens | 佔 nested_memory |
  | --- | ---: | ---: | ---: |
  | 1 支 | 96 | 218k | 2.3% |
  | 2–5 支 | 108 | 1,358k | 14.5% |
  | 6–14 支 | 85 | 3,803k | 40.5% |
  | **≥15 支** | **45** | **4,011k** | **42.7%** |

  13% 的觸發產生 43% 的成本；最大一次注入 **33 支 / 320.5 KB / 約 143k tokens**，比整個常駐 floor（實測 104k）還大。

  所以**新增或放寬 `paths:` 前 MUST 先跑 `node scripts/audit-rule-bundle.ts` 看該路徑現在已經背著多少**，再決定自己這支要不要加進去。**NEVER** 只確認「我這支有對應條文」就放行——那個判準通過的規約疊起來就是上表那 43%。

  命中 ≥15 支**不等於 bug**（`openspec/changes/**` 底下的工作本來就需要多份規約在場），但它是「這個代價你知不知道」的分界線。

  **模組化優先於收窄 glob**：規約只對某類 stack 成立時，正解是放進 `rules/modules/<group>/<variant>/` 讓 `hub.json` 決定誰拿，不是留在 `core/` 再把 glob 寫窄——後者仍然投影給每個 consumer，只是少觸發幾次。
- **單條規約的長度校準（MUST）**：長度配問題大小。一條規約的完整形狀是**觸發條件一句 + 該做什麼一句 + 違反成本一句**；需要第四句時先問是不是該拆成兩條。寫完每一段自問「刪掉它，行為會不會變？」——不會變就刪。上一條的預算 gate 是總量閘，這條管每一段自己該多長：**總量沒超標不代表個別段落沒灌水**，而總量一旦逼近 cap，先被犧牲的會是真正需要篇幅的那幾條。
- **落盤文件的長度校準（MUST）**：規約以外、由 agent 寫進 repo 的文件同樣配長度，判準是**下一個讀它的人要拿它做什麼決定**。寫完每一段自問「刪掉它，讀者的決定會不會變？」——不會變就刪。

  | 文件 | 讀者要做的決定 | 收斂形狀 |
  | --- | --- | --- |
  | pitfall | 認出自己正踩同一個坑並修掉 | Symptom / Root cause / Detection（可執行命令）/ Prevention 各自收斂；重現敘事只留能導出 detection 的那幾步 |
  | `HANDOFF.md` entry | 接手 | 現況 + 下一個動作 + 卡在哪，各一到兩句 |
  | `docs/tech-debt.md` TD entry | 判斷該不該做 | Class / Location + 一句話問題 + 一句話代價 |
  | subagent brief | 開工 | 具體路徑 + 相關規約條目 + 驗收標準 |

  Opus 5 的落盤文件比前代長是已知偏差（官方 prompting guide § Written deliverable length）。**NEVER** 拿「內容都是真的」當保留篇幅的理由——真但不改變任何決定的段落，成本由每一個讀者付。
- 跨 rule 引用用 `[[name]]`，**NEVER** 複製他 rule 內文——複本必漂移。
- **Pointer 方向 MUST 是 conditional → always**（去重時最容易踩的洞）：always-load 檔指向 conditional-load 檔，等於在 conditional 檔沒載入的 session 完全失去該規約。判定法：去重前先確認兩檔的 `paths:` 狀態，**SoT 一律留在載入面較廣的那一份**，窄的那份放 pointer。看似「同一份清單重複兩次」的東西，若一份在 always、一份在 conditional，那是**跨載入邊界的刻意備份**，不是冗餘——此時要修的是漂移（對齊內容），不是刪副本。實例：破壞性話術關鍵詞表留在 always-load 的 [[commit]]，conditional 的 [[scope-discipline]] 引用它。

## 稽核

`node scripts/audit-rule-authoring.ts`（warn-only）：偵測 description 流程摘要、NEVER/MUST 行 nuance clause、skill 內 `@` force-load 連結、SKILL.md 行數超標（>400 行拆分候選；spectra fork 豁免）、description 引號觸發詞 ≥4（one-trigger-per-branch 違反跡象）、description 缺 negative boundary（`desc-no-negative-boundary`；spectra fork 豁免）、**NEVER 牆**兩訊號。

`desc-no-negative-boundary` 是**存在性**訊號，不是品質訊號：它只看得到有沒有 `NOT for` / `Do not use` / `不適用` / `NEVER for` 這類標記，看不到那句話有沒有指名去處。0 命中**不代表**每支的 boundary 都寫得夠好——寫得好不好只有人讀得出來。

NEVER 牆兩訊號對應 § 反開脫要精準嵌逐字的 ❌ 反例：

- `never-wall`：單檔**連續**列舉式 NEVER 超標（list item / table row；散文段落內的 NEVER 不算）。結構性反模式，**無豁免**——收斂成正向 canonical 契約表 + 少數逐字反制。
- `never-density`：全檔總量超標。抓「拆進多個子 § 所以單 run 不達標、總量同樣過載」的形狀。

兩個門檻值**依實測分位數定，SoT 在 `scripts/audit-rule-authoring.ts` 的常數**（連同取值依據寫在該處註解）。這裡 **NEVER** inline 數字——2026-07 實測發現舊門檻雙雙高於語料上限、兩訊號都是永不觸發的死碼，而 rule prose 抄著同一組數字讓它看起來仍在把關。**0 命中要先當「量不到」處理，不是「語料乾淨」**：確認門檻落在實測分佈之內，再下乾淨的結論。

`never-density` **有覆核出口**：紀律型規約依 § 紀律型規約三件套本來就該配逐字反開脫清單，總量偏高是正確形式。逐條覆核後在檔案掛

```markdown
<!-- never-density-reviewed: YYYY-MM-DD — <一句話理由> -->
```

即豁免 180 天（沿用 `audit-tech-debt-hygiene` 的 `Last reviewed` 慣例：**帶到期，不是永久豁免**；過期後 warn 會回來並附已過天數）。掛之前 MUST 真的逐條讀過——理由要寫得出「哪幾類條目為什麼是載重的」，寫不出來就是該刪。Spectra fork（frontmatter `generatedBy: Spectra`）兩訊號皆豁免，理由同 `skill-oversize`。

## Taste Rubric（品質判定的分工與校準）

上面各節管**怎麼寫**；本節管**誰來判寫得好不好**，以及那個判斷憑什麼可信。

判定一律**二元 pass / fail**，不用 1-5 分。理由：分數會被當成可加總的量（「3 分還行」），
而規約措辭沒有「還行」——一條範圍沒明寫全稱量詞的 MUST，在字面遵守的主線上就是失效的，
給它 3 分不會讓它半有效。

每條準則標**歸誰判**。Grader 選錯比沒有 Grader 更糟：把可機械判的丟給模型 = 引入不必要的
variance；把需要語境的丟給 regex = 系統性漏判。

| 準則（pass 條件） | Grader | 現況 |
| --- | --- | --- |
| description 不是流程摘要、不含 ≥4 個引號觸發詞 | Code | `desc-flow-summary` / `desc-trigger-dup` / `desc-verbose` / `desc-too-long` |
| SKILL.md ≤ 400 行 | Code | `skill-oversize`（Spectra fork 豁免） |
| 跨 skill 觸發詞無碰撞 | Code | `skill-trigger-collision` |
| NEVER 未成牆、總量未過載 | Code | `never-wall` / `never-density`（後者有 180 天覆核出口） |
| 可變事實指 SoT 而非 inline | Code | `fleet-count-inline` |
| skill 內無 `@` force-load 連結 | Code | `force-load-link` |
| pointer 指得到的檔在本 repo 載得進來 | Code | `audit-rule-paths.ts` 的 `dangling-pointer-target`（diagnostic） |
| pressure scenario 有實測紀錄且 target 解析得到 | Code | `scenario-unmeasured` / `scenario-no-target` / `scenario-dangling-target` |
| 失敗型態分類正確（形狀問題沒被寫成禁止句） | **Model** | **未校準** |
| 反開脫逐字取自真實語料，不是虛構藉口 | **Model** | **未校準** |
| 規約意圖廣泛套用時，措辭明寫了全稱量詞 | **Model** | **未校準** |
| 長度配得上讀者要做的決定 | **Model** | **未校準** |
| 這條規約該不該存在（vs 該退場 / 該歸到別層） | **Human** | steward 判 |

### Model Grader 未校準時的措辭紀律

標 **未校準** 的四條，目前沒有任何數字支持 Model Grader 的判斷跟 steward 一致。因此：

**NEVER** 用「codex review 過了」「checker 判 pass」當成品質已驗證的憑據 —— 那句話目前的
資訊量是零，因為沒人量過它跟人的同意率。可以寫「codex review 未提出問題」（陳述事實），
**NEVER** 寫「已通過品質檢驗」（宣稱效力）。

校準的答案卷在 `vendor/snippets/rule-authoring/critique-shadowing-corpus.md`（含取樣方法、
標註規則、與達標判準）。**同意率達 90% 之前，上表四條 Model 列一律維持「未校準」字樣** ——
改掉那三個字 MUST 附同意率數字。

### 第一版預期是錯的

Rubric 不是一次寫死。比照本檔 § 發佈前驗證 的 baseline / with-rule 迭代邏輯，Rubric 也要跑過
幾輪真實產出才會收斂（Criteria Drift）。**第一版準則被實測推翻不是失敗，是這個機制在運作**
—— 推翻時把「原本這樣寫、實測發現什麼」留在 corpus 檔，不要靜默改掉。
