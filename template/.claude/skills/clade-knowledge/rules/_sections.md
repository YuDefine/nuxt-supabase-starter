<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

consumer-docs-retirement.md — Consumer 零 docs 目錄與 truth 准入——lifecycle repo 不得有任何名為 docs 的目錄（specs/truth/docs 例外）、truth 每檔有 owner；未遷移 consumer 過渡期不得在 docs/ 開新檔
5-10 前導 — Consumer docs 退役與 truth 准入
12-33 Lifecycle repo（有 `specs/truth/work-lifecycle.md`）
35-41 未遷移 consumer（沒有 `specs/truth/work-lifecycle.md`）

decision-structure.md — 決策結構標準（唯一 SoT）——決策點的形狀、固定格式、做到哪一層（D1～D*）、每張決策表必帶第三態／assumption／retire_if／決策紀錄；任何 consumer 被要求建決策樹、決策表或標準判斷流程時讀（說「決策樹」一律做成決策表，不畫樹）
13-15 前導
17-49 Rule 1 - 決策點的 predicate 全部可機械取得時，判定交給 CLI，文件只寫代碼對應動作
51-98 Rule 2 - 依決策的形狀選結構，不同形狀不混在同一張表
100-138 Rule 3 - 決策區塊使用固定格式
140-167 Rule 4 - 一個決策只有一份 SoT
169-199 Rule 5 - predicate 必須在做判定的那一步已經取得
201-239 Rule 6 - 決策要做到哪一層，依錯誤成本與有沒有人在等
241-280 Rule 7 - 每張決策表必帶第三態、假設、退場條件與決策紀錄

golden-path-onboarding.md — 新 consumer 首次開 session 時 MUST 跑 golden-path-adoption audit，缺項主動補齊；onboarding 必動的 manifest / meta / 入口檔上 path-scoped 載入
14-19 前導 — Golden Path Onboarding
21-44 MUST
46-55 Golden Path Checklist（目前項目）
57-61 NEVER
63-66 相關

knowledge-and-decisions.md — 知識沉澱與決策記錄規則——lifecycle repo 把現行決策與會重現的教訓併進它約束的 truth 單位；未遷移 consumer 不在 docs/ 開新檔，寫進當下工作的 plan／spec
5-9 前導 — Knowledge Accumulation & Decision Records
11-23 知識萃取（任務結束時）
25-57 架構決策記錄（ADR）
59-66 任務前檢查（輕量）
68-72 規則生命週期

local-rule-override.md — Consumer 自有規約 override clade core rule 時的宣告慣例。
5-27 前導 — Consumer local rule override declaration
29-32 When to declare
34-36 Grandfathered local rules
38-40 反向課題

new-project-readiness.md — 新專案（scaffold / init / 從 starter 灌進既有 repo）期間撞到的每一個報錯、阻礙、體驗不佳處，要修在 clade / starter 源頭並長出機械檢查，不要只修當前 repo。放行 gate 是 scripts/audit-new-project-readiness.ts。
5-10 前導 — New Project Readiness
12-31 MUST
33-40 NEVER
42-64 已長出的 check（每條都對應一次真實事故）
66-70 相關

notion-work-coupling.md — consumer 宣告 notion.hub 時適用。症狀：自己發現 prod 問題不知道要不要開票、工作做完或發版了但 Notion 狀態還停在舊值、想把 PR 或截圖當證據給客戶、客戶時程頁（交付項目）看不到這件工作、不知道某個 work item 對應哪張 ticket、Notion 現況與 git 實況對不上、拿不準該不該去碰 Notion、被告知「可以標完成／結案」想直接改票狀態、想在 skill 或文件裡寫 Notion 座標或狀態名。座標一律 registry/notion-hubs.json、欄位名一律 lib/notion-hub.ts FIELDS、寫入一律 notion-sync.ts
5-11 前導 — Work Item ↔ Notion Hub 耦合
13-27 Hub 模型（一個客戶一個 hub）
29-34 觸發條件（兩者皆成立才生效）
36-47 欄位契約（property key 一字不差）
49-99 生命週期 → Notion 寫入
101-106 執行機制
108-115 Consumer 採用
117-155 與「對外輸出需 user 授權」的關係
157-162 Cross-ref

output-hygiene.md — 要寫 PR／commit message／code comment／文件／對外訊息之前
4-20 前導 — Output Hygiene — 別把內部過程變成讀者的負擔
22-39 三種最常見的洩漏形式
41-49 範例
51-53 送出前自查
55-63 例外
65-78 交回給 Charles 的收尾
80-117 Tool-derived 宣稱：quote 還是 synthesis

rule-authoring.md — 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約預設一行平述、量到失敗才加反開脫三件套、長度配讀者要做的決定、發佈前驗證
5-10 前導 — Rule Authoring（規約措辭工程）
12-18 Canonical source and native delivery boundary
20-34 新規則先問能不能寫成檢查（MUST，在分類失敗型態之前）
36-62 先分類失敗型態，再選形式（MUST）
64-68 措辭三禁（NEVER）
70-77 廣泛套用要明寫範圍（MUST）
79-90 保管 MUST 與洩漏 NEVER 拆開寫（MUST）
92-110 紀律型規約三件套（預設一行平述，量到失敗才加）
112-125 發佈前驗證
127-145 routing table 變更後的對照組重跑（固定 SOP）
147-154 load-bearing 句登記（改寫既有規約時 MUST 查）
156-164 paths glob 的 anchor 是 project root（MUST）
166-170 Runtime delivery coverage（MUST）
173-186 可變事實指 SoT，不 inline（MUST）
188-193 反開脫要精準嵌逐字，不散彈列舉
195-212 成本論證要自帶邊界
214-220 Leading word 與詞彙鎖定
222-230 資訊架構與拆分（skill 結構層）
232-254 Invocation 成本模型（skill frontmatter）
256-281 Token 紀律
283-302 稽核
304-330 Taste Rubric（品質判定的分工與校準）

runtime/notion-work-coupling.md — Runtime adapter fragment for notion-work-coupling.md
5-12 全文 — Runtime adapter: Claude

runtime/rule-authoring.md — 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約預設一行平述、量到失敗才加反開脫三件套、長度配讀者要做的決定、發佈前驗證
5-13 全文 — Claude native authoring delivery

tech-debt-routing.md — Tech debt 路由規則——決定發現的技術債該登在 clade 還是當前 consumer，以散播範圍與修法歸屬為準；登記載體依該 repo 是否為 lifecycle repo
5-14 前導 — Tech Debt Routing
16-33 決策流程
35-50 就地標記（發現當下留下來，不靠記憶）
52-60 為什麼一律先問 clade
62-67 禁止事項

timezone.md — 動到 instant 欄位、SQL 日期計算、Intl / toLocaleString 格式化、timestamp→timestamptz migration、或設定固定牆鐘時間排程時的 timezone 判準（DB 存 UTC、顯示層轉 local、AT TIME ZONE 方向）
5-11 前導 — Timezone 規約
13-15 核心原則
17-24 Must
26-32 Never
34-41 AT TIME ZONE 方向
43-53 偵測 signal
