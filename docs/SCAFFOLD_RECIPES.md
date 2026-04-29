---
audience: ai-agent
applies-to: pre-scaffold
related:
  - AGENTS.md
  - QUICK_START.md
purpose: 把常見產品形態打包成「可直接複製」的 scaffold 命令，AI 解析使用者描述後直接執行對應 recipe，不需要進互動 prompt
---

# Scaffold Recipes — 自然語言 → 直接命令

> 每個 recipe 都是 `--yes` 全自動模式的完整命令。AI 解析使用者描述 → 找對應 recipe → 直接執行（取代互動 prompt）。

## 命令 prefix（共用）

所有 recipe 假設你已：

```bash
test -d ~/offline/clade || git clone git@github.com:YuDefine/clade.git ~/offline/clade
test -d temp-starter || git clone https://github.com/YuDefine/nuxt-supabase-starter temp-starter
cd temp-starter
```

之後跑下列任一 recipe（替換 `<NAME>` 為使用者指定的專案名）。

## Recipes

### R1 — SaaS Dashboard（內部 / B2B 工具，最常見）

**適合**：登入後使用、多使用者、有 admin 後台、dashboard / table / form 重的應用。

**不適合**：行銷站（要 SEO）、靜態頁、純 API。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --with charts,monitoring
```

衍生：

- 不需要 admin / 多角色 → 改 `--auth nuxt-auth-utils`（輕量、Edge-friendly）
- 不需 charts → `--without charts`
- 不需監控 → 移除 `,monitoring`

### R2 — 面向用戶 SSR 站（行銷頁 / Blog / SEO 站）

**適合**：需要 SEO、首屏速度重要、social share preview、有公開頁面。

**不適合**：純 dashboard、登入牆站。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth nuxt-auth-utils \
  --with ssr,seo,monitoring,image
```

衍生：

- 部分頁公開 + 部分 dashboard → 同上保留 ssr，登入後頁用 `definePageMeta({ ssr: false })`
- 不需登入（純行銷）→ 改 `--auth none`

### R3 — Cloudflare Workers + Edge（極致低延遲）

**適合**：全球用戶、低延遲、無 Node 相依需求、適合 serverless。

**不適合**：需要 long-running task、大檔處理、Node-only library。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth nuxt-auth-utils \
  --with monitoring
# deploy-cloudflare 是預設，不必加
```

衍生：

- 需要 DB session（Better Auth）→ `--auth better-auth`，但需 Hyperdrive 配置
- Vercel 改：`--without deploy-cloudflare --with deploy-vercel`
- 自架 Node：`--without deploy-cloudflare --with deploy-node`

### R4 — Multi-tenant SaaS（每客戶獨立 schema / org_id）

**適合**：B2B SaaS、租戶隔離、按 org 計費。

**不適合**：個人應用、無組織概念。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --with charts,monitoring,security
```

後續工作（不在 scaffold 範圍）：

- 設計 org / membership 表（用 `/spectra-propose multi-tenant-foundation`）
- 所有 RLS policy 加 `org_id` filter（見 `.claude/rules/rls-policy.md`）
- API 取 org context：`getSupabaseWithContext(event)` + middleware 注入 `request.org`

### R5 — Prototype / Hackathon（最快開始）

**適合**：48 小時內要 demo、不需 testing-full、結束可能丟。

**不適合**：要進 production 的專案（缺 testing / monitoring）。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --fast \
  --minimal \
  --with ui,database
```

衍生：

- 純前端（不需 Supabase）→ 改 `--auth none --without database`
- 需要 OAuth 但仍簡單 → 加 `--with auth`，用 `--auth nuxt-auth-utils`

### R6 — 純 API / Mobile backend（無 web UI 但用 starter 的工具鏈）

**適合**：Mobile app 的 backend、需要 RLS + Edge runtime + Supabase。

**不適合**：純 web 應用。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --without charts,image,seo \
  --with monitoring
```

後續：

- 移除 `app/pages/`，只留 `server/api/`
- 從 starter 的 docs/API_PATTERNS.md 開始設計 endpoint

### R7 — AI / RAG / LLM 應用（streaming response、向量庫）

**適合**：RAG、ChatGPT-like、AI agent backend。

