---
description: 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約配反開脫三件套、長度配讀者要做的決定、發佈前驗證
paths: ['.clade/rules/**/*.md', '.claude/rules/**/*.md', '.claude/skills/**/*.md', 'tasks/lessons.md', 'rules/**/*.md', 'capabilities/core/skills/**/*.md', 'claude-md/**/*.md', 'vendor/snippets/**/*.md', 'docs/pitfalls/**/*.md', 'docs/digests/**/*.md', 'docs/tech-debt.md', 'HANDOFF.md']
---
<!-- Clade native rule; source: rules/core/rule-authoring.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Rule Authoring（規約措辭工程）

## Canonical source and native delivery boundary

Central rules are authored in `rules/**/*.md`; consumer-local rules are authored in `.clade/rules/**/*.md`. Each selected rule is packaged into one semantically named native skill under `.claude/skills/clade-*`, `.agents/skills/clade-*`, or `.cursor/skills/clade-*`: `SKILL.md` carries discovery metadata, `rules/_index.md` carries scope metadata, and `rules/**/*.md` carries complete bodies. These are generated delivery surfaces, so editing them never changes the canonical source. Rule delivery must not install an automatic injection hook or a single catch-all rule skill; a shared rule keeps its obligation in the common source and records target-specific mechanics in the matching adapter fragment.

**核心命題**：規約文字是塑形 agent 行為的 code，不是散文。形式選錯的規約看起來嚴謹、實測反效果——對「輸出形狀」問題用禁止句，違規率比不寫指引還高。本規則對**每一次** rule / SKILL.md / brief / snippet 的撰寫與修改生效，不是只有大改版才適用。

操作 SOP 與模板見 cookbook `vendor/snippets/rule-authoring/`。

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

1. **這個觸發事件保證會發生嗎？** 掛在「session 結束時做 X」的義務要同時給不依賴 session 正常結束的兜底（時效門檻、或下一 session 的接手條件）——auto-compact／中斷是常態。
2. **這個時刻有沒有更大聲的機制在搶？** 義務若可被 harness 內建工具「看似滿足」（`TaskCreate` 之於 tasks 檔），要明寫兩者邊界，並在**該工具的觸發點**接 hook 提醒；規約那句當 hook 訊息引用的 SoT。

實例見 [[session-tasks]]（[[pitfall-end-of-session-obligation-orphaned-by-compact]]、[[pitfall-harness-todo-tool-shadows-file-based-tasks]]）。

## 措辭三禁（NEVER）

1. **不要加 nuance clause**——「不要 X，除非真的重要」= 重開協商空間。真例外寫成獨立條件句、綁可觀察 predicate。
2. **不要用豁免子句 scope**——「此限制不適用於 code block」仍會抑制 code block。需要豁免時重構規則，讓規則本身碰不到該區。
3. **不要讓 description / 觸發條件摘要流程**——description、rule 開頭只寫「何時適用」（症狀、情境、error 字樣），不寫「會做哪幾步」；否則 agent 照 description 抄捷徑、跳過本體。

## 廣泛套用要明寫範圍（MUST）

Consumer 主線字面遵守指令、不外推。規約意圖是「對**所有** consumer / **每個** phase / **每個**符合的檔」生效時，措辭必須明寫全稱量詞：

- ❌「migration 後要重生 types」← 可能只對手上那一個做
- ✅「**每一個** migration 檔新增/修改後都要重生 types，不是只處理最後一個」

單一對象的規約照常寫。

## 保管 MUST 與洩漏 NEVER 拆開寫（MUST）

同一條目同時要求「把值寫進 X」（保管）與「不得把值寫進檔案／commit／對話」（洩漏）時，要拆成兩個 bullet，各自寫明**主體**（誰做）與**射程**；洩漏那條要明寫射程不含保管處。綁在同一個 bullet 時，agent 只執行禁令那半，保管義務變成孤兒，接著整條管理鏈被退回給 user（[[pitfall-custody-mandate-read-as-prohibition-only]]）。

