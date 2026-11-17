---
name: "clade-security"
description: "Authentication, secrets, production access, and security boundary rules. Use when changing identity, authorization, credentials, production MCP access, or user lifecycle behavior."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/api-handler-semantics.md`：Server API handler 的授權（BOLA／BOPLA／rate limit／webhook 驗簽）、mutation 語意完整性、冪等與 retry 規範；cf-workers 與 nitro-self-hosted 兩種 runtime 共用；且碰 `server/**/*.ts`、`packages/*/server/**/*.ts`
   - `rules/auth-data-path-consistency.md`：新專案選 auth 模組、Auth 策略與資料存取路徑一致性——防止混合 auth 狀態導致 silent 權限降級；且碰 `drizzle.config.ts`、`packages/*/drizzle.config.ts`、`app/**/*.ts` 等 11 處
   - `rules/auth-roles.md`：寫角色判斷、superuser 放行、首位管理員 bootstrap、per-record 權限表時的判準（平台角色與組織角色分層、bootstrap 防搶、權限表帶 org 與同源動作字彙）；且碰 `server/api/**/*.ts`、`server/routes/**/*.ts`、`server/utils/**/*.ts` 等 12 處
   - `rules/auth.md`：認證相關程式碼（login, session, user, auth）；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts` 等 4 處
   - `rules/dev-login.md`：Dev-login routes must stay local-only while giving screenshot review and E2E a canonical way to mint test sessions.；且碰 `server/routes/auth/**/*dev-login*.ts`、`server/routes/auth/**/*test-login*.ts`、`server/api/_dev/**/*.ts` 等 12 處
   - `rules/prod-access.md`：agent 讀寫 production DB 的標準——讀走 `prod-sql read`（專用唯讀角色 agent_ro，免提示）；寫只有 update，走 `prod-sql plan --expect --source` → 沒有警訊的例行 plan 由 agent 自己 `apply`（DB 只授白名單表 UPDATE，人不逐筆核准；有警訊、新增或刪除改走 migration）；prod 寫入前要有經 PR 合入的異地備份宣告，以及回退三層、接入步驟與已知限制。觸發：要查 prod 資料當證據、要修 prod 資料、要讓 consumer 接入、判斷某個 prod 動作要不要人授權（§ 誰要同意）、要以 supabase_admin 連線或 SET ROLE（先 flow ask 當次授權）、或 prod-sql 回報拒絕；且碰 `scripts/prod-sql.ts`、`vendor/scripts/prod-sql.ts`、`.claude/prod-access.json` 等 5 處
   - `rules/prod-mcp-safety.enforcement.md`：prod Supabase MCP 封鎖的逐端設定表（Claude `permissions.deny`）、只能 deny NEVER allow-or-ask 的逐字禁令、server 端 `read_only=true` 的版本條件與 `tools/list` 驗收、整批交易語義（任一端封鎖未證實則全部零寫入）、違反後果實證與偵測入口。觸發是「正在新增／啟用／同步 prod MCP 連線」，綁得到設定檔故 path-scoped；且碰 `.mcp.json`、`.claude/settings.json`、`.claude/settings.local.json`
   - `rules/prod-mcp-safety.md`：要呼叫 prod MCP，或改 MCP 設定之前
   - `rules/public-repo-hygiene.md`：在 PUBLIC repo 的 consumer 寫或改自家 tracked 檔（HANDOFF、tasks、docs、decisions）、接 pre-commit 或 CI hygiene gate 時套用——其他 consumer／客戶代號與個人路徑只准以 placeholder 出現，gate 必須掃整棵 tracked tree；且碰 `.github/workflows/**`、`.husky/**`、`.vite-hooks/**` 等 7 處
   - `rules/secret-custody.md`：有 secret、token、credential 的值到你手上時
   - `rules/secrets.md`：Cloudflare Workers secret 管理規約 — single source of truth = GitHub Secret，CI 以 void secret sync 注入；且碰 `.github/workflows/**/*.yml`、`void.config.ts`
   - `rules/security-policy.md`：SECURITY.md 安全憲法的形狀契約（五段固定、不變量標執行層）；且碰 `SECURITY.md`、`packages/*/SECURITY.md`、`server/middleware/**` 等 8 處
   - `rules/user-lifecycle.md`：User lifecycle 規範（soft-delete / suspend / hard-delete 的 FK 策略與 guard pattern）；且碰 `server/api/**/user*`、`packages/*/server/api/**/user*`、`server/api/**/member*` 等 11 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
