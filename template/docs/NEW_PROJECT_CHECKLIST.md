---
audience: both
applies-to: post-scaffold
prerequisites:
  - scaffold 已完成
verify-script: scripts/verify-starter.mjs
next-doc: ./AGENTS.md
---

# 新專案檢查清單

> **AI agent 入口**：跑 `pnpm verify:starter`（或 `--json` 取機械可解輸出）一次取得全部狀態，不必逐項對照本檔。
> **人類**：本檔做為對照表 — 每項都配 verify command，可手動跑或讓 AI 一次跑完。

```bash
# 一鍵驗收
pnpm verify:starter

# 機械可解輸出（給 CI / agent）
pnpm verify:starter --json

# 加跑 pnpm check（慢，含 lint/typecheck/test）
pnpm verify:starter --full
```

退出碼：`0` = 全綠、`2` = 有 WARN 但無 FAIL、`1` = 有 FAIL（必須修）。

---

## ✅ 基礎設定

| 項目                         | Verify                                                                                   | Fix                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Node.js ≥ 18                 | `node -v`                                                                                | 安裝 Node 18+（建議 24 LTS）                                           |
| pnpm ≥ 9                     | `pnpm --version`                                                                         | `corepack enable && corepack prepare pnpm@latest --activate`           |
| Docker daemon 運作中         | `docker info`                                                                            | 啟動 Docker Desktop / OrbStack                                         |
| Supabase CLI                 | `supabase --version`                                                                     | `brew install supabase/tap/supabase`                                   |
| Claude Code CLI              | `claude --version`                                                                       | `curl -fsSL https://claude.ai/install.sh \| sh`                        |
| `.env` 已建立並填值          | `test -f .env && diff <(grep -oE '^[A-Z_]+=' .env.example) <(grep -oE '^[A-Z_]+=' .env)` | `cp .env.example .env` 後填值                                          |
| Git 已 init + initial commit | `git log --oneline \| head -1`                                                           | `git init && git add -A && git commit -m "initial"`（scaffold 已自動） |

## ✅ Clade 整合

| 項目                                        | Verify                                                                                                         | Fix                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `.claude/hub.json` 存在 + 合法              | `node -e "JSON.parse(require('fs').readFileSync('.claude/hub.json'))"`                                         | `pnpm hub:bootstrap`                                                   |
| `package.json` postinstall 含 bootstrap-hub | `grep -q bootstrap-hub package.json`                                                                           | 重跑 init-consumer                                                     |
| `hub:*` scripts 完整                        | `node -e "const p=require('./package.json'); ['hub:check','hub:sync','hub:bootstrap'].every(s=>p.scripts[s])"` | 重跑 init-consumer                                                     |
| Clade drift = 0                             | `pnpm hub:check`                                                                                               | `pnpm hub:sync`（先確認 working tree 乾淨）                            |
| Pre-commit hook wired                       | `grep -lE 'hub:check\|git-pre-commit.sh' .husky/pre-commit .git/hooks/pre-commit 2>/dev/null`                  | scaffold 預設自動 wire；手動見 [QUICK_START.md](verify/QUICK_START.md) |

## ✅ Supabase 設定

| 項目                                 | Verify                                       | Fix                                                                                    |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `supabase init` 已跑                 | `test -f supabase/config.toml`               | `supabase init`（scaffold 已自動）                                                     |
| `supabase start` 成功                | `supabase status --output json` 回傳 API_URL | `supabase start`                                                                       |
| `app/types/database.types.ts` 已產生 | `test -s app/types/database.types.ts`        | `supabase gen types typescript --local \| tee app/types/database.types.ts > /dev/null` |
| `.env` 含 Supabase URL/Key           | `grep -q SUPABASE_URL .env`                  | 對照 `.env.example`                                                                    |

## ✅ 依賴安裝