- ❌「值要同步寫進 Notion 保管頁，不得寫進任何檔案、commit 或對話」
- ✅ 兩個 bullet：「**agent** 收到值後要寫進 Notion 保管頁的對應列」／「**agent** 不得把值寫進 repo 檔案、commit message、對話輸出——保管頁不在此射程」

「執行者是 <人名>」「X 為 user-only」這類句子要附**成立前提**，並寫明前提消失後本條失效——否則當時的事實限制會被照字面當成永久權責劃分續用。範本在 [[secret-custody]] 的前提失效條款段。

## 紀律型規約三件套（高違規規約 MUST 全配）

判定「高違規」：已有對應 pitfall、或 oops / audit 訊號顯示同型違規 ≥2 次。三件套：

1. **Iron Law**：一行絕對句（如 `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`），前置「**違反字面就是違反精神**」——砍掉整類「我有遵守精神」開脫。
2. **Rationalization table**：一列一組「藉口 → 現實」。藉口**必須是逐字實錄**（從 pitfall 檔、session transcript、baseline 測試抽），不虛構假想藉口——虛構的堵不到真的洞。
3. **Red Flags**：「發現自己在想 X = 停」清單，收錄違規**前兆**句式（「就這一次」「這個情況不一樣」「先做了再補」）。

三件套的既有範本：[[testing-anti-patterns]]、`~/.claude/skills/receiving-code-review`。

**三件套是對某一代模型量出來的修正，換模型就要重量。** 對照實測的紀錄要寫下跑的 model 與日期；fleet 的主力 model 換代時，對每一條帶三件套的規約重跑一次無規約對照組——對照組已經不失敗，就照 § 發佈前驗證 (a) 拿掉三件套，改回一行平鋪直述的規則。強調只在它量得出差別的地方才有資訊量，全篇都強調時，每一處都不再有資訊量。

**可選第四件——completion checkbox＋證據 gate**：兩條**同時**成立才加——(1) 完成宣告本身是高違規點的流程型 skill（apply / verify / commit 類），且 (2) 該步驟的完成**有外部可取事實可查**（實跑輸出 / 截圖 / API 回應 / exit code）。做法：completion criterion 寫成 checkbox，每格綁「貼出實跑 invocation 與 output」。實例：commit Step 6、[[proactive-skills.design-checkpoint]] § Design Gate。

**(2) 不成立就不要加**：只能靠重讀自己推理判定的步驟（措辭合不合適、方案好不好），gate 只是把同一份判斷跑第二次。判別法：寫得出「勾這格要貼哪一條命令的哪一段輸出」才算 (2) 成立。另一半見 [[checker-subagent]] § 為什麼。

## 發佈前驗證

