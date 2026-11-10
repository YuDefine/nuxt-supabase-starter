<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

aixbdd-workflow.md — aixbdd 需求到實作的 workflow 契約——plan package 是唯一迭代單位、truth 只由 truth owner skill 改、PM/RD 兩側入口順序、與 SpecFormula 的分工
5-21 前導 — aixbdd Workflow 標準
23-35 何時用 / 不用
37-60 入口順序
62-68 MUST
70-75 NEVER
77-82 Anti-pattern
84-100 clade lifecycle 適配與入口
102-117 clade 伴隨：truth feature 接到可執行測試
119-132 clade overlay
134-153 上游最新為準
155-166 Reference signal（不 block）

legacy-tests.md — 宣告 aixbdd 的 consumer 裡，導入 BDD 之前留下的舊測試——凍結、只減不增、工作碰到就吸收；新測試與迴歸的落點
5-20 前導 — 舊測試收編（aixbdd consumer）
22-33 一次性分類（每個 consumer 做一次）
35-48 MUST
50-57 驗收發現的 bug＝整塊吸收的入口
59-64 NEVER
66-72 Reference signal（不 block）

specformula.md — SpecFormula BDD/SDD 框架的 fleet 採用契約——spec-first 順序、embedded／PostgreSQL 資料源判定、framework-neutral HTTP／test-control seam、業務時鐘單一來源、hosted Supabase 的 SSL 阻斷
5-19 前導 — SpecFormula 標準（fleet 唯一 SDD/BDD 框架）
21-32 何時用 / 不用
34-65 API surface
67-83 Truth 佈局
85-87 Wiring
89-95 MUST
97-104 NEVER
106-112 Anti-pattern
114-116 Embedded fixture 的驗證邊界
118-132 clade 驗收執行（CLI／檔案系統／投影）
134-146 Reference signal（不 block）
