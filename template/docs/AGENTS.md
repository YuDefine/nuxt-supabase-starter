---
audience: ai-agent
applies-to: post-scaffold
prerequisites:
  - scaffold 已完成（pnpm install 跑過）
  - clade bootstrap 已跑過（.claude/ 內已有 rules / skills）
next-doc: ./NEW_PROJECT_CHECKLIST.md
---

# AGENTS — template layer 入口

> 此檔給「scaffold 出來的新專案內 Claude Code session」用。
> 不要跟 root `AGENTS.md` 混淆 — 那份是 sync-to-agents 從 `.claude/` 投影的行為規則，每次 session 自動載入。
> 這份是 docs 導航入口，AI 要查文件、找 next-action、看哪個 skill 該觸發時走這裡。

## 你在哪

```
<project-root>/
├── .claude/                 ← rules / skills / hooks（clade 治理，唯讀）
├── AGENTS.md                ← root 投影（行為規則，sync-to-agents 維護）
├── docs/
│   ├── AGENTS.md            ← 你在這裡（docs 導航）
│   ├── NEW_PROJECT_CHECKLIST.md  ← 機械化驗收清單
│   ├── WORKFLOW.md          ← plan package / TDD 流程
│   └── ...
├── specs/                   ← specs/truth（現況）+ specs/plans（plan package）
├── tasks/                   ← 日期化工作紀錄
├── app/                     ← Nuxt 4 frontend
├── server/                  ← Nuxt server API
└── supabase/                ← migrations / seed
```

## 第一次進此 session 該做什麼

**最高優先：先檢查 `.claude/.first-run` 是否存在**。存在代表 scaffold 剛完成，必須先跑首輪暖機。

### First-run flow（`.claude/.first-run` 存在時）

```bash
# 1. 讀 marker 取得 scaffold metadata
cat .claude/.first-run     # JSON 內含 scaffoldedAt / projectName / cladeModules

# 2. 機械化驗收
pnpm verify:starter        # 看 OK / WARN / FAIL

# 3. 看 work queue 狀態
pnpm flow who              # 看誰在做什麼／有沒有殘留工作項

# 4. 主動列「next-step」清單給使用者：
#    - 環境 WARN/FAIL 的修復步驟（依 verify:starter 結果）
#    - 缺 OAuth credentials 的 provider console URL（verify:starter 會印）
#    - 推薦先跑 /impeccable teach 建立設計脈絡
#    - 推薦第一個 /specify plan package（基於使用者描述）

# 5. 暖機完成 → 刪除 marker
rm .claude/.first-run
```

`first-run` marker 只應該存在一次。執行完上述流程後**必須**刪除，否則下次 session 又會重跑。

### 其他情況（marker 不存在）

```
新 session 啟動（marker 不存在）
├─ 有進行中的工作項？
│   ├─ pnpm flow who && pnpm flow pending（看 work queue 與待拍板佇列）
│   ├─ 看 specs/plans/* 有沒有未完成的 plan package
│   ├─ 讀 HANDOFF.md（若存在）看上次未完工項
│   └─ 依 ownership 狀態決定 takeover / 接續 / 等待
│
└─ 使用者直接給任務？
    ├─ 任務含 UI → 觸發 design checkpoint（.claude/rules/proactive-skills.md）
    ├─ 任務含 schema / auth / RLS → Tier 3 review（.claude/rules/review-tiers.md）
    └─ 其他 → /clarify 收斂或 /specify 進入 plan package flow
```

## 任務分流（依使用者意圖）

> **首選**：先看 [DEV_RECIPES.md](DEV_RECIPES.md) — 15 種常見開發場景（加 entity / 加 page / 加 API / 加 OAuth / 加 webhook / 加 cron / 整合 vendor / 加上傳 / 加搜尋 / 加 i18n / 加付費 / 加 charts / 重構等）打包成可直接套用的 /specify 範本。AI 收到「我要加 X」時直接套 recipe，不必每次重新規劃。