- **新規約 / 改措辭前先跑 baseline（SHOULD）**：無規約下用誘發情境跑一次，確認失敗真的存在。對照組沒失敗 → 不要寫這條規約（沒有要修的東西，寫了只燒 token）。
- **情境只能觸發你要測的那一條規約**：同時命中第二條規約而兩者指向不同動作，正解就變歧義、pass 率變雜訊。寫完情境自問「還有哪條規約會被這段描述叫醒？」
- **對照組沒失敗有三種成因，別混為一談**：(a) 規約沒有要修的東西 → 不要寫；(b) 規約教的是**模型原本沒有的選項**（如「有 codex 這個 runtime 可以派」），無規約時模型根本無從違反 → 對照組**必然**通過，此類規約要改測反方向才有鑑別力；(c) **情境餵了真實場景不自帶的判定素材**（predicate 的答案自報在題目裡、gate 的存在被逐字聲明）→ 量到的是「答案給了會不會用」，不是「會不會自己去判」，對照組通過是**量測失真**不是失敗不存在。誤判成 (a) 會刪掉有效規約。
- **(c) 的判定與處置**：手上有同型失敗的**真實 telemetry**（ledger / transcript / audit 訊號）而對照組通過時，**先懷疑 (c)**——真實 telemetry > 合成情境。判別法：把題目裡的自報聲明刪掉還原真實資訊條件，刪了正解就變灰 = 在 harness 量測邊界外（見 `vendor/snippets/rule-authoring/README.md` § 兩支 harness 分工）。此時規約仍可寫，但要做到：(i) 理由**引 telemetry、不引 scenario**；(ii) scenario 檔頭明寫「本情境量不到 X」；(iii) 形式偏向**把推導變查表**。
- **(c) 不是 Iron Law 的豁免口**：沒有真實 telemetry 與對照組**矛盾**時，「情境可能餵了答案」不能單獨當保留規約的理由。見 `docs/rule-rationale/rule-authoring.md` § 對照組成因 (c)。
- **高風險措辭一律 micro-test**：≥5 reps 新鮮 context + 無指引對照組，逐個人工讀 flagged match（template 回聲與引用反例會偽裝成命中）。**Variance 本身是指標**：5 reps 出 5 種解讀 = 措辭沒綁住，先收斂形式再加字。
- 「高風險」判定：紀律型三件套規約、會散播到全 fleet 的 NEVER/MUST 行、歷史上重犯 ≥2 次的主題、**反轉或收窄既有 NEVER/MUST 行的觸發條件**——改方向的規約最容易讓模型兩邊都不遵守：舊的 default 已經拆掉、新的 default 還沒綁住，中間那段真空比原本沒規約更糟。
- **判讀一律以人工複讀為準，assertion regex 只當初篩**：regex 嚴重低估命中率（行首措辭稍變就不匹配）。
- **廢樣本要跟失敗樣本分開計**：耗在幻覺工具呼叫上、沒有決策可讀的 rep 是廢樣本，混算會讓 pass 率虛低。
- **兩臂都 0 = 先懷疑錨點，不要先懷疑規約**：模型沒用 prompt 要求的作答格式時兩臂會同時報 0。先讀 `rep-*.txt` 全文確認模型寫了什麼，再決定改斷言還是改措辭。
- **斷言要有一條測「落到具體對象」，不能只測方向**：baseline 常判對方向卻說不出對誰做，而後者往往才是規約買到的東西。
- 工具：`vendor/scripts/rule-pressure-test.ts`（baseline / with-rule 對照跑）；情境寫法見 cookbook。

## load-bearing 句登記（改寫既有規約時 MUST 查）

`sync-rules.ts` 的 checksum 擋不到**源檔改寫時掉了一條 load-bearing 句**（diff 上像「精簡措辭」，投影三態全綠）。`registry/rule-invariants.json` 逐條登記「這句話必須**逐字**存在於這個檔」，稽核跑 `node scripts/audit-rule-invariants.ts`（預設 warn-only，`--strict` 給 gate 用）。

- **改寫已登記的句子前先查**：`node scripts/audit-rule-invariants.ts --json | jq '.findings'`，或直接 grep registry。動到登記句而不更新 registry，audit 會報 missing
- **刻意要拿掉某句** → 先從 registry 移除該條目，再改 rule。不要為了讓 audit 變綠而刪條目——那正好把「明確決定刪掉」退回成「不小心刪掉」
- **收錄判準**：安全 carve-out、逐字反開脫句、具名指令禁令、可觀察 predicate 的 gate 句。**純解釋性理由句不收**——那些本來就該隨迭代改寫，登記它們只會製造改寫摩擦
- phrase 保留 markdown 強調符號（抓 `**NEVER**` 降級）、不存行號；phrase 要在該檔內唯一（否則報 `ambiguous`）

## paths glob 的 anchor 是 project root（MUST）

`paths:` 的 glob 錨在 target adapter 的 **projectRoot**（也就是該 runtime instruction root 所在的專案層），不是任意 git repo root。這對**每一支**帶 `paths:` 的 rule 生效，不是只有動到 monorepo 的那幾支。三條硬規約：