| 項目                | Verify                             | Fix                        |
| ------------------- | ---------------------------------- | -------------------------- |
| `node_modules` 存在 | `test -d node_modules`             | `pnpm install`             |
| Skills 已安裝       | `ls .claude/skills/ \| wc -l` ≥ 20 | `pnpm skills:install`      |
| Skills 列表正確     | `pnpm skills:list`                 | 重跑 `pnpm skills:install` |

### Skills 期望清單

第三方 skills（`pnpm skills:install` 安裝）：

```
vue, vueuse-functions, nuxt, pinia, vitepress, vitest,
vue-best-practices, vue-testing-best-practices,
supabase-postgres-best-practices, nuxt-ui, find-skills
```

專案 skills（隨 scaffold 帶出，clade 治理或 local）：

```
nuxt-better-auth, supabase-rls, supabase-migration,
server-api, pinia-store, spectra-* (apply/propose/archive/...)
```

驗證命令：

```bash
ls .claude/skills/ | sort
```

期望輸出包含上述清單。差異 → `pnpm skills:install` 補齊。

## ✅ Claude Code 設定

| 項目                         | Verify                                              | Fix                                             |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `.claude/settings.json` 存在 | `test -f .claude/settings.json`                     | scaffold 已自動                                 |
| SessionStart hook 已 wire    | `grep -q _bootstrap-check.sh .claude/settings.json` | 重跑 init-consumer                              |
| `claude` CLI 可啟動          | `claude --version`                                  | `curl -fsSL https://claude.ai/install.sh \| sh` |

## ✅ 開發環境驗證

| 項目              | Verify                                              | Fix                      |
| ----------------- | --------------------------------------------------- | ------------------------ |
| `pnpm dev` 啟動   | 開瀏覽器到 `localhost:3000` 看到初始頁              | 看 stderr 訊息修對應問題 |
| `pnpm check` 通過 | `pnpm check`（含 format → lint → typecheck → test） | 修出錯項目               |
| `pnpm test` 通過  | `pnpm test`                                         | 修失敗測試               |

## ✅ Git 設定（選用）

| 項目        | Verify                           | Fix                           |
| ----------- | -------------------------------- | ----------------------------- |
| Remote 已設 | `git remote -v`                  | `git remote add origin <url>` |
| 已 push     | `git log origin/main..HEAD` 為空 | `git push -u origin main`     |

---

## 🎯 下一步

全綠後（或 verify-starter 退出碼 = 0/2）：

1. **設計脈絡**（首次必跑）：在 Claude Code session 內執行 `/impeccable teach` 產出 `.impeccable.md`
2. **第一個功能**：`/spectra-propose` 建立 change → `/spectra-apply` 實作
3. **OAuth**（如選了 better-auth / nuxt-auth-utils）：去 provider console 申請 credentials → 填 `.env`（**人類執行，AI 不代填**）
4. **完整教學**：先看 [DEV_RECIPES.md](DEV_RECIPES.md)，再用 `/spectra-propose` 建立第一個 CRUD change

## ⚠️ 常見問題

### Skills 數量不對

```bash
pnpm skills:install   # 重裝
pnpm skills:list      # 確認
```

### Supabase 啟動失敗

```bash
docker info               # 確認 daemon 在跑
supabase stop && supabase start
```

### `pnpm dev` port 被佔

```bash
lsof -ti:3000 | xargs kill        # 清掉佔用者
pnpm dev --port 3001              # 或換 port
```

### Claude Code 不認得 commands

```bash
ls .claude/commands/       # 確認檔案存在
ls .claude/settings.json   # 確認 settings 存在
# 重啟 claude session
```

### `pnpm hub:check` 偵測到 drift

drift 通常代表本地誤改了 clade-managed 檔。處理路徑：

- 如果是誤改 → `pnpm hub:sync` 還原（先 stash 自家工作）
- 如果是合理改動 → 改動應該回中央倉 `~/offline/clade/`，不該留在 consumer
- 詳見 [WORKFLOW.md](WORKFLOW.md) 與 root `CLAUDE.md`
