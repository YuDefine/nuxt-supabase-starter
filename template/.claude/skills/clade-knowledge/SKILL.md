---
name: "clade-knowledge"
description: "Use for durable docs, decisions, onboarding, rule authoring, tech debt, or writing a decision table/tree or standard judgment flow (分流、決策表、決策樹)."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/consumer-docs-retirement.md`：Consumer 零 docs 目錄與 truth 准入——lifecycle repo 不得有任何名為 docs 的目錄（specs/truth/docs 例外）、truth 每檔有 owner；未遷移 consumer 過渡期不得在 docs/ 開新檔；且碰 `docs/**`、`**/docs/**`、`specs/truth/**`
   - `rules/decision-structure.md`：決策結構標準（唯一 SoT）——決策點的形狀、固定格式、做到哪一層（D1～D*）、每張決策表必帶第三態／assumption／retire_if／決策紀錄；任何 consumer 被要求建決策樹、決策表或標準判斷流程時讀（說「決策樹」一律做成決策表，不畫樹）；或要在 skill、rule、plan 或文件裡寫分流、判定表、決策樹或標準判斷流程，或要決定一個決策做到哪一層（閘門、CLI、文件決策表）；且碰 `.claude/skills/**/*.md`、`.agents/skills/**/*.md`、`.clade/rules/**/*.md` 等 7 處
   - `rules/golden-path-onboarding.md`：新 consumer 首次開 session 時 MUST 跑 golden-path-adoption audit，缺項主動補齊；onboarding 必動的 manifest / meta / 入口檔上 path-scoped 載入；且碰 `.clade/manifest.json`、`.claude/hub.json`、`.claude/consumer-meta.json` 等 9 處
   - `rules/knowledge-and-decisions.md`：知識沉澱與決策記錄規則——lifecycle repo 把現行決策與會重現的教訓併進它約束的 truth 單位；未遷移 consumer 不在 docs/ 開新檔，寫進當下工作的 plan／spec；且碰 `docs/solutions/**`、`docs/decisions/**`、`specs/**` 等 4 處
   - `rules/local-rule-override.md`：Consumer 自有規約 override clade core rule 時的宣告慣例。；且碰 `.clade/rules/**/*.md`、`.claude/rules/local/**/*.md`
   - `rules/new-project-readiness.md`：新專案（scaffold / init / 從 starter 灌進既有 repo）期間撞到的每一個報錯、阻礙、體驗不佳處，要修在 clade / starter 源頭並長出機械檢查，不要只修當前 repo。放行 gate 是 scripts/audit-new-project-readiness.ts。；且碰 `.claude/consumer-meta.json`、`.clade/manifest.json`、`.claude/hub.json` 等 7 處
   - `rules/notion-work-coupling.md`：consumer 宣告 notion.hub 時適用。症狀：自己發現 prod 問題不知道要不要開票、工作做完或發版了但 Notion 狀態還停在舊值、想把 PR 或截圖當證據給客戶、客戶時程頁（交付項目）看不到這件工作、不知道某個 work item 對應哪張 ticket、Notion 現況與 git 實況對不上、拿不準該不該去碰 Notion、被告知「可以標完成／結案」想直接改票狀態、想在 skill 或文件裡寫 Notion 座標或狀態名。座標一律 registry/notion-hubs.json、欄位名一律 lib/notion-hub.ts FIELDS、寫入一律 notion-sync.ts；且碰 `tasks/**`、`specs/plans/**`、`.claude/consumer-meta.json` 等 9 處
   - `rules/output-hygiene.md`：要寫 PR／commit message／code comment／文件／對外訊息之前
   - `rules/rule-authoring.md`：撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約預設一行平述、量到失敗才加反開脫三件套、長度配讀者要做的決定、發佈前驗證；且碰 `.clade/rules/**/*.md`、`.claude/rules/**/*.md`、`.claude/skills/**/*.md` 等 12 處
   - `rules/runtime/notion-work-coupling.md`：Runtime adapter fragment for notion-work-coupling.md；且碰 `tasks/**`、`specs/plans/**`、`.claude/consumer-meta.json` 等 9 處
   - `rules/runtime/rule-authoring.md`：撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約預設一行平述、量到失敗才加反開脫三件套、長度配讀者要做的決定、發佈前驗證；且碰 `.clade/rules/**/*.md`、`.claude/rules/**/*.md`、`.claude/skills/**/*.md` 等 12 處
   - `rules/tech-debt-routing.md`：Tech debt 路由規則——決定發現的技術債該登在 clade 還是當前 consumer，以散播範圍與修法歸屬為準；登記載體依該 repo 是否為 lifecycle repo；且碰 `docs/tech-debt.md`、`**/docs/tech-debt.md`
   - `rules/timezone.md`：動到 instant 欄位、SQL 日期計算、Intl / toLocaleString 格式化、timestamp→timestamptz migration、或設定固定牆鐘時間排程時的 timezone 判準（DB 存 UTC、顯示層轉 local、AT TIME ZONE 方向）；且碰 `**/*.sql`、`supabase/**`、`server/**` 等 8 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