1. **不要寫 `template/` 前綴**。template-based consumer（`nuxt-supabase-starter`）的投影落點是 `template/.claude/rules/`，它的 project root 就是 `template/` —— 寫 `server/**` 才命中，`template/server/**` 永不命中。
2. **每一條 source-tree top-level entry 都要配 `packages/*/<entry>` 變體**。monorepo consumer（<consumer-a> 等）的 `.claude/` 在 repo root，nested package 的檔案只有這個變體抓得到。source-tree top-level 的判定清單是 `scripts/audit-rule-paths-monorepo.ts` 的 `SOURCE_TREE_DIRS`。
3. **不要靠肉眼判這兩條**。`node scripts/audit-rule-paths-monorepo.ts` 是 SoT，`WARN` = 缺 monorepo 變體、`DEAD` = 寫了 `template/` 前綴。它已是 publish blocking gate。

**不要拿 grep 回 0 當「規約已生效」**：要驗載入走 target adapter 的 loader／receipt（[[pitfall-skill-invoke-does-not-trigger-paths-gate]] § Detection）；沒有 receipt 時不宣稱已載入。

## Runtime delivery coverage（MUST）

**每一條**被宣告給 target 的 rule 都要出現在該 target 的具名 native skill package，不以另一個 runtime 的檔案或 AGENTS 摘要代替；不得由檔案存在性冒充載入 receipt。每個 target adapter 都要對無 `paths:`、合法 `paths:`、空白或 malformed `paths:` 宣告 packaging policy；malformed 必須 fail closed，不得降成無 scope 或靜默略過。合法 scope 保留在 `rules/_index.md` 供選讀。

完成 rule 增修後要實跑 `node scripts/audit-codex-rule-coverage.ts --root <consumer>`（Codex）與 target adapter 指定的 projection audit。ownership state 與 audit output 是 derived evidence，不要手改。

## 可變事實指 SoT，不 inline（MUST）

規約 prose 內不要寫死會隨時間變的事實——consumer 數量、版本號、檔案行數、百分比。一律指 SoT（`registry/consumers.json`、audit script 實跑）；歷史快照要標「(YYYY-MM 快照)」。每份 inline 快照都會各自漂移，同一個事實在不同文件裡變成不同數字。

**實測數字另外要附可原樣重跑的指令**（哪一支、什麼參數、哪個窗口）：

- 窗口**寫死**（`--since 2026-08-02T00:00:00 --days 8`），不要用「至今 / 近期」
- repo 內已有量測腳本時 **一律走它，不要現場手算**（例：`scripts/context-cost-report.ts`）
- 外部文獻數字（`et al.` / `N=`）不適用本條

機械訊號：`audit-rule-authoring.ts` 的 `measured-number-unreproducible`（warn-only；有存量，不要讀成新數字可以不附指令）。

本證據決定：實測數字進規約時要附什麼。
本證據不決定：要不要做實測——不要拿本節論證少量一點或不量。

## 反開脫要精準嵌逐字，不散彈列舉

Rationalization 反制的效力來自**逐字命中**真實開脫句。過度版是「NEVER 牆」——幾十條泛化禁令連發，單條命中率低、閱讀成本高。判準：

- ✅ 正例：[[agent-self-verification]] § NEVER 句型黑名單——每條是實際 session 的逐字句（「截圖無法驗證 X 所以跳過」）
- ❌ 反例：單一 rule 內 20+ 條連續泛化 NEVER——收斂成正向 canonical 契約表 + 少數逐字反制

## 成本論證要自帶邊界

規約裡為了說服而附的成本數字會被**反向引用**——拿去論證該規約反對的行為（例：「subagent 冷載很貴」被讀成「整批不派」，語料 `vendor/snippets/rule-authoring/scenarios/do-all-linear-execution.md`）。

所以含成本證據的**論證區塊**——出現數字、百分比、倍數、token 量、耗時，或「很貴 / 浪費 / 拖慢 / 划不來」這類定性成本詞——要在區塊末尾帶一組固定標籤，字面照抄不改寫：

```
本證據決定：<它管的那個選擇>
本證據不決定：<不准拿它論證的那個選擇>
```

**一個區塊一組，不逐句重複**；同段多句共享同一決策邊界時只寫一次。

- ❌「N 個 fresh subagent = N 倍 token 浪費」——只給成本，讀者自行外推成「所以少派」
- ✅ 同區塊末尾接 `本證據決定：怎麼派（thin brief ＋ 具名長駐）` / `本證據不決定：要不要派——NEVER 拿它當「不要派」的理由`

