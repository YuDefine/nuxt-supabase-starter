<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

api-handler-semantics.md — Server API handler 的授權（BOLA／BOPLA／rate limit／webhook 驗簽）、mutation 語意完整性、冪等與 retry 規範；cf-workers 與 nitro-self-hosted 兩種 runtime 共用
5-10 前導 — API Handler 授權、Mutation 與冪等
12-43 OWASP API Authorization
45-102 Mutation 語意完整性
104-118 Idempotency 與 Retry

auth-data-path-consistency.md — 新專案選 auth 模組、Auth 策略與資料存取路徑一致性——防止混合 auth 狀態導致 silent 權限降級
5-8 前導 — Auth–Data Path 一致性
10-14 核心命題
16-22 Trigger
24-31 MUST
33-37 NEVER
39-63 Server 側：RLS policy 的前提條件
65-73 Auth 策略與資料路徑的合法組合
75-102 Auth 選型
104-137 資料存取層選型
139-172 偵測
174-178 相關規則

auth-roles.md — 寫角色判斷、superuser 放行、首位管理員 bootstrap、per-record 權限表時的判準（平台角色與組織角色分層、bootstrap 防搶、權限表帶 org 與同源動作字彙）
5-10 前導 — Auth Roles（角色分層、bootstrap、資源層權限）
12-21 兩層角色
23-29 Bootstrap（首位 superuser）
31-45 Resource-level（per-record 權限表）

auth.md — 認證相關程式碼（login, session, user, auth）
5-12 前導 — Auth
14-23 better-auth 安全基線
25-41 與 Supabase 併用時：RLS 不能當授權層
43-60 Access control（角色 → 資源 → 動作）
62-69 Organization 隔離
71-83 僅適用直接使用 Supabase Auth（GoTrue）的場景

dev-login.md — Dev-login routes must stay local-only while giving screenshot review and E2E a canonical way to mint test sessions.
5-10 前導 — Dev-login
12-30 MUST
32-40 NEVER
42-49 Canonical Route Shapes
51-54 Decision Reference
56-59 Screenshot Integration

prod-access.md — agent 讀寫 production DB 的標準——讀走 `prod-sql read`（專用唯讀角色 agent_ro，免提示）；寫只有 update，走 `prod-sql plan --expect --source` → 沒有警訊的例行 plan 由 agent 自己 `apply`（DB 只授白名單表 UPDATE，人不逐筆核准；有警訊、新增或刪除改走 migration）；prod 寫入前要有經 PR 合入的異地備份宣告，以及回退三層、接入步驟與已知限制。觸發：要查 prod 資料當證據、要修 prod 資料、要讓 consumer 接入、判斷某個 prod 動作要不要人授權（§ 誰要同意）、要以 supabase_admin 連線或 SET ROLE（先 flow ask 當次授權）、或 prod-sql 回報拒絕
12-20 前導 — Prod Access（agent 讀寫 production DB）
22-48 誰要同意：授權分級（每一個 prod 動作開跑前 MUST 查這張表）
50-68 讀 prod：`prod-sql read`
70-104 改 prod 資料：例行 plan → agent 自己 apply
106-120 異地備份宣告（prod 寫入的前提）
122-133 回退
135-144 接入（每個 consumer 一次）
146-173 已知限制

prod-mcp-safety.enforcement.md — prod Supabase MCP 封鎖的逐端設定表（Claude `permissions.deny`）、只能 deny NEVER allow-or-ask 的逐字禁令、server 端 `read_only=true` 的版本條件與 `tools/list` 驗收、整批交易語義（任一端封鎖未證實則全部零寫入）、違反後果實證與偵測入口。觸發是「正在新增／啟用／同步 prod MCP 連線」，綁得到設定檔故 path-scoped
10-27 前導 — Prod MCP 封鎖的逐端設定與交易語義
29-43 Server 端唯讀（`read_only=true`）
45-57 跨端同步的交易語義、違反後果與偵測

prod-mcp-safety.md — 要呼叫 prod MCP，或改 MCP 設定之前
5-7 前導 — Prod MCP Safety
9-14 Prod Supabase MCP Permission

public-repo-hygiene.md — 在 PUBLIC repo 的 consumer 寫或改自家 tracked 檔（HANDOFF、tasks、docs、decisions）、接 pre-commit 或 CI hygiene gate 時套用——其他 consumer／客戶代號與個人路徑只准以 placeholder 出現，gate 必須掃整棵 tracked tree
5-13 前導 — Public Repo Hygiene（自寫檔的洩漏 gate）
15-23 MUST
25-33 判定語義（與 clade sanitize 同一份）
35-41 REQUIRED 欄位
43-50 已知邊界

secret-custody.md — 有 secret、token、credential 的值到你手上時
4-9 前導 — Secret Custody（secret 值到手時的既定動作）
11-14 觸發
16-22 你的動作是（不是「你可以考慮」）
24-33 保管處 allowlist
35-46 NEVER 把 secret 管理退回給 user
48-59 「執行者是 <人名>」「user-only」的前提失效條款
61-66 保管紀錄本身要能被取回

secrets.md — Cloudflare Workers secret 管理規約 — single source of truth = GitHub Secret，CI 以 void secret sync 注入
5-12 前導 — Cloudflare Workers Secrets
14-21 MUST
23-27 NEVER
29-35 唯一例外
37-63 推送流程範例（production）
65-71 Verify checklist（per consumer，CF Workers runtime）
73-78 為什麼
80-88 反例

security-policy.md — SECURITY.md 安全憲法的形狀契約（五段固定、不變量標執行層）
5-10 前導 — Security policy（SECURITY.md 安全憲法）
12-22 五段固定結構（REQUIRED，順序固定）
24-31 條件句
33-39 精簡

user-lifecycle.md — User lifecycle 規範（soft-delete / suspend / hard-delete 的 FK 策略與 guard pattern）
5-12 前導 — User Lifecycle
14-20 三種 Variant
22-35 FK Strategy Decision Matrix
37-53 Delete Guard Pattern
55-61 Auth Layer Enforcement
63-78 Session 失效策略（依 session-store 類型）
80-82 Audit events（帳號與成員異動）
84-91 MUST
93-100 NEVER
102-121 Review 檢查
