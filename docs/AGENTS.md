---
audience: ai-agent
applies-to: pre-scaffold
prerequisites: []
next-doc: ../template/docs/AGENTS.md
---

# AGENTS — meta layer 入口

> 此檔給「外部 AI agent 第一次進入此 starter repo」用。人類請從 [QUICK_START.md](QUICK_START.md) 入手。

## 你在哪

```
nuxt-supabase-starter/
├── docs/                    ← 你在這裡（meta layer，給創專案的人/AI 看）
├── template/                ← scaffold 出來的新專案會以此為藍本
│   └── docs/                ← scaffold 後新專案內的 docs（給寫程式的人/AI 看）
└── scripts/                 ← meta 工具（create-clean / create-fast-project / validate-starter）
```

scaffold 完成後，新專案內的 AI session 改讀 `template/docs/AGENTS.md`（已 forward-link 在底部）。

## 你該先做什麼

依使用者意圖分支：

| 使用者說 | 走哪條 | 起點 |
|---|---|---|
| 「建立新專案」/「scaffold」/「create」 | scaffold flow | 本檔下方「scaffold 自動化決策」 |
| 「整合到既有 Nuxt 專案」 | integration flow | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| 「先看 demo」 | demo flow | [QUICK_START.md#想先看-demo](QUICK_START.md) |
| 「了解 tech stack」 | tech overview | [TECH_STACK.md](TECH_STACK.md) |
| 「OAuth / 部署 / 第一個 CRUD」 | scaffold 後文件 | scaffold 完成後讀 `template/docs/AGENTS.md` |

## scaffold 自動化決策

scaffold CLI（`create-nuxt-starter`）已盡量機械化，AI 可全自動完成這些步驟：

| 步驟 | 自動化狀態 | AI 該做 |
|---|---|---|
| 找 clade 中央倉 | ✅ 自動偵測 `CLADE_HOME` / `~/clade` / `~/offline/clade` | 不必介入 |
| 寫 `.claude/hub.json` + postinstall + `hub:*` scripts | ✅ `init-consumer.mjs` 自動 | 不必介入 |
| `pnpm install`（含失敗 retry） | ✅ 自動 | 不必介入 |
| 從 clade 拉 rules/skills/hooks | ✅ postinstall 自動跑 bootstrap-hub | 不必介入 |
| 投影 `.codex/.agents/AGENTS.md` | ✅ 自動 | 不必介入 |
| `git init` + 首個 commit | ✅ 自動 | 不必介入 |
| 登記到 `consumers.local` | ✅ `--yes` 模式自動，互動模式 prompt | `--yes` 跳過 prompt 即可 |
| wire pre-commit hook | ✅ `--yes` 模式自動，互動模式 prompt | 同上 |
| 找不到 clade | ⚠️ warn 但不擋 | 提示使用者 `git clone git@github.com:YuDefine/clade.git ~/offline/clade` 後重跑 |
| 填 OAuth credentials（`.env`） | ❌ 需使用者去 provider console 申請 | 列出缺哪些 var、提示填入位置；**不可代填** |
| `wrangler deploy` / `vercel deploy` | ❌ 需帳號權限 | 不可代執行；列命令讓使用者跑 |

## 自然語言 → scaffold flag 對照

> 完整 recipe（10 種常見產品形態打包成可直接複製的命令）：[SCAFFOLD_RECIPES.md](SCAFFOLD_RECIPES.md)。先去那裡找對應 recipe，找不到再用下方對照表合成。

使用者用自然語言描述需求時，AI 應直接組合 flag 跑 non-interactive scaffold（`--yes`），而非進互動 prompt。

| 使用者描述關鍵字 | 對應 flag |
|---|---|
| 「面向用戶」「需要 SEO」「SSR」「行銷站」 | `--with ssr,seo` |
| 「Dashboard」「內部工具」「後台」 | （預設 SPA，無需 flag） |
| 「Better Auth」「DB session」「多裝置管理」 | `--auth better-auth` |
| 「輕量 auth」「Cookie session」「Edge」 | `--auth nuxt-auth-utils`（預設） |
| 「不需要登入」「純靜態」 | `--auth none` |
| 「Cloudflare」「Workers」「Edge 部署」 | `--with deploy-cloudflare`（預設） |
| 「Vercel」 | `--without deploy-cloudflare --with deploy-vercel` |
| 「自架 / Docker / VPS」 | `--without deploy-cloudflare --with deploy-node` |
| 「監控」「錯誤追蹤」「Sentry」 | `--with monitoring` |
| 「prototype」「hackathon」「快」 | `--fast` |
| 「最小」「先有一個能跑的就好」 | `--minimal --with ui,database` |
| 「團隊用」「正式專案」「嚴格 CI」 | `--ci advanced` |

完整決策矩陣：[QUICK_START.md#tech-stack-選擇指引](QUICK_START.md)

### 推導範例

> 「我要做一個面向用戶 SSR 站，用 Better Auth，需要監控，部署到 Cloudflare」

→ `bash scripts/create-fast-project.sh temp/my-app --auth better-auth --with ssr,seo,monitoring`

> 「最小化內部工具，純 SPA」

→ `bash scripts/create-fast-project.sh temp/my-app --without charts,security,image`

> 「prototype，越快越好」

→ `bash scripts/create-fast-project.sh temp/my-app --fast --minimal --with ui,database`

## 推薦執行路徑（AI 全自動）

```bash
# 1. 預檢
test -d ~/offline/clade || git clone git@github.com:YuDefine/clade.git ~/offline/clade
test -d temp-starter || git clone https://github.com/YuDefine/nuxt-supabase-starter temp-starter
cd temp-starter

# 2. 從自然語言推導 flag，跑 fast script（含 --yes）
bash scripts/create-fast-project.sh temp/<name> <flags>

# 3. scaffold 完成後切目錄並驗收
cd temp/<name>
pnpm verify:starter         # 機械化驗收（見 template/docs/NEW_PROJECT_CHECKLIST.md）

# 4. 切換成新專案內 session，讀 template/docs/AGENTS.md
```

## scaffold 後的 handoff

scaffold 完成、`pnpm install` 結束後：

1. AI session 應切到新專案目錄（`cd <targetDir>`）
2. **改讀 `<targetDir>/docs/AGENTS.md`**（即 `template/docs/AGENTS.md` 投影出去的版本）
3. 這份 meta `docs/AGENTS.md` 不再相關 — 它只服務 pre-scaffold 階段

## 失敗 fallback

| 症狀 | 偵測 | 修復 |
|---|---|---|
| `pnpm install` 報 `ERR_PNPM_IGNORED_BUILDS` | stdout 含此字串 | post-scaffold 已自動 retry 一次；仍失敗則人工 `cd <dir> && pnpm install` |
| 找不到 clade | scaffold 印 `找不到 clade（CLADE_HOME / ~/clade / ~/offline/clade）` | scaffold 預設會自動嘗試 clone（`--no-clone-clade` 可跳過）。失敗時手動 `git clone git@github.com:YuDefine/clade.git ~/offline/clade` 後 `cd <dir> && pnpm hub:bootstrap` |
| `pnpm hub:check` 偵測到 drift | 退出非 0 + 列出 drift 路徑 | **禁止**靜默 sync；對照 [HUB_DRIFT_RUNBOOK.md](HUB_DRIFT_RUNBOOK.md) 4 種場景判斷再動手 |
| port 3000 被佔 | `pnpm dev` 失敗 | `lsof -ti:3000 \| xargs kill` 或 `pnpm dev --port 3001` |
| Supabase 無法啟動 | `supabase start` 報 docker 錯誤 | 確認 docker 已跑：`docker info`；macOS 用 OrbStack 或 Docker Desktop |
| 預設關鍵字殘留 | `rg -ni "nuxt[- ]supabase starter\|demo" temp/<name>` 有輸出 | scaffold CLI 應已避免，若殘留代表 bug — 回報並手動 sed |

## 禁止事項（AI 不可做）

- **NEVER** 代使用者填 OAuth secret 到 `.env`
- **NEVER** 自動 `wrangler deploy` / `vercel deploy` / `git push` 到 production
- **NEVER** 跳過 scaffold CLI 直接手動建專案結構（會錯過 clade 整合）
- **NEVER** 在使用者沒明確說 deploy target 時擅自選 — 用預設（Cloudflare）並告知

## 相關文件

| 文件 | 用途 | 何時讀 |
|---|---|---|
| [QUICK_START.md](QUICK_START.md) | 完整 scaffold 指南（人類友善） | 想看完整流程 |
| [SCAFFOLD_RECIPES.md](SCAFFOLD_RECIPES.md) | 10 種產品形態 → 直接命令 | 自然語言推導 scaffold 命令 |
| [HUB_DRIFT_RUNBOOK.md](HUB_DRIFT_RUNBOOK.md) | hub:check drift 處理決策樹 | drift 出現時 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 整合到既有 Nuxt 專案 | 既有專案而非新建 |
| [TECH_STACK.md](TECH_STACK.md) | Tech stack 概覽 | 評估是否合適 |
| [CLI_SCAFFOLD.md](CLI_SCAFFOLD.md) | CLI 內部設計 | 改 scaffold CLI 時 |
| [FIRST_CRUD.md](FIRST_CRUD.md) | 第一個 CRUD 教學 | scaffold 後第一個功能 |
| [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md) | Claude Code 配置 | 設定 IDE 整合 |
| [SKILL_UPDATE_GUIDE.md](SKILL_UPDATE_GUIDE.md) | 更新第三方 skills | 維運 |
| [VISUAL_GUIDE.md](VISUAL_GUIDE.md) | 視覺化整體架構 | 高階理解 |

**下一步（scaffold 完成後）**：→ `<targetDir>/docs/AGENTS.md`（template layer 入口）