本證據決定：成本證據怎麼寫。
本證據不決定：要不要提供成本證據——不要拿本節當刪除、隱藏或省略成本證據的理由。拿掉證據的規約只剩命令，更難說服、更容易被繞過。

## Leading word 與詞彙鎖定

高頻概念挑一個模型 pretrained 已有語意的緊湊詞（如 ratchet / baseline / claim / absorb）當錨定詞，全文逐字重複使用——用最少 token 綁住一整區行為；比自創詞省，因為自創詞得額外花 token 現場定義，pretrained 詞免費繼承既有語意。

**不要讓同義詞漂移**——同一概念換著叫（這次「稽核」下次「檢核」下次「盤點」）等於錨定失效，agent 認不出是同一件事。新詞收進 cookbook `vendor/snippets/rule-authoring/GLOSSARY.md`，詞條要帶 `_Avoid_`：列被拒同義詞＋拒絕理由。

**入表判準**：一個概念在 ≥2 檔重複出現、或存在 ≥1 個危險近義詞（如 claim 同時指 session-claim 與 change-scoped work-claim，字面相關但語意是兩件事）→ 必須入 GLOSSARY。

## 資訊架構與拆分（skill 結構層）

Skill / rule 內容擺哪一層，決定 agent 讀不讀得到。三層資訊梯（觸達率由高到低）：**in-skill step**（主流程步驟內）＞ in-skill reference（同檔他 §）＞ disclosed reference（pointer 後的外部檔）。金字塔頂保持可讀，能下推的細節就下推——但下推的代價是觸達變機率性。

- **Branch disclosure test**：**每個** branch 都會用到的材料 inline 在主層；只有部分 branch 走到的推到 pointer 後。
- **Pointer 措辭準則**：必讀材料擺在弱措辭 pointer 後（「詳見 X」「參考 Y」）＝variance bug——有時讀有時不讀。修法**先改 pointer 措辭**（明寫「何時要讀、讀哪一段」），措辭修不動才把內容 inline 回來。
- **Sequence-cut 順序**（防 premature completion——agent 看得到後續步驟時提前宣告完成）：先 sharpen completion criterion（可勾稽、含證據要求；便宜且局部）；criterion 已收斂到底**且實際觀察到 rush** 才拆步驟；拆分只有跨**真 context boundary**（subagent dispatch，後續步驟真的不可見）才有效——inline Skill invoke 擋不住，後續步驟仍在同一 context。
- **Hard / soft dependency**：缺了會產出**錯誤結果**的前置才放 explicit setup pointer；缺了只是變鈍的用一般 prose 帶過，保持 token-light。
- **橫向落點**（這份資產該是 rule / skill / snippet / rationale doc 哪一種）要走 `/bp` skill 的 `references/placement-routing.md`，不要憑印象挑目錄。

## Invocation 成本模型（skill frontmatter）

model-invoked skill（frontmatter 省略 `disable-model-invocation`）付**context 成本**——description 常駐每輪視窗，agent 可自主觸發；user-invoked（設 `disable-model-invocation: true`）付**認知成本**——description 對 model 隱形，人得自己記得它存在、手動呼叫。

**適用 `disable-model-invocation: true`**：高副作用儀式型（publish / deploy 類）、低頻手動流程——這類即使 description 寫得再精準，也不該讓 model 自主觸發引爆副作用。

**選錯邊訊號**：model-invoked 但長期沒被自動觸發過；user-invoked 但 user 常忘記它存在。

**One trigger per branch（description 觸發詞紀律）**：model-invoked description 內每個觸發詞對應一個**真正不同**的使用分支；同一分支的同義改寫（「截圖」「看畫面」「幫我看 UI」寫三次）是 duplication，要 collapse 成一個。description 開頭前置該 skill 的 leading word，invocation 工作靠它完成。