| 使用者說                          | 觸發                                                         | 入口檔                                                  |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| 「加 X 功能 / 整合 Y / 加 OAuth」 | 套對應 recipe → /specify                                     | [DEV_RECIPES.md](DEV_RECIPES.md)                        |
| 「建第一個功能 / CRUD」           | /specify → /implement                                        | [WORKFLOW.md](WORKFLOW.md)                              |
| 「我想做 X 功能」（需求模糊）     | /clarify 先收斂                                              | [WORKFLOW.md](WORKFLOW.md)                              |
| 「需求清楚，開始做」              | /specify                                                     | [WORKFLOW.md](WORKFLOW.md)                              |
| 「繼續上次的工作」                | 讀 HANDOFF.md / `pnpm flow who` / specs/plans/*              | `.claude/rules/handoff.md`                              |
| 「設定 OAuth」                    | 列出缺哪些 env var，引導使用者去 provider console            | [auth/](auth/)                                          |
| 「設計脈絡 / UI 風格」            | /impeccable teach（首次）/ /impeccable document（既有 code） | `.claude/rules/proactive-skills.md`                     |
| 「跑全套品質檢查」                | `pnpm check`（format → lint → typecheck → test）             | [verify/](verify/)                                      |
| 「部署到 Cloudflare」             | wrangler deploy（**人類執行**，AI 不代跑）                   | [DEPLOYMENT.md](DEPLOYMENT.md)（meta layer）            |
| 「Bug / 行為異常」                | systematic-debugging skill → 找 root cause                   | [DEBUGGING.md](DEBUGGING.md)                            |
| 「資料庫怎麼用」                  | supabase-rls / supabase-migration skills                     | [database/](database/)                                  |
| 「API 怎麼寫」                    | server-api skill                                             | [API_PATTERNS.md](API_PATTERNS.md)                      |
| 「Auth 怎麼用」                   | nuxt-better-auth / nuxt-auth-utils skill                     | [auth/](auth/)                                          |
| 「升級 clade rules」              | `pnpm hub:sync`（**先確認 working tree 乾淨**）              | `.claude/rules/code-style.md` 等                        |
| 「`pnpm hub:check` 報 drift」     | **禁止**靜默 sync，先判斷場景                                | `HUB_DRIFT_RUNBOOK.md`（meta layer）                    |

## 常用命令快查

| 命令                                    | 用途                             | 何時跑                                      |
| --------------------------------------- | -------------------------------- | ------------------------------------------- |
| `pnpm verify:starter`                   | 機械化驗收環境健康               | 第一次進專案 / 懷疑壞了                     |
| `pnpm dev`                              | 啟動 dev server                  | 開發中                                      |
| `pnpm check`                            | format → lint → typecheck → test | commit 前（也由 /commit 自動跑）            |
| `pnpm hub:check`                        | 檢查 vs clade drift              | 懷疑誤改 clade-managed 檔                   |
| `pnpm hub:sync`                         | 從 clade 拉新版                  | clade publish 新版時                        |
| `pnpm flow who`                         | 看 work queue / ownership        | session 開始 / 接手工作項前                 |
| `pnpm flow pending`                     | 看待拍板決策佇列                 | session 開始                                |
| `pnpm audit:ux-drift`                   | 偵測 enum exhaustiveness drift   | UI change 完成後                            |
| `supabase start`                        | 啟動本地 Supabase                | 第一次 / 重啟後                             |
| `supabase db reset`                     | 套用所有 migration               | migration 改動後                            |
| `supabase gen types typescript --local` | 產生 database.types.ts           | migration 改動後                            |

## AI 主動觸發清單

以下情境 AI **必須主動**觸發，不等使用者說：

| 情境                            | 觸發                                                                       | 理由                                  |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| 新 session 開始                 | `pnpm flow who` 看 work queue                                             | 對齊現況                              |
| 任務涉及 UI 檔                  | Design Checkpoint（/design improve → targeted skills → /impeccable audit） | `.claude/rules/proactive-skills.md`   |
| 任務涉及 migration / RLS / auth | Tier 3 review                                                              | `.claude/rules/review-tiers.md`       |
| Plan 結束含 UI scope            | tasks 加 Design Review block                                               | `.claude/rules/proactive-skills.md`   |
| 實作中發現 spec 與實作偏離      | 回寫 plan package 的 spec（不停下實作）                                    | `.claude/rules/proactive-skills.md`   |
| 發現 follow-up / deferred 項    | 加 `@followup[TD-NNN]` marker + register entry                             | `.claude/rules/follow-up-register.md` |
| Session 結束有 WIP              | 寫 HANDOFF.md                                                              | `.claude/rules/handoff.md`            |
| 實作中發現範圍外問題            | 登記 `docs/tech-debt.md` 不擴散                                            | `.claude/rules/scope-discipline.md`   |

## 不可做（AI 禁區）

- **NEVER** 代填 `.env` 內的 OAuth / API secret（必須使用者去 provider console 申請後手動貼）
- **NEVER** 自動 `wrangler deploy` / `vercel deploy` / `git push` 到 main / production
- **NEVER** 直接 `git commit`（必走 /commit）
- **NEVER** 改 `.claude/rules/` / `.claude/skills/` / `.claude/hooks/` 的 clade-managed 檔（要改去 `~/offline/clade/`）
- **NEVER** 代勾 `## 人工檢查` checkbox（要使用者確認後才勾）
- **NEVER** 跑 `git reset --hard` / `git checkout --` / `git clean` 清場
- **NEVER** 未確認 ownership（`pnpm flow who`）就接手進行中的工作項

## 驗收環境健康（pnpm verify:starter）

`pnpm verify:starter` 自動檢查：

- Node / pnpm / docker / supabase CLI / claude CLI 版本
- `.env` vs `.env.example` 缺哪些 var
- `.claude/hub.json` 存在 + checksum 對齊 clade
- `package.json` 含 `postinstall` + `hub:*` scripts
- Supabase 是否在跑（`supabase status`）
- `database.types.ts` 是否與 migration 同步
- `pnpm check` 通過（可選，慢）

輸出機械可解的 JSON（`pnpm verify:starter --json`）+ 人類友善表格（預設）。

## 跨層 forward-link

| 想做 X           | 讀                                                        |
| ---------------- | --------------------------------------------------------- |
| 開發場景 recipes | [DEV_RECIPES.md](DEV_RECIPES.md)                          |
| 環境驗收         | [NEW_PROJECT_CHECKLIST.md](NEW_PROJECT_CHECKLIST.md)      |
| SDD / TDD 流程   | [WORKFLOW.md](WORKFLOW.md)                                |
| API 設計         | [API_PATTERNS.md](API_PATTERNS.md)                        |
| 資料庫 / RLS     | [database/](database/)                                    |
| Auth             | [auth/](auth/)                                            |
| Frontend         | [frontend/](frontend/)                                    |
| Debugging        | [DEBUGGING.md](DEBUGGING.md)                              |
| Troubleshooting  | [TROUBLESHOOTING.md](TROUBLESHOOTING.md)                  |
| FAQ              | [FAQ.md](FAQ.md)                                          |
| 部署             | [DEPLOYMENT.md](DEPLOYMENT.md)                            |
| Tunnel 公開 hostname | [guide/cloudflare-tunnel-hostname.md](guide/cloudflare-tunnel-hostname.md)（CLI／API；完整步驟在 clade snippet） |
| 架構決策         | [decisions/](decisions/) / [architecture/](architecture/) |
| 既有問題解法     | [solutions/](solutions/) / [gotchas/](gotchas/)           |
