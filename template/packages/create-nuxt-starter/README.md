# create-nuxt-starter

Interactive CLI to scaffold a Nuxt + Supabase project from this starter template.

## Usage

```bash
# wizard mode (對話式選擇)
pnpm create nuxt-supabase-starter my-app

# non-interactive (帶 flag)。Supabase 軌必須回答資料庫跑在哪
pnpm create nuxt-supabase-starter my-app --yes --db-host this-machine --no-register-consumer
pnpm create nuxt-supabase-starter my-app --auth nuxt-auth-utils --ci simple --db-host this-machine

# 一次完成 Clade fleet identity（Clade checkout 必須可被找到）
pnpm create nuxt-supabase-starter my-app --yes \
  --db-host this-machine \
  --repo-id YuDefine/my-app \
  --workflow-model trunk-based \
  --business-activity pre-production \
  --dev-port 3120 \
  --deploy-track none
```

## Flags

| Flag                  | Values                                                    | Description                                          |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `--yes`, `-y`         | —                                                         | Skip TTY. Catalog answers must already be flags      |
| `--db-host`           | `this-machine` \| `existing-server`                        | Where Supabase runs in development (required if DB is Supabase) |
| `--auth`              | `nuxt-auth-utils` \| `better-auth` \| `none`              | Auth provider                                        |
| `--ci`                | `simple` \| `advanced`                                    | GitHub Actions CI mode                               |
| `--preset`            | `default` \| `fast`                                       | Profile preset (fast skips testing)                  |
| `--fast`              | —                                                         | Alias of `--preset fast`                             |
| `--agents`            | `claude-code,codex,cursor`                                | Comma-separated AI runtime targets                   |
| `--with`              | feature ids                                               | Comma-separated features to add                      |
| `--without`           | feature ids                                               | Comma-separated features to remove                   |
| `--minimal`           | —                                                         | Empty feature set, build up with `--with`            |
| `--evlog-preset`      | `none` \| `baseline` \| `d-pattern-audit` \| `nuxthub-ai` | evlog (wide event logging) tier — default `baseline` |
| `--register-consumer` | —                                                         | Register through Clade registry (default `true`)     |
| `--repo-id`           | `owner/repo`                                              | Stable Clade fleet identity                          |
| `--workflow-model`    | `trunk-based` \| `pr-merge-based`                         | Clade delivery model (default `trunk-based`)         |
| `--business-activity` | `pre-production` \| `active` \| `maintenance` \| `paused` \| `auto` | Clade signal weight (default `pre-production`) |
| `--dev-port`          | `1024..65535`                                             | Centrally allocated Nuxt development port            |
| `--wire-pre-commit`   | —                                                         | Wire pre-commit hub:check hook (default `true`)      |
| `--clone-clade`       | —                                                         | Clone clade if not found (default `true`)            |

`--register-consumer` 只有在提供 `--repo-id` 與 `--dev-port` 時才會完成中央 fleet 登記。未提供時，
scaffold 仍會完成 project-local Clade 初始化，並提示回 Clade 執行
`/project-bootstrap adopt`。`consumers.local` 是由中央 registry 產生的本機投影，不應手動編輯。

選 `--agents codex` 時，scaffold 立即從產出的 `.claude/skills/` 建立
`.agents/skills/`，並提供 `.codex/config.toml` 與 `AGENTS.md`；不需要本機 Clade，
Codex CLI 也能使用。managed scaffold 會在依賴安裝成功後由 Clade 的
`run-sync-to-codex.ts` 補上完整投影。使用 `--no-install` 或
`--no-register-consumer` 時，只有完整投影延後：CLI 會印出後續指令，`--json`
結果的 `codexProjection.status` 為 `deferred`，`command` 欄位提供相同指令。

## evlog preset

`--evlog-preset` 控制 wide event logging stack 套用 tier。對應 clade `presets/evlog-{baseline,d-pattern-audit,nuxthub-ai}/`。

| Preset             | 適用情境                               | 套件數 | 額外帶起的                                                               |
| ------------------ | -------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `none`             | 純 Nuxt + Supabase starter，不用 evlog | 0      | —                                                                        |
| `baseline`（預設） | 內部工具 / SROI 報告 / 教學系統        | 6      | drain pipeline + 5 件套 enricher + sampling/redaction + client transport |
| `d-pattern-audit`  | 醫療 / 金融 / 公部門合規場景           | 13     | baseline + audit_logs migration + HMAC-signed audit chain + diff-cron    |
| `nuxthub-ai`       | AI agent / RAG / chatbot 應用          | 7      | NuxtHub D1 drain + AI cost tracking + SSE/MCP child logger               |

選擇邏輯（master plan § 2.3）：

```
是否需要 audit chain（合規）？
  yes → d-pattern-audit
  no  → 是否 AI agent stack？
          yes → nuxthub-ai
          no  → baseline
```

### 範例

```bash
# 預設（baseline）— 大多數應用
pnpm create nuxt-supabase-starter my-app

# 純 starter，不要 evlog
pnpm create nuxt-supabase-starter my-app --evlog-preset none

# 合規場景（醫療 / 金融）
pnpm create nuxt-supabase-starter my-app \
  --evlog-preset d-pattern-audit \
  --auth better-auth

# AI agent 應用（NuxtHub D1 + AI cost tracking）
pnpm create nuxt-supabase-starter my-app \
  --evlog-preset nuxthub-ai \
  --with chat,charts
```

## See also

- clade `docs/evlog-master-plan.md` — wide event logging 設計與選擇決策樹
- clade `presets/evlog-*/PRESET.md` — 各 preset 安裝步驟與 nuxt.config 範例
- starter `docs/evlog-client-transport.md` — client transport 設定