**Negative boundary（description 邊界紀律）**：**有另一支 skill 會被同一批觸發詞吸過來**時，description 要寫出最容易誤觸發的相鄰場景並指名去處（例：`notion-hub` 的「**NOT for** clade 內部待拍板題（走 flow ask 與 /decisions）」）——agent 當場看不到兄弟 skill 的 description。`skill-trigger-collision` 列出的每一對兩邊都該有 boundary；稽核見 § 稽核 的 `desc-no-negative-boundary`。

**Callee 要保持 model-invoked**（僅限 clade 自撰的 skill）：被其他 skill 以 Skill tool 呼叫的 skill，`disable-model-invocation: true` 會連 orchestrator 的呼叫一起擋掉。設定前要先 grep 全 skill / rule 確認無跨檔 Skill-tool 呼叫。

**上游鏡像 skill 不適用本條**：帶 `LOCKED: mirrored from` banner 的 skill（例如 aixbdd）以上游為準，不要為了符合本條改鏡像檔或它的 `metadata.clade.invocation`。上游 skill 交給一支 explicit skill（例如 `specify` 的「DELEGATE 呼叫 `/clarify`」）時，停下來請使用者手動執行，不是繞過 `disable-model-invocation`。

## Token 紀律

- 對 always-load rule（frontmatter 無 `paths:`）加段落前，先考慮 conditional-load 或併入既有 §；預算 gate：`scripts/audit-always-load-budget.ts`（cap 以該 script 為準）。
- **always-load 是 zero-sum 面，加段落前先答一句「這一段有沒有可判定的觸發條件」**：該段的 NEVER / MUST 只在**特定檔案類型或特定 flow** 下才會被違反 → 它屬於 conditional，要併進**既存**的 path-scoped 姊妹檔（`rules/core/<topic>.<sub>.md`），always-load 端只留同編號 stub ＋ **具名時機**的必讀指針（「開始收截圖 evidence 之前」「派一個實作 phase 之前」這種，不是「詳見」）。答案是「每一次派工前都要判」這種無觸發條件的，才留 always-load。

  **不要為了騰空間新開一支寬 glob 的 conditional 檔**——`paths:` 的成本是「包」不是「支」（見下一條），把常駐成本從 cached prefix 搬到 nested_memory 是更貴的方向。併進既存姊妹檔不新增注入包。

  **不要調高 `DEFAULT_MAX_KB` 代替**（要調只能先轉出等量以上再 append `BUDGET_RAISE_LOG`），**也不要靠刪 NEVER 行省空間**——那是拿規約效力換 KB。headroom 低於 4 KB 時 audit 會印 `NOTE:`，不要等到 publish 中段撞 gate 才處理。
- **`paths:` 的寬度是成本變數，conditional-load 不等於免費**：命中就是**整份**進場並在該 session 剩下每個 request 重讀，長度校準一樣適用。寫或改 `paths:` 時要逐個 glob 問：**這個副檔名 / 目錄底下的編輯，本規約真的有對應條文嗎？** 答不出來就不要放（反例：`nuxt-data-perf.md` 原本的 `**/*.ts` 會在編輯 `scripts/` / `test/` 時觸發；已收窄，留作判讀範例）。
- **`paths:` 的成本是「包」不是「支」**：真正付出的是**所有 glob 命中同一路徑的規約總和**，每支分開看都站得住。**新增或放寬 `paths:` 前先跑 `node scripts/audit-rule-bundle.ts`** 看該路徑已背多少；不要只確認「我這支有對應條文」就放行。命中 ≥15 支不等於 bug，但要知道這個代價。

  **模組化優先於收窄 glob**：規約只對某類 stack 成立時，正解是放進 `rules/modules/<group>/<variant>/` 讓 `hub.json` 決定誰拿，不是留在 `core/` 再把 glob 寫窄——後者仍然投影給每個 consumer，只是少觸發幾次。