**不適合**：純 CRUD、無 AI 互動。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --with monitoring
```

後續工作：

- pgvector 啟用：`supabase migration new enable_pgvector` + `CREATE EXTENSION vector`
- 若 deploy 到 Cloudflare Workers，評估改用 Cloudflare Vectorize（無 egress fee、整合 Workers）
- LLM API（Anthropic / OpenAI）secret 放 `runtimeConfig`，**不可** `NUXT_PUBLIC_*`
- streaming response 在 Workers 上要用 `Response` + `ReadableStream`，不可用 Node `Readable`

### R8 — E-commerce（產品 / 訂單 / 金流）

**適合**：B2C 電商、訂單系統。

**不適合**：純內容站、SaaS 工具。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth nuxt-auth-utils \
  --with ssr,seo,monitoring,image,security
```

後續：

- 金流 webhook idempotency：見 `.claude/rules/api-patterns.md` Idempotency 段
- 訂單狀態機：用 enum + `assertNever`（見 `.claude/rules/ux-completeness.md` Exhaustiveness Rule）
- Stripe / 綠界 secret 走 server-only env

### R9 — 純靜態網站（不需要登入 / DB）

**適合**：作品集、文件站、Landing page。

**不適合**：需要使用者資料的應用。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth none \
  --with ssr,seo,image \
  --without database,charts
```

衍生：

- 全靜態預渲染：`nuxt.config.ts` 設 `nitro.prerender.routes: ['/']`

### R10 — 內部工具 / Admin Panel（最簡 dashboard）

**適合**：只給內部員工、不需要 SEO、不需要極致效能。

**不適合**：對外用戶。

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --without charts,seo
```

衍生：

- 不需多角色 → `--auth nuxt-auth-utils`
- 要視覺化 → 移除 `--without charts`

## 自然語言關鍵字 → Recipe 路由

| 使用者描述含 | 走哪個 recipe |
|---|---|
| dashboard / B2B / SaaS / 後台 / 管理介面 | R1 |
| 行銷 / SEO / 部落格 / blog / 公開頁 / landing | R2 |
| 全球 / edge / 低延遲 / Cloudflare | R3 |
| 多租戶 / multi-tenant / 多組織 / org / workspace | R4 |
| prototype / hackathon / demo / 快速 / 急 | R5 |
| API / mobile backend / 無 UI | R6 |
| AI / chatbot / LLM / RAG / 向量 / embedding | R7 |
| 電商 / shop / 訂單 / 金流 / Stripe | R8 |
| 靜態 / 純前端 / 不需登入 / portfolio | R9 |
| 內部工具 / 公司用 / 不對外 | R10 |

## 多重需求合成

使用者描述含多個關鍵字時，AI 應主導合成：

> 「面向用戶 SSR + AI chatbot + 監控 + 部署 Cloudflare」

→ R2（SSR base）+ R7（AI）合成：

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --with ssr,seo,monitoring,image
# 後續加 pgvector + LLM API（見 R7 後續）
```

> 「e-commerce + multi-tenant」（多商家平台）

→ R4 + R8 合成：

```bash
bash scripts/create-fast-project.sh temp/<NAME> \
  --auth better-auth \
  --with ssr,seo,monitoring,image,security
# 後續加 org 表 + 商家層級 RLS
```

## 衝突解決

使用者描述產生衝突 flag 時：

| 衝突 | 解決規則 |
|---|---|
| auth 多選 | 後出現的優先 |
| deploy 多選 | 互斥，問使用者；若使用者沒明確 → Cloudflare（預設） |
| ssr + 「prototype」 | 「快」優先 → 跳過 ssr，用 SPA |
| testing-full + 「快」/「prototype」 | 跳過 testing-full（`--fast` 自動處理） |

## 不可代決事項

以下使用者沒明確說時，**不要**靜默選預設，要問或明確告知所選預設：

- **Auth provider 之間**（better-auth vs nuxt-auth-utils）— 影響架構，不可靜默選
- **Deploy target**（Cloudflare vs Vercel vs Node）— 影響部署 / 帳號 / 成本
- **Multi-tenant 結構**（per-org vs per-tenant DB）— 影響整個 schema 設計

預設值（`scripts/create-fast-project.sh` 不帶 flag）為 `auth=nuxt-auth-utils`、`SPA`、`Cloudflare` — AI 採用此預設時應**明確告知**使用者「我用了 X 預設，因為你沒明確指定」。