- **單條規約的長度校準**：完整形狀是**觸發條件一句 + 該做什麼一句 + 違反成本一句**；需要第四句時先問是不是該拆成兩條。寫完每一段自問「刪掉它，行為會不會變？」——不會變就刪。**總量沒超標不代表個別段落沒灌水**。
- **落盤文件的長度校準**：規約以外、由 agent 寫進 repo 的文件同樣配長度，判準是**下一個讀它的人要拿它做什麼決定**。寫完每一段自問「刪掉它，讀者的決定會不會變？」——不會變就刪。

  | 文件 | 讀者要做的決定 | 收斂形狀 |
  | --- | --- | --- |
  | pitfall | 認出自己正踩同一個坑並修掉 | Symptom / Root cause / Detection（可執行命令）/ Prevention 各自收斂；重現敘事只留能導出 detection 的那幾步 |
  | `HANDOFF.md` entry | 接手 | 現況 + 下一個動作 + 卡在哪，各一到兩句 |
  | `docs/tech-debt.md` TD entry | 判斷該不該做 | Class / Location + 一句話問題 + 一句話代價 |
  | subagent brief | 開工 | 具體路徑 + 相關規約條目 + 驗收標準 |

  不要拿「內容都是真的」當保留篇幅的理由——真但不改變任何決定的段落，成本由每一個讀者付。
- 跨 rule 引用用 `[[name]]`，不要複製他 rule 內文——複本必漂移。
- **Pointer 方向一律是 conditional → always**：去重前先確認兩檔的 `paths:` 狀態，**SoT 一律留在載入面較廣的那一份**，窄的那份放 pointer。一份在 always、一份在 conditional 的重複是**跨載入邊界的刻意備份**——修漂移，不刪副本。

## 稽核

`node scripts/audit-rule-authoring.ts`（warn-only）：偵測 description 流程摘要、nuance clause、skill 內 `@` force-load 連結、SKILL.md >400 行、description 引號觸發詞 ≥4、缺 negative boundary（`desc-no-negative-boundary`，只驗存在性，不驗有沒有指名去處）、**NEVER 牆**兩訊號：

- `never-wall`：單檔**連續**列舉式 NEVER 超標（list item / table row；散文段落內的 NEVER 不算）。結構性反模式，**無豁免**——收斂成正向 canonical 契約表 + 少數逐字反制。
- `never-density`：全檔總量超標。抓「拆進多個子 § 所以單 run 不達標、總量同樣過載」的形狀。

門檻值 SoT 在 `scripts/audit-rule-authoring.ts` 的常數，這裡不 inline。**0 命中要先當「量不到」處理，不是「語料乾淨」**。

`never-density` **有覆核出口**（紀律型規約配逐字反開脫清單時總量偏高是正確形式）。逐條覆核後在檔案掛

```markdown
<!-- never-density-reviewed: YYYY-MM-DD — <一句話理由> -->
```

即豁免 180 天（帶到期，不是永久）。掛之前要真的逐條讀過——理由寫不出「哪幾類條目為什麼是載重的」就是該刪。

不要為上游鏡射檔加兩訊號豁免而不先問「這份檔到底歸誰改」——豁免的成立條件是改不動它，不是它比較長。

## Taste Rubric（品質判定的分工與校準）

本節管**誰來判寫得好不好**。判定一律**二元 pass / fail**，不用 1-5 分。每條準則標**歸誰判**：可機械判的丟給模型會引入 variance，需要語境的丟給 regex 會系統性漏判。

| 準則（pass 條件） | Grader | 現況 |
| --- | --- | --- |
| description 不是流程摘要、不含 ≥4 個引號觸發詞 | Code | `desc-flow-summary` / `desc-trigger-dup` / `desc-verbose` / `desc-too-long` |
| SKILL.md ≤ 400 行 | Code | `skill-oversize` |
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

不要用「codex review 過了」「checker 判 pass」當成品質已驗證的憑據；可以寫「codex review 未提出問題」，不要寫「已通過品質檢驗」。校準答案卷在 `vendor/snippets/rule-authoring/critique-shadowing-corpus.md`；**同意率達 90% 之前，上表四條 Model 列一律維持「未校準」字樣**，改掉時要附同意率數字。

### 第一版預期是錯的

Rubric 要跑過幾輪真實產出才收斂。準則被實測推翻時，把「原本這樣寫、實測發現什麼」留在 corpus 檔，不要靜默改掉。
